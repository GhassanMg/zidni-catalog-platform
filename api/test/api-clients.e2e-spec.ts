import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  API,
  auditEntries,
  createTestApp,
  Fixtures,
  MISSING_ID,
  prismaOf,
  resetDatabase,
  seedFixtures,
} from './support/app';

describe('API clients / agent keys (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await resetDatabase(prisma);
    fx = await seedFixtures(app);
  });

  afterAll(() => app.close());

  it('issues a key once, stores only its hash and lets the agent authenticate', async () => {
    const res = await http()
      .post(`${API}/api-clients`)
      .set(fx.admin.headers)
      .send({ name: 'reporting-agent', permissions: ['PRODUCTS_READ', 'PRODUCTS_READ'] })
      .expect(201);

    const { apiKey, id, keyPrefix } = res.body;
    expect(apiKey).toMatch(/^zk_[a-z0-9]{8}_[A-Za-z0-9_-]{32,}$/);
    expect(apiKey.startsWith(`zk_${keyPrefix}_`)).toBe(true);
    expect(res.body).toMatchObject({ name: 'reporting-agent', permissions: ['PRODUCTS_READ'], status: 'active' });

    const row = await prisma.apiClient.findUniqueOrThrow({ where: { id } });
    expect(row.keyHash).toHaveLength(64);
    expect(row.keyHash).not.toContain(apiKey.slice('zk_xxxxxxxx_'.length));
    expect(row.createdById).toBe(fx.admin.id);

    const me = await http().get(`${API}/auth/me`).set('X-API-Key', apiKey).expect(200);
    expect(me.body).toMatchObject({ type: 'AGENT', id, permissions: ['PRODUCTS_READ'] });

    const list = await http().get(`${API}/api-clients`).set(fx.admin.headers).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(apiKey);
    expect(JSON.stringify(list.body)).not.toContain(row.keyHash);

    const [entry] = await auditEntries(prisma, { resourceId: id });
    expect(entry).toMatchObject({ action: 'CREATE', resourceType: 'API_CLIENT', status: 'SUCCESS' });
    expect(JSON.stringify(entry)).not.toContain(apiKey);
    expect(JSON.stringify(entry)).not.toContain(row.keyHash);
  });

  it('never lets an agent be granted key-management rights', async () => {
    const res = await http()
      .post(`${API}/api-clients`)
      .set(fx.admin.headers)
      .send({ name: 'escalation-agent', permissions: ['API_CLIENTS_MANAGE'] })
      .expect(400);
    expect(res.body.details).toEqual([expect.objectContaining({ field: 'permissions' })]);
  });

  it.each([
    [{ permissions: ['PRODUCTS_READ'] }, 'name'],
    [{ name: 'no-perms', permissions: [] }, 'permissions'],
    [{ name: 'bad perm', permissions: ['EVERYTHING'] }, 'permissions'],
    [{ name: 'past', permissions: ['PRODUCTS_READ'], expiresAt: 'tomorrow' }, 'expiresAt'],
  ])('validates %j', async (body, field) => {
    const res = await http().post(`${API}/api-clients`).set(fx.admin.headers).send(body).expect(400);
    expect(res.body.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('rejects an expiry in the past and a duplicate name', async () => {
    await http()
      .post(`${API}/api-clients`)
      .set(fx.admin.headers)
      .send({ name: 'expired-agent', permissions: ['PRODUCTS_READ'], expiresAt: '2000-01-01T00:00:00Z' })
      .expect(400);
    await http()
      .post(`${API}/api-clients`)
      .set(fx.admin.headers)
      .send({ name: 'catalog-agent', permissions: ['PRODUCTS_READ'] })
      .expect(409);
  });

  it('revokes a key: it stops working immediately and cannot be revoked twice', async () => {
    const created = await http()
      .post(`${API}/api-clients`)
      .set(fx.admin.headers)
      .send({ name: 'short-lived-agent', permissions: ['CATEGORIES_READ'] })
      .expect(201);
    const { apiKey, id } = created.body;
    await http().get(`${API}/categories`).set('X-API-Key', apiKey).expect(200);

    await http().delete(`${API}/api-clients/${id}`).set(fx.admin.headers).expect(204);
    const denied = await http().get(`${API}/categories`).set('X-API-Key', apiKey).expect(401);
    expect(denied.body.message).toMatch(/revoked/i);

    await http().delete(`${API}/api-clients/${id}`).set(fx.admin.headers).expect(409);
    await http().delete(`${API}/api-clients/${MISSING_ID}`).set(fx.admin.headers).expect(404);

    const entries = await auditEntries(prisma, { resourceId: id, action: 'REVOKE' });
    expect(entries.map((e) => e.status)).toEqual(['SUCCESS', 'FAILURE']);

    const list = await http().get(`${API}/api-clients`).set(fx.admin.headers).expect(200);
    expect(list.body.data.find((c: { id: string }) => c.id === id)).toMatchObject({ status: 'revoked' });
  });

  it('rejects expired keys', async () => {
    const created = await http()
      .post(`${API}/api-clients`)
      .set(fx.admin.headers)
      .send({ name: 'expiring-agent', permissions: ['CATEGORIES_READ'] })
      .expect(201);
    await prisma.apiClient.update({ where: { id: created.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await http().get(`${API}/categories`).set('X-API-Key', created.body.apiKey).expect(401);
    expect(res.body.message).toMatch(/expired/i);
  });

  it('rejects a key whose secret part was tampered with', async () => {
    const tampered = fx.catalogAgent.key.slice(0, -4) + 'XXXX';
    await http().get(`${API}/categories`).set('X-API-Key', tampered).expect(401);
  });

  it('records when a key was last used', async () => {
    await prisma.apiClient.update({ where: { id: fx.readonlyAgent.id }, data: { lastUsedAt: null } });
    await http().get(`${API}/categories`).set(fx.readonlyAgent.headers).expect(200);

    // The update is fire-and-forget; poll briefly.
    for (let i = 0; i < 20; i++) {
      const row = await prisma.apiClient.findUniqueOrThrow({ where: { id: fx.readonlyAgent.id } });
      if (row.lastUsedAt) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('lastUsedAt was never set');
  });
});
