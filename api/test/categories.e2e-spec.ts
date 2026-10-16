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
  link,
  MISSING_ID,
  prismaOf,
  resetDatabase,
  seedFixtures,
} from './support/app';

describe('Categories (e2e)', () => {
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

  describe('create', () => {
    it('creates a category with products, derives the slug and audits the snapshot', async () => {
      const p1 = await createProduct(prisma);
      const p2 = await createProduct(prisma);

      const res = await http()
        .post(`${API}/categories`)
        .set(fx.admin.headers)
        .send({ name: '  Home & Kitchen ', description: 'Pots and pans', productIds: [p1.id, p2.id, p1.id] })
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'Home & Kitchen',
        slug: 'home-kitchen',
        description: 'Pots and pans',
        productCount: 2,
      });
      expect(res.body.products.map((p: { id: string }) => p.id).sort()).toEqual([p1.id, p2.id].sort());

      const [entry] = await auditEntries(prisma, { resourceId: res.body.id });
      expect(entry).toMatchObject({
        action: 'CREATE',
        resourceType: 'CATEGORY',
        status: 'SUCCESS',
        actorType: 'USER',
        actorId: fx.admin.id,
        channel: 'REST',
      });
      expect(entry.changes).toMatchObject({
        after: { name: 'Home & Kitchen', productIds: [p1.id, p2.id].sort() },
      });
    });

    it('supports non-Latin names (Unicode-aware slug)', async () => {
      const res = await http()
        .post(`${API}/categories`)
        .set(fx.admin.headers)
        .send({ name: 'إلكترونيات منزلية', description: 'Arabic name' })
        .expect(201);
      // NFKD + mark stripping folds hamza-on-alef, so spelling variants share one slug.
      expect(res.body.slug).toBe('الكترونيات-منزلية');

      await http()
        .post(`${API}/categories`)
        .set(fx.admin.headers)
        .send({ name: 'الكترونيات منزلية', description: 'Same name, other spelling' })
        .expect(409);
    });

    it('returns 409 when the name collides with an existing slug (case/punctuation-insensitive)', async () => {
      await createCategory(prisma, { name: 'Garden Tools', slug: 'garden-tools' });
      const res = await http()
        .post(`${API}/categories`)
        .set(fx.admin.headers)
        .send({ name: 'GARDEN   tools!', description: 'dup' })
        .expect(409);
      expect(res.body).toMatchObject({ statusCode: 409, error: 'Conflict' });

      const failures = await auditEntries(prisma, { action: 'CREATE', resourceType: 'CATEGORY', status: 'FAILURE' });
      expect(failures.at(-1)?.metadata).toMatchObject({ statusCode: 409 });
    });

    it('returns 422 listing every unknown product id and writes nothing', async () => {
      const p1 = await createProduct(prisma);
      const other = 'a1b2c3d4-0000-4000-8000-000000000001';
      const before = await prisma.category.count();

      const res = await http()
        .post(`${API}/categories`)
        .set(fx.admin.headers)
        .send({ name: 'Ghost refs', description: 'x', productIds: [p1.id, MISSING_ID, other] })
        .expect(422);

      expect(res.body.details.missingProductIds.sort()).toEqual([MISSING_ID, other].sort());
      expect(await prisma.category.count()).toBe(before);
    });

    it.each([
      [{ description: 'no name' }, 'name'],
      [{ name: 'No description' }, 'description'],
      [{ name: 'x', description: 'too short name' }, 'name'],
      [{ name: '!!!', description: 'no letters' }, 'name'],
      [{ name: 'Bad ids', description: 'x', productIds: ['not-a-uuid'] }, 'productIds'],
      [{ name: 'Extra', description: 'x', slug: 'injected' }, 'slug'],
    ])('rejects invalid payload %j (field %s)', async (body, field) => {
      const res = await http().post(`${API}/categories`).set(fx.admin.headers).send(body).expect(400);
      expect(res.body.error).toBe('Bad Request');
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain(field);
    });
  });

  describe('read', () => {
    it('lists with pagination meta, product counts and search', async () => {
      const cat = await createCategory(prisma, { name: 'Searchable Widgets', slug: 'searchable-widgets' });
      await link(prisma, (await createProduct(prisma)).id, cat.id);

      const res = await http()
        .get(`${API}/categories`)
        .query({ search: 'searchable', limit: 5 })
        .set(fx.user.headers)
        .expect(200);

      expect(res.body.meta).toEqual({ page: 1, limit: 5, total: 1, totalPages: 1 });
      expect(res.body.data[0]).toMatchObject({ id: cat.id, productCount: 1 });
    });

    it('rejects out-of-range pagination', async () => {
      await http().get(`${API}/categories`).query({ limit: 101 }).set(fx.user.headers).expect(400);
      await http().get(`${API}/categories`).query({ page: 0 }).set(fx.user.headers).expect(400);
    });

    it('returns the category with its products', async () => {
      const cat = await createCategory(prisma);
      const product = await createProduct(prisma, { price: '19.90' });
      await link(prisma, product.id, cat.id);

      const res = await http().get(`${API}/categories/${cat.id}`).set(fx.user.headers).expect(200);
      expect(res.body.products).toEqual([
        expect.objectContaining({ id: product.id, sku: product.sku, price: '19.90' }),
      ]);
    });

    it('returns 404 for an unknown id and 400 for a malformed id', async () => {
      await http().get(`${API}/categories/${MISSING_ID}`).set(fx.user.headers).expect(404);
      await http().get(`${API}/categories/not-a-uuid`).set(fx.user.headers).expect(400);
    });
  });

  describe('update', () => {
    it('renames (re-deriving the slug) and records changed fields', async () => {
      const cat = await createCategory(prisma);
      const res = await http()
        .patch(`${API}/categories/${cat.id}`)
        .set(fx.admin.headers)
        .send({ name: 'Renamed Category' })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'Renamed Category', slug: 'renamed-category' });

      const [entry] = await auditEntries(prisma, { resourceId: cat.id, action: 'UPDATE' });
      expect(entry.metadata).toMatchObject({ changedFields: ['name', 'slug'] });
    });

    it('rejects an empty update and an unknown category', async () => {
      const cat = await createCategory(prisma);
      await http().patch(`${API}/categories/${cat.id}`).set(fx.admin.headers).send({}).expect(400);
      await http()
        .patch(`${API}/categories/${MISSING_ID}`)
        .set(fx.admin.headers)
        .send({ description: 'x' })
        .expect(404);
    });
  });

  describe('delete', () => {
    it('deletes the category and its links but keeps the products', async () => {
      const cat = await createCategory(prisma);
      const product = await createProduct(prisma);
      await link(prisma, product.id, cat.id);

      await http().delete(`${API}/categories/${cat.id}`).set(fx.admin.headers).expect(204);

      expect(await prisma.category.findUnique({ where: { id: cat.id } })).toBeNull();
      expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
      expect(await prisma.productCategory.count({ where: { categoryId: cat.id } })).toBe(0);

      const [entry] = await auditEntries(prisma, { resourceId: cat.id, action: 'DELETE' });
      expect(entry.metadata).toEqual({ unlinkedProductIds: [product.id] });

      await http().delete(`${API}/categories/${cat.id}`).set(fx.admin.headers).expect(404);
    });
  });

  describe('product links', () => {
    it('adds and removes incrementally (idempotent) and reports what actually changed', async () => {
      const cat = await createCategory(prisma);
      const [a, b, c] = await Promise.all([createProduct(prisma), createProduct(prisma), createProduct(prisma)]);
      await link(prisma, a.id, cat.id);
      const before = await prisma.category.findUniqueOrThrow({ where: { id: cat.id } });

      const res = await http()
        .patch(`${API}/categories/${cat.id}/products`)
        .set(fx.admin.headers)
        .send({ add: [a.id, b.id], remove: [c.id] })
        .expect(200);

      expect(res.body).toEqual({
        categoryId: cat.id,
        productIds: [a.id, b.id].sort(),
        added: [b.id],
        removed: [],
      });

      const after = await prisma.category.findUniqueOrThrow({ where: { id: cat.id } });
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());

      const [entry] = await auditEntries(prisma, { resourceId: cat.id, action: 'UPDATE_LINKS' });
      expect(entry.metadata).toEqual({
        added: [b.id],
        removed: [],
        alreadyLinked: [a.id],
        notLinked: [c.id],
      });
    });

    it('rejects an empty or contradictory link request', async () => {
      const cat = await createCategory(prisma);
      const p = await createProduct(prisma);
      await http().patch(`${API}/categories/${cat.id}/products`).set(fx.admin.headers).send({}).expect(400);
      const res = await http()
        .patch(`${API}/categories/${cat.id}/products`)
        .set(fx.admin.headers)
        .send({ add: [p.id], remove: [p.id] })
        .expect(400);
      expect(res.body.details).toEqual({ productIds: [p.id] });
    });

    it('returns 422 when adding unknown products, without partial writes', async () => {
      const cat = await createCategory(prisma);
      const p = await createProduct(prisma);
      const res = await http()
        .patch(`${API}/categories/${cat.id}/products`)
        .set(fx.admin.headers)
        .send({ add: [p.id, MISSING_ID] })
        .expect(422);
      expect(res.body.details).toEqual({ missingProductIds: [MISSING_ID] });
      expect(await prisma.productCategory.count({ where: { categoryId: cat.id } })).toBe(0);
    });

    it('replaces the whole set with PUT (and an empty set clears it)', async () => {
      const cat = await createCategory(prisma);
      const [a, b, c] = await Promise.all([createProduct(prisma), createProduct(prisma), createProduct(prisma)]);
      await link(prisma, a.id, cat.id);
      await link(prisma, b.id, cat.id);

      const res = await http()
        .put(`${API}/categories/${cat.id}/products`)
        .set(fx.admin.headers)
        .send({ productIds: [b.id, c.id] })
        .expect(200);
      expect(res.body).toMatchObject({ productIds: [b.id, c.id].sort(), added: [c.id], removed: [a.id] });

      const cleared = await http()
        .put(`${API}/categories/${cat.id}/products`)
        .set(fx.admin.headers)
        .send({ productIds: [] })
        .expect(200);
      expect(cleared.body.productIds).toEqual([]);

      const entries = await auditEntries(prisma, { resourceId: cat.id, action: 'SET_LINKS' });
      expect(entries).toHaveLength(2);
    });

    it('unlinks a single product and 404s when it is not linked', async () => {
      const cat = await createCategory(prisma);
      const p = await createProduct(prisma);
      await link(prisma, p.id, cat.id);

      await http().delete(`${API}/categories/${cat.id}/products/${p.id}`).set(fx.admin.headers).expect(204);
      await http().delete(`${API}/categories/${cat.id}/products/${p.id}`).set(fx.admin.headers).expect(404);
      expect(await prisma.product.findUnique({ where: { id: p.id } })).not.toBeNull();
    });

    it('serialises concurrent link changes on the same category (no lost updates)', async () => {
      const cat = await createCategory(prisma);
      const products = await Promise.all(Array.from({ length: 6 }, () => createProduct(prisma)));

      await Promise.all(
        products.map((p) =>
          http().patch(`${API}/categories/${cat.id}/products`).set(fx.admin.headers).send({ add: [p.id] }),
        ),
      );

      expect(await prisma.productCategory.count({ where: { categoryId: cat.id } })).toBe(products.length);
      expect(await auditEntries(prisma, { resourceId: cat.id, action: 'UPDATE_LINKS' })).toHaveLength(
        products.length,
      );
    });
  });
});
