import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  API,
  auditEntries,
  createTestApp,
  Fixtures,
  PASSWORDS,
  prismaOf,
  resetDatabase,
  seedFixtures,
} from './support/app';

describe('Authentication (e2e)', () => {
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

  describe('POST /auth/register', () => {
    it('creates a normal USER, normalises the e-mail and never returns the hash', async () => {
      const res = await http()
        .post(`${API}/auth/register`)
        .send({ email: '  Jane@Example.COM ', name: ' Jane ', password: 'Passw0rd!' })
        .expect(201);

      expect(res.body).toMatchObject({ email: 'jane@example.com', name: 'Jane', role: 'USER' });
      expect(res.body).not.toHaveProperty('passwordHash');

      const [entry] = await auditEntries(prisma, { action: 'CREATE', resourceType: 'USER' });
      expect(entry).toMatchObject({
        status: 'SUCCESS',
        resourceId: res.body.id,
        actorType: 'USER',
        actorId: res.body.id,
        channel: 'REST',
      });
      expect(JSON.stringify(entry.changes)).not.toContain('Passw0rd');
    });

    it('rejects attempts to self-assign a role (unknown fields are forbidden)', async () => {
      const res = await http()
        .post(`${API}/auth/register`)
        .send({ email: 'eve@example.com', name: 'Eve', password: 'Passw0rd!', role: 'ADMIN' })
        .expect(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'role' })]),
      );
    });

    it('returns field-level validation errors in the shared envelope', async () => {
      const res = await http()
        .post(`${API}/auth/register`)
        .send({ email: 'not-an-email', name: 'J', password: 'short' })
        .expect(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        path: `${API}/auth/register`,
      });
      expect(res.body.requestId).toEqual(expect.any(String));
      const fields = res.body.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['email', 'name', 'password']));
    });

    it('returns 409 for a duplicate e-mail (case-insensitive) and audits the failure', async () => {
      await http()
        .post(`${API}/auth/register`)
        .send({ email: 'USER@test.local', name: 'Dup', password: 'Passw0rd!' })
        .expect(409);
      const failures = await auditEntries(prisma, { resourceType: 'USER', status: 'FAILURE' });
      expect(failures.at(-1)?.metadata).toMatchObject({ statusCode: 409 });
    });
  });

  describe('POST /auth/login', () => {
    it('issues a bearer token', async () => {
      const res = await http()
        .post(`${API}/auth/login`)
        .send({ email: 'admin@test.local', password: PASSWORDS.admin })
        .expect(200);
      expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
      expect(res.body.accessToken.split('.')).toHaveLength(3);
    });

    it.each([
      ['wrong password', 'admin@test.local', 'nope-nope-1'],
      ['unknown e-mail', 'ghost@test.local', 'whatever-1'],
    ])('returns the same 401 for %s', async (_case, email, password) => {
      const res = await http().post(`${API}/auth/login`).send({ email, password }).expect(401);
      expect(res.body.message).toBe('Invalid e-mail or password');
    });

    it('rejects a deactivated account', async () => {
      await prisma.user.create({
        data: { email: 'off@test.local', name: 'Off', passwordHash: 'x', isActive: false },
      });
      await http()
        .post(`${API}/auth/login`)
        .send({ email: 'off@test.local', password: 'Passw0rd!' })
        .expect(401);
    });

    it('returns 400 with the shared envelope for malformed JSON', async () => {
      const res = await http()
        .post(`${API}/auth/login`)
        .set('Content-Type', 'application/json')
        .send('{"email":')
        .expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
      expect(res.body.requestId).toEqual(expect.any(String));
    });
  });

  describe('GET /auth/me', () => {
    it('describes a user principal with role-derived permissions', async () => {
      const res = await http().get(`${API}/auth/me`).set(fx.user.headers).expect(200);
      expect(res.body).toEqual({
        type: 'USER',
        id: fx.user.id,
        label: 'user@test.local',
        role: 'USER',
        permissions: ['PRODUCTS_READ', 'CATEGORIES_READ'],
      });
    });

    it('describes an agent principal with its granted permissions (X-API-Key)', async () => {
      const res = await http().get(`${API}/auth/me`).set(fx.catalogAgent.headers).expect(200);
      expect(res.body).toMatchObject({ type: 'AGENT', label: 'catalog-agent', role: null });
    });

    it('accepts the API key as a bearer token too', async () => {
      await http()
        .get(`${API}/auth/me`)
        .set('Authorization', `Bearer ${fx.catalogAgent.key}`)
        .expect(200);
    });

    it.each([
      ['no credentials', {}],
      ['garbage JWT', { Authorization: 'Bearer abc.def.ghi' }],
      ['non-bearer scheme', { Authorization: 'Basic Zm9vOmJhcg==' }],
      ['malformed API key', { 'X-API-Key': 'zk_short' }],
      ['unknown API key', { 'X-API-Key': 'zk_deadbeef_ThisKeyDoesNotExistAnywhere0123456789' }],
    ])('returns 401 for %s', async (_case, headers: Record<string, string>) => {
      const res = await http().get(`${API}/auth/me`).set(headers).expect(401);
      expect(res.body.statusCode).toBe(401);
    });

    it('rejects requests carrying both a JWT and an API key', async () => {
      await http()
        .get(`${API}/auth/me`)
        .set(fx.admin.headers)
        .set('X-API-Key', fx.catalogAgent.key)
        .expect(401);
    });

    it('rejects a token signed with another secret', async () => {
      const forged =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        Buffer.from(JSON.stringify({ sub: fx.admin.id, role: 'ADMIN' })).toString('base64url') +
        '.c2lnbmF0dXJl';
      await http().get(`${API}/auth/me`).set('Authorization', `Bearer ${forged}`).expect(401);
    });

    it('applies a role change immediately, without waiting for token expiry', async () => {
      const temp = await prisma.user.create({
        data: { email: 'temp@test.local', name: 'Temp', role: 'ADMIN', passwordHash: 'x' },
      });
      const token = await app.get(JwtService).signAsync({ sub: temp.id, role: 'ADMIN' });
      await http().get(`${API}/api-clients`).set('Authorization', `Bearer ${token}`).expect(200);

      await prisma.user.update({ where: { id: temp.id }, data: { role: 'USER' } });
      await http().get(`${API}/api-clients`).set('Authorization', `Bearer ${token}`).expect(403);

      await prisma.user.update({ where: { id: temp.id }, data: { isActive: false } });
      await http().get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`).expect(401);
    });
  });
});
