import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  API,
  auditEntries,
  createCategory,
  createProduct,
  createTestApp,
  Fixtures,
  prismaOf,
  resetDatabase,
  seedFixtures,
} from './support/app';

describe('Audit trail (e2e)', () => {
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

  it('records identity, channel, tool, request id and timestamp for an agent write over MCP', async () => {
    const res = await http()
      .post(`${API}/categories`)
      .set(fx.catalogAgent.headers)
      .set('X-Client-Channel', 'mcp')
      .set('X-MCP-Tool', 'create_category')
      .set('X-Request-Id', 'req-audit-0001')
      .send({ name: 'Agent Made', description: 'by MCP' })
      .expect(201);

    const [entry] = await auditEntries(prisma, { resourceId: res.body.id });
    expect(entry).toMatchObject({
      action: 'CREATE',
      resourceType: 'CATEGORY',
      status: 'SUCCESS',
      actorType: 'AGENT',
      actorId: fx.catalogAgent.id,
      actorLabel: 'catalog-agent',
      channel: 'MCP',
      requestId: 'req-audit-0001',
    });
    expect(entry.metadata).toEqual({ mcpTool: 'create_category' });
    expect(entry.createdAt).toBeInstanceOf(Date);
    expect(Date.now() - entry.createdAt.getTime()).toBeLessThan(60_000);
  });

  it('does not let a human user disguise REST traffic as MCP', async () => {
    const res = await http()
      .post(`${API}/categories`)
      .set(fx.admin.headers)
      .set('X-Client-Channel', 'mcp')
      .set('X-MCP-Tool', 'create_category')
      .send({ name: 'Human Made', description: 'by REST' })
      .expect(201);

    const [entry] = await auditEntries(prisma, { resourceId: res.body.id });
    expect(entry).toMatchObject({ actorType: 'USER', channel: 'REST' });
    expect(entry.metadata).toBeNull();
  });

  it('ignores malformed tool names', async () => {
    const res = await http()
      .post(`${API}/categories`)
      .set(fx.catalogAgent.headers)
      .set('X-Client-Channel', 'mcp')
      .set('X-MCP-Tool', "'; DROP TABLE users; --")
      .send({ name: 'Weird Tool', description: 'x' })
      .expect(201);
    const [entry] = await auditEntries(prisma, { resourceId: res.body.id });
    expect(entry).toMatchObject({ channel: 'MCP', metadata: null });
  });

  it('records a FAILURE entry for business-rule rejections and nothing else is written', async () => {
    const category = await createCategory(prisma);
    const product = await createProduct(prisma);
    await http()
      .patch(`${API}/categories/${category.id}/products`)
      .set(fx.catalogAgent.headers)
      .send({ add: [product.id], remove: [product.id] })
      .expect(400);

    const entries = await auditEntries(prisma, { resourceId: category.id });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'UPDATE_LINKS', status: 'FAILURE', actorType: 'AGENT' });
    expect(entries[0].metadata).toMatchObject({
      statusCode: 400,
      method: 'PATCH',
      path: `${API}/categories/${category.id}/products`,
    });
    expect(await prisma.productCategory.count({ where: { categoryId: category.id } })).toBe(0);
  });

  it('exposes the log with filters to holders of AUDIT_READ', async () => {
    const res = await http()
      .get(`${API}/audit-logs`)
      .query({ channel: 'MCP', actorType: 'AGENT', status: 'SUCCESS', resourceType: 'CATEGORY' })
      .set(fx.admin.headers)
      .expect(200);

    expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
    for (const row of res.body.data) {
      expect(row).toMatchObject({ channel: 'MCP', actorType: 'AGENT', status: 'SUCCESS', resourceType: 'CATEGORY' });
    }
    // Newest first.
    const times = res.body.data.map((row: { createdAt: string }) => Date.parse(row.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('filters by time window and validates filter values', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const res = await http().get(`${API}/audit-logs`).query({ from: future }).set(fx.admin.headers).expect(200);
    expect(res.body.data).toEqual([]);

    await http().get(`${API}/audit-logs`).query({ channel: 'SMTP' }).set(fx.admin.headers).expect(400);
    await http().get(`${API}/audit-logs`).query({ from: 'yesterday' }).set(fx.admin.headers).expect(400);
  });

  it('is append-only at the database level', async () => {
    const [entry] = await auditEntries(prisma);
    await expect(
      prisma.auditLog.update({ where: { id: entry.id }, data: { actorLabel: 'tampered' } }),
    ).rejects.toThrow(/append-only/i);
    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/i);
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/i);
  });

  it('never records SUCCESS for a mutation that did not commit', async () => {
    const before = await prisma.auditLog.count({ where: { status: 'SUCCESS' } });
    await http()
      .post(`${API}/products`)
      .set(fx.admin.headers)
      .send({ sku: fx.admin.id.slice(0, 8).toUpperCase(), name: 'First', description: 'd', price: 1 })
      .expect(201);
    await http()
      .post(`${API}/products`)
      .set(fx.admin.headers)
      .send({ sku: fx.admin.id.slice(0, 8).toUpperCase(), name: 'Dup', description: 'd', price: 1 })
      .expect(409);
    expect(await prisma.auditLog.count({ where: { status: 'SUCCESS' } })).toBe(before + 1);
  });
});
