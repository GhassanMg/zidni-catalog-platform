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

describe('Products (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  const http = () => request(app.getHttpServer());

  const valid = (overrides: Record<string, unknown> = {}) => ({
    sku: `sku-${Math.random().toString(36).slice(2, 10)}`,
    name: 'Wooden Train Set',
    description: '32-piece wooden railway',
    price: 49.9,
    stock: 12,
    ...overrides,
  });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await resetDatabase(prisma);
    fx = await seedFixtures(app);
  });

  afterAll(() => app.close());

  describe('create', () => {
    it('normalises the SKU, returns price as a 2-dp string and links categories', async () => {
      const cat = await createCategory(prisma);
      const res = await http()
        .post(`${API}/products`)
        .set(fx.admin.headers)
        .send(valid({ sku: 'toy-train-01', categoryIds: [cat.id] }))
        .expect(201);

      expect(res.body).toMatchObject({
        sku: 'TOY-TRAIN-01',
        price: '49.90',
        stock: 12,
        isActive: true,
        categories: [{ id: cat.id, name: cat.name, slug: cat.slug }],
      });

      const [entry] = await auditEntries(prisma, { resourceId: res.body.id });
      expect(entry).toMatchObject({ action: 'CREATE', resourceType: 'PRODUCT', status: 'SUCCESS' });
      expect(entry.changes).toMatchObject({ after: { sku: 'TOY-TRAIN-01', price: '49.90', categoryIds: [cat.id] } });
    });

    it('defaults stock to 0 and isActive to true', async () => {
      const res = await http()
        .post(`${API}/products`)
        .set(fx.admin.headers)
        .send({ sku: 'DEFAULTS-1', name: 'Defaults', description: 'd', price: 0 })
        .expect(201);
      expect(res.body).toMatchObject({ stock: 0, isActive: true, price: '0.00', categories: [] });
    });

    it('returns 409 for a duplicate SKU (case-insensitive via normalisation)', async () => {
      await createProduct(prisma, { sku: 'DUP-SKU-1' });
      const res = await http()
        .post(`${API}/products`)
        .set(fx.admin.headers)
        .send(valid({ sku: 'dup-sku-1' }))
        .expect(409);
      expect(res.body).toMatchObject({ statusCode: 409, error: 'Conflict' });
    });

    it('returns 422 for unknown categories', async () => {
      const res = await http()
        .post(`${API}/products`)
        .set(fx.admin.headers)
        .send(valid({ categoryIds: [MISSING_ID] }))
        .expect(422);
      expect(res.body.details).toEqual({ missingCategoryIds: [MISSING_ID] });
    });

    it.each([
      ['negative price', { price: -1 }, 'price'],
      ['3 decimal places', { price: 1.999 }, 'price'],
      ['price as string', { price: '10.00' }, 'price'],
      ['price too large', { price: 1e11 }, 'price'],
      ['negative stock', { stock: -1 }, 'stock'],
      ['fractional stock', { stock: 1.5 }, 'stock'],
      ['bad sku characters', { sku: 'has space' }, 'sku'],
      ['sku too short', { sku: 'A' }, 'sku'],
      ['blank name', { name: '   ' }, 'name'],
      ['missing description', { description: undefined }, 'description'],
      ['unknown field', { color: 'red' }, 'color'],
    ])('rejects %s', async (_label, overrides, field) => {
      const res = await http().post(`${API}/products`).set(fx.admin.headers).send(valid(overrides)).expect(400);
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain(field);
    });
  });

  describe('read', () => {
    it('filters by search, category and active flag', async () => {
      const cat = await createCategory(prisma);
      const active = await createProduct(prisma, { name: 'Filterable Kite' });
      const inactive = await createProduct(prisma, { name: 'Filterable Yo-yo', isActive: false });
      await createProduct(prisma, { name: 'Filterable Unlinked' });
      await link(prisma, active.id, cat.id);
      await link(prisma, inactive.id, cat.id);

      const byCategory = await http()
        .get(`${API}/products`)
        .query({ categoryId: cat.id })
        .set(fx.user.headers)
        .expect(200);
      expect(byCategory.body.meta.total).toBe(2);

      const activeOnly = await http()
        .get(`${API}/products`)
        .query({ categoryId: cat.id, isActive: 'true' })
        .set(fx.user.headers)
        .expect(200);
      expect(activeOnly.body.data.map((p: { id: string }) => p.id)).toEqual([active.id]);

      const inactiveOnly = await http()
        .get(`${API}/products`)
        .query({ search: 'filterable', isActive: 'false' })
        .set(fx.user.headers)
        .expect(200);
      expect(inactiveOnly.body.data.map((p: { id: string }) => p.id)).toEqual([inactive.id]);
    });

    it('rejects an invalid boolean filter', async () => {
      await http().get(`${API}/products`).query({ isActive: 'maybe' }).set(fx.user.headers).expect(400);
    });

    it('returns 404 for an unknown product', async () => {
      const res = await http().get(`${API}/products/${MISSING_ID}`).set(fx.user.headers).expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, message: 'Product not found' });
    });
  });

  describe('update', () => {
    it('updates fields, replaces the category set and records changed fields', async () => {
      const [c1, c2] = await Promise.all([createCategory(prisma), createCategory(prisma)]);
      const product = await createProduct(prisma);
      await link(prisma, product.id, c1.id);

      const res = await http()
        .patch(`${API}/products/${product.id}`)
        .set(fx.admin.headers)
        .send({ price: 12.5, categoryIds: [c2.id] })
        .expect(200);
      expect(res.body.price).toBe('12.50');
      expect(res.body.categories.map((c: { id: string }) => c.id)).toEqual([c2.id]);

      const [entry] = await auditEntries(prisma, { resourceId: product.id, action: 'UPDATE' });
      expect(entry.metadata).toEqual({ changedFields: ['price', 'categoryIds'] });
    });

    it('keeps categories untouched when categoryIds is omitted', async () => {
      const cat = await createCategory(prisma);
      const product = await createProduct(prisma);
      await link(prisma, product.id, cat.id);

      const res = await http()
        .patch(`${API}/products/${product.id}`)
        .set(fx.admin.headers)
        .send({ stock: 99 })
        .expect(200);
      expect(res.body.categories).toHaveLength(1);
    });

    it('rejects an empty update, a SKU collision and unknown categories (atomically)', async () => {
      const other = await createProduct(prisma, { sku: 'TAKEN-SKU' });
      const product = await createProduct(prisma);

      await http().patch(`${API}/products/${product.id}`).set(fx.admin.headers).send({}).expect(400);
      await http()
        .patch(`${API}/products/${product.id}`)
        .set(fx.admin.headers)
        .send({ sku: other.sku })
        .expect(409);
      await http()
        .patch(`${API}/products/${product.id}`)
        .set(fx.admin.headers)
        .send({ name: 'Should not persist', categoryIds: [MISSING_ID] })
        .expect(422);

      const reloaded = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(reloaded.name).toBe(product.name);
    });
  });

  describe('delete', () => {
    it('deletes the product, keeps its categories and records the unlinked ids', async () => {
      const cat = await createCategory(prisma);
      const product = await createProduct(prisma);
      await link(prisma, product.id, cat.id);

      await http().delete(`${API}/products/${product.id}`).set(fx.admin.headers).expect(204);
      expect(await prisma.category.findUnique({ where: { id: cat.id } })).not.toBeNull();

      const [entry] = await auditEntries(prisma, { resourceId: product.id, action: 'DELETE' });
      expect(entry.metadata).toEqual({ unlinkedCategoryIds: [cat.id] });
    });
  });

  describe('database constraints (defence in depth)', () => {
    it('rejects invalid rows even when the API layer is bypassed', async () => {
      await expect(createProduct(prisma, { price: '-1.00' })).rejects.toThrow(/check constraint/i);
      await expect(createProduct(prisma, { stock: -5 })).rejects.toThrow(/check constraint/i);
      await expect(createProduct(prisma, { sku: 'lower-case' })).rejects.toThrow(/check constraint/i);
    });
  });
});
