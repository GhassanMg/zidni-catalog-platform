/**
 * Idempotent development seed: safe to run on every start (upserts by natural keys).
 * Creates an admin, a normal user, two AI-agent API clients and a small sample catalog.
 */
import { config as loadEnv } from 'dotenv';
import { Permission, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { hashApiKey, parseApiKey } from '../src/auth/api-key';
import { slugify } from '../src/common/utils/slugify';

loadEnv({ quiet: true });

const prisma = new PrismaClient();

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

const CATEGORIES = [
  { name: 'Electronics', description: 'Devices, gadgets and accessories.' },
  { name: 'Books', description: 'Printed and digital books across all genres.' },
  { name: 'Home & Kitchen', description: 'Everything for the home: cookware, decor and storage.' },
  { name: 'Outdoor', description: 'Gear for camping, hiking and outdoor sports.' },
];

const PRODUCTS = [
  {
    sku: 'ELEC-HEADPHONES-01',
    name: 'Wireless Noise-Cancelling Headphones',
    description: 'Over-ear Bluetooth headphones with 30h battery life.',
    price: '199.99',
    stock: 42,
    categories: ['Electronics'],
  },
  {
    sku: 'ELEC-LANTERN-01',
    name: 'Rechargeable LED Camping Lantern',
    description: 'USB-C rechargeable lantern with three brightness levels.',
    price: '34.50',
    stock: 120,
    categories: ['Electronics', 'Outdoor'],
  },
  {
    sku: 'BOOK-DDD-01',
    name: 'Domain-Driven Design',
    description: 'Tackling complexity in the heart of software.',
    price: '54.00',
    stock: 15,
    categories: ['Books'],
  },
  {
    sku: 'HOME-PAN-01',
    name: 'Cast Iron Skillet 26cm',
    description: 'Pre-seasoned cast iron pan suitable for all hobs.',
    price: '39.90',
    stock: 60,
    categories: ['Home & Kitchen', 'Outdoor'],
  },
  {
    sku: 'OUT-TENT-02',
    name: 'Two-Person Backpacking Tent',
    description: 'Lightweight 3-season tent, 1.9kg packed.',
    price: '249.00',
    stock: 8,
    categories: ['Outdoor'],
  },
];

async function seedUsers(rounds: number) {
  const users = [
    {
      email: env('SEED_ADMIN_EMAIL', 'admin@zidni.local').toLowerCase(),
      password: env('SEED_ADMIN_PASSWORD', 'Admin#12345'),
      name: 'Catalog Admin',
      role: Role.ADMIN,
    },
    {
      email: env('SEED_USER_EMAIL', 'user@zidni.local').toLowerCase(),
      password: env('SEED_USER_PASSWORD', 'User#123456'),
      name: 'Regular User',
      role: Role.USER,
    },
  ];

  const result = [];
  for (const user of users) {
    const passwordHash = await bcrypt.hash(user.password, rounds);
    result.push(
      await prisma.user.upsert({
        where: { email: user.email },
        update: { passwordHash, role: user.role, isActive: true, name: user.name },
        create: { email: user.email, passwordHash, role: user.role, name: user.name },
      }),
    );
  }
  return result;
}

async function seedAgents(createdById: string) {
  const agents = [
    {
      name: 'catalog-agent',
      key: env('SEED_CATALOG_AGENT_KEY', 'zk_catalog1_dev-catalog-agent-secret-change-me'),
      permissions: [
        Permission.PRODUCTS_READ,
        Permission.CATEGORIES_READ,
        Permission.CATEGORIES_WRITE,
      ],
    },
    {
      name: 'readonly-agent',
      key: env('SEED_READONLY_AGENT_KEY', 'zk_readonl1_dev-readonly-agent-secret-change-me'),
      permissions: [Permission.PRODUCTS_READ, Permission.CATEGORIES_READ],
    },
  ];

  for (const agent of agents) {
    const parsed = parseApiKey(agent.key);
    if (!parsed) throw new Error(`Seed key for ${agent.name} does not match zk_<prefix>_<secret>`);
    const data = {
      keyPrefix: parsed.prefix,
      keyHash: hashApiKey(agent.key),
      permissions: agent.permissions,
      revokedAt: null,
      expiresAt: null,
    };
    await prisma.apiClient.upsert({
      where: { name: agent.name },
      update: data,
      create: { name: agent.name, createdById, ...data },
    });
  }
  return agents.map(({ name, permissions }) => ({ name, permissions }));
}

async function seedCatalog() {
  const categoryIds = new Map<string, string>();
  for (const category of CATEGORIES) {
    const slug = slugify(category.name);
    const row = await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { ...category, slug },
    });
    categoryIds.set(category.name, row.id);
  }

  for (const { categories, ...product } of PRODUCTS) {
    const row = await prisma.product.upsert({
      where: { sku: product.sku },
      update: {},
      create: product,
    });
    await prisma.productCategory.createMany({
      data: categories.map((name) => ({ productId: row.id, categoryId: categoryIds.get(name)! })),
      skipDuplicates: true,
    });
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    console.log('Skipping seed in production (set SEED_ALLOW_PRODUCTION=true to override).');
    return;
  }
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 10);
  const [admin, user] = await seedUsers(rounds);
  const agents = await seedAgents(admin.id);
  await seedCatalog();

  console.log('Seed complete:');
  console.log(`  admin: ${admin.email}`);
  console.log(`  user:  ${user.email}`);
  for (const agent of agents) console.log(`  agent: ${agent.name} [${agent.permissions.join(', ')}]`);
  console.log(`  catalog: ${CATEGORIES.length} categories, ${PRODUCTS.length} products`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
