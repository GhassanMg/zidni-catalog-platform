import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Permission, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { generateApiKey } from '../../src/auth/api-key';
import { PrismaService } from '../../src/prisma/prisma.service';

export const API = '/api/v1';

export interface Credentials {
  /** Ready-to-use request headers. */
  headers: Record<string, string>;
  id: string;
  label: string;
}

export interface Fixtures {
  anonymous: Credentials;
  admin: Credentials;
  user: Credentials;
  /** PRODUCTS_READ, CATEGORIES_READ, CATEGORIES_WRITE */
  catalogAgent: Credentials & { key: string };
  /** PRODUCTS_READ, CATEGORIES_READ */
  readonlyAgent: Credentials & { key: string };
  /** PRODUCTS_READ, PRODUCTS_WRITE, AUDIT_READ */
  productAgent: Credentials & { key: string };
}

export const PASSWORDS = { admin: 'Admin@12345', user: 'User@123456' };

/** Boots the real AppModule with the same global setup as production (main.ts). */
export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

export function prismaOf(app: NestExpressApplication): PrismaService {
  return app.get(PrismaService);
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  // TRUNCATE is not blocked by the audit_logs row-level immutability trigger (tests only).
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE audit_logs, product_categories, products, categories, api_clients, users CASCADE',
  );
}

export async function seedFixtures(app: NestExpressApplication): Promise<Fixtures> {
  const prisma = prismaOf(app);
  const http = request(app.getHttpServer());

  const admin = await prisma.user.create({
    data: {
      email: 'admin@test.local',
      name: 'Test Admin',
      role: Role.ADMIN,
      passwordHash: await bcrypt.hash(PASSWORDS.admin, 4),
    },
  });
  const user = await prisma.user.create({
    data: {
      email: 'user@test.local',
      name: 'Test User',
      role: Role.USER,
      passwordHash: await bcrypt.hash(PASSWORDS.user, 4),
    },
  });

  const agent = async (name: string, permissions: Permission[]) => {
    const { key, prefix, hash } = generateApiKey();
    const row = await prisma.apiClient.create({
      data: { name, keyPrefix: prefix, keyHash: hash, permissions, createdById: admin.id },
    });
    return { key, id: row.id, label: name, headers: { 'X-API-Key': key } };
  };

  const token = async (email: string, password: string) => {
    const res = await http.post(`${API}/auth/login`).send({ email, password }).expect(200);
    return res.body.accessToken as string;
  };

  return {
    anonymous: { headers: {}, id: '', label: 'anonymous' },
    admin: {
      id: admin.id,
      label: admin.email,
      headers: { Authorization: `Bearer ${await token(admin.email, PASSWORDS.admin)}` },
    },
    user: {
      id: user.id,
      label: user.email,
      headers: { Authorization: `Bearer ${await token(user.email, PASSWORDS.user)}` },
    },
    catalogAgent: await agent('catalog-agent', [
      Permission.PRODUCTS_READ,
      Permission.CATEGORIES_READ,
      Permission.CATEGORIES_WRITE,
    ]),
    readonlyAgent: await agent('readonly-agent', [
      Permission.PRODUCTS_READ,
      Permission.CATEGORIES_READ,
    ]),
    productAgent: await agent('product-agent', [
      Permission.PRODUCTS_READ,
      Permission.PRODUCTS_WRITE,
      Permission.AUDIT_READ,
    ]),
  };
}

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`.toUpperCase();

export async function createProduct(
  prisma: PrismaService,
  overrides: Partial<Prisma.ProductUncheckedCreateInput> = {},
) {
  const suffix = unique();
  return prisma.product.create({
    data: {
      sku: `SKU-${suffix}`,
      name: `Product ${suffix}`,
      description: 'A test product',
      price: new Prisma.Decimal('10.00'),
      stock: 5,
      ...overrides,
    },
  });
}

export async function createCategory(
  prisma: PrismaService,
  overrides: Partial<Prisma.CategoryUncheckedCreateInput> = {},
) {
  const suffix = unique().toLowerCase();
  return prisma.category.create({
    data: {
      name: `Category ${suffix}`,
      slug: `category-${suffix}`,
      description: 'A test category',
      ...overrides,
    },
  });
}

export async function link(prisma: PrismaService, productId: string, categoryId: string) {
  await prisma.productCategory.create({ data: { productId, categoryId } });
}

export async function auditEntries(prisma: PrismaService, where: Prisma.AuditLogWhereInput = {}) {
  return prisma.auditLog.findMany({ where, orderBy: { createdAt: 'asc' } });
}

export const MISSING_ID = '3f1b9a52-7d3e-4c1a-9b8e-2a6f0c4d5e71';
