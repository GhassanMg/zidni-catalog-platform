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

type Who = 'anonymous' | 'admin' | 'user' | 'catalogAgent' | 'readonlyAgent' | 'productAgent';
type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

interface Route {
  name: string;
  /** Builds a fresh, otherwise-valid request so only authorization decides the outcome. */
  build: (prisma: PrismaService) => Promise<{ method: Method; path: string; body?: object }>;
  allowed: Who[];
  okStatus: number;
}

const EVERYONE_AUTHENTICATED: Who[] = ['admin', 'user', 'catalogAgent', 'readonlyAgent', 'productAgent'];
/** productAgent is deliberately granted no category permissions. */
const CATEGORY_READERS: Who[] = ['admin', 'user', 'catalogAgent', 'readonlyAgent'];
let seq = 0;
const next = () => `${Date.now().toString(36)}${seq++}`;

const ROUTES: Route[] = [
  {
    name: 'GET /products',
    build: async () => ({ method: 'get', path: '/products' }),
    allowed: EVERYONE_AUTHENTICATED,
    okStatus: 200,
  },
  {
    name: 'GET /products/:id',
    build: async (prisma) => ({ method: 'get', path: `/products/${(await createProduct(prisma)).id}` }),
    allowed: EVERYONE_AUTHENTICATED,
    okStatus: 200,
  },
  {
    name: 'POST /products',
    build: async () => ({
      method: 'post',
      path: '/products',
      body: { sku: `PERM-${next()}`, name: 'Perm product', description: 'd', price: 1 },
    }),
    allowed: ['admin', 'productAgent'],
    okStatus: 201,
  },
  {
    name: 'PATCH /products/:id',
    build: async (prisma) => ({
      method: 'patch',
      path: `/products/${(await createProduct(prisma)).id}`,
      body: { stock: 1 },
    }),
    allowed: ['admin', 'productAgent'],
    okStatus: 200,
  },
  {
    name: 'DELETE /products/:id',
    build: async (prisma) => ({ method: 'delete', path: `/products/${(await createProduct(prisma)).id}` }),
    allowed: ['admin', 'productAgent'],
    okStatus: 204,
  },
  {
    name: 'GET /categories',
    build: async () => ({ method: 'get', path: '/categories' }),
    allowed: CATEGORY_READERS,
    okStatus: 200,
  },
  {
    name: 'POST /categories',
    build: async () => ({
      method: 'post',
      path: '/categories',
      body: { name: `Perm category ${next()}`, description: 'd' },
    }),
    allowed: ['admin', 'catalogAgent'],
    okStatus: 201,
  },
  {
    name: 'PATCH /categories/:id',
    build: async (prisma) => ({
      method: 'patch',
      path: `/categories/${(await createCategory(prisma)).id}`,
      body: { description: 'changed' },
    }),
    allowed: ['admin', 'catalogAgent'],
    okStatus: 200,
  },
  {
    name: 'DELETE /categories/:id',
    build: async (prisma) => ({ method: 'delete', path: `/categories/${(await createCategory(prisma)).id}` }),
    allowed: ['admin', 'catalogAgent'],
    okStatus: 204,
  },
  {
    name: 'PATCH /categories/:id/products',
    build: async (prisma) => ({
      method: 'patch',
      path: `/categories/${(await createCategory(prisma)).id}/products`,
      body: { add: [(await createProduct(prisma)).id] },
    }),
    allowed: ['admin', 'catalogAgent'],
    okStatus: 200,
  },
  {
    name: 'PUT /categories/:id/products',
    build: async (prisma) => ({
      method: 'put',
      path: `/categories/${(await createCategory(prisma)).id}/products`,
      body: { productIds: [] },
    }),
    allowed: ['admin', 'catalogAgent'],
    okStatus: 200,
  },
  {
    name: 'GET /audit-logs',
    build: async () => ({ method: 'get', path: '/audit-logs' }),
    allowed: ['admin', 'productAgent'],
    okStatus: 200,
  },
  {
    name: 'GET /api-clients',
    build: async () => ({ method: 'get', path: '/api-clients' }),
    allowed: ['admin'],
    okStatus: 200,
  },
  {
    name: 'POST /api-clients',
    build: async () => ({
      method: 'post',
      path: '/api-clients',
      body: { name: `perm-agent-${next()}`, permissions: ['PRODUCTS_READ'] },
    }),
    allowed: ['admin'],
    okStatus: 201,
  },
];

const PRINCIPALS: Who[] = ['anonymous', ...EVERYONE_AUTHENTICATED];

describe('Authorization matrix (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let fx: Fixtures;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await resetDatabase(prisma);
    fx = await seedFixtures(app);
  });

  afterAll(() => app.close());

  const cases = ROUTES.flatMap((route) =>
    PRINCIPALS.map((who) => {
      const expected = route.allowed.includes(who) ? route.okStatus : who === 'anonymous' ? 401 : 403;
      return [route.name, who, expected, route] as const;
    }),
  );

  it.each(cases)('%s as %s -> %i', async (_name, who, expected, route) => {
    const { method, path, body } = await route.build(prisma);
    let req = request(app.getHttpServer())[method](`${API}${path}`).set(fx[who].headers);
    if (body) req = req.send(body);
    const res = await req;
    expect(res.status).toBe(expected);
  });

  it('explains which permission is missing', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/products`)
      .set(fx.catalogAgent.headers)
      .send({ sku: 'NOPE-1', name: 'Nope', description: 'd', price: 1 })
      .expect(403);
    expect(res.body).toMatchObject({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Missing required permission: PRODUCTS_WRITE',
      details: { required: ['PRODUCTS_WRITE'], missing: ['PRODUCTS_WRITE'] },
    });
    expect(res.body.requestId).toEqual(expect.any(String));
  });

  it('audits denied write attempts with the identity that tried (403)', async () => {
    const category = await createCategory(prisma);
    await request(app.getHttpServer())
      .delete(`${API}/categories/${category.id}`)
      .set(fx.readonlyAgent.headers)
      .set('X-Client-Channel', 'mcp')
      .set('X-MCP-Tool', 'delete_category')
      .expect(403);

    const [entry] = await auditEntries(prisma, { resourceId: category.id });
    expect(entry).toMatchObject({
      action: 'DELETE',
      resourceType: 'CATEGORY',
      status: 'FAILURE',
      actorType: 'AGENT',
      actorId: fx.readonlyAgent.id,
      actorLabel: 'readonly-agent',
      channel: 'MCP',
    });
    expect(entry.metadata).toMatchObject({ statusCode: 403, mcpTool: 'delete_category' });
    expect(await prisma.category.findUnique({ where: { id: category.id } })).not.toBeNull();
  });

  it('audits unauthenticated write attempts as ANONYMOUS (401)', async () => {
    const category = await createCategory(prisma);
    await request(app.getHttpServer())
      .patch(`${API}/categories/${category.id}`)
      .send({ description: 'x' })
      .expect(401);

    const [entry] = await auditEntries(prisma, { resourceId: category.id });
    expect(entry).toMatchObject({ status: 'FAILURE', actorType: 'ANONYMOUS', actorId: null, channel: 'REST' });
    expect(entry.metadata).toMatchObject({ statusCode: 401 });
  });

  it('does not audit denied reads (reads are not part of the write audit trail)', async () => {
    const before = await prisma.auditLog.count();
    await request(app.getHttpServer()).get(`${API}/api-clients`).set(fx.user.headers).expect(403);
    expect(await prisma.auditLog.count()).toBe(before);
  });

  it('keeps public endpoints public', async () => {
    await request(app.getHttpServer()).get(`${API}/health/live`).expect(200);
    await request(app.getHttpServer()).get(`${API}/health/ready`).expect(200);
  });
});
