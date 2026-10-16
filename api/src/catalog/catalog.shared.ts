import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';

/* ------------------------------------------------------------------ summaries */

export class ProductSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ELEC-HEADPHONES-01' })
  sku: string;

  @ApiProperty({ example: 'Wireless Noise-Cancelling Headphones' })
  name: string;

  @ApiProperty({ example: '199.99', description: 'Decimal string (2 dp) to avoid float rounding' })
  price: string;

  @ApiProperty()
  isActive: boolean;
}

export class CategorySummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Electronics' })
  name: string;

  @ApiProperty({ example: 'electronics' })
  slug: string;
}

export const productSummarySelect = {
  id: true,
  sku: true,
  name: true,
  price: true,
  isActive: true,
} satisfies Prisma.ProductSelect;

export const categorySummarySelect = {
  id: true,
  name: true,
  slug: true,
} satisfies Prisma.CategorySelect;

export function toProductSummary(
  product: Prisma.ProductGetPayload<{ select: typeof productSummarySelect }>,
): ProductSummaryDto {
  return { ...product, price: formatPrice(product.price) };
}

export function formatPrice(price: Prisma.Decimal): string {
  return price.toFixed(2);
}

/* ------------------------------------------------------------------ integrity */

/**
 * Row-locks the category for the rest of the transaction. Serialises concurrent writers
 * (e.g. two "set products" calls) so link diffs and audit snapshots are computed on a stable
 * state, and doubles as the existence check.
 */
export async function lockCategory(tx: Prisma.TransactionClient, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM categories WHERE id = ${id}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundException('Category not found');
}

export async function lockProduct(tx: Prisma.TransactionClient, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM products WHERE id = ${id}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundException('Product not found');
}

/** 422 listing every unknown id, so callers can fix the whole request in one go. */
export async function assertProductsExist(
  tx: Prisma.TransactionClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const found = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const missing = difference(ids, found.map((row) => row.id));
  if (missing.length > 0) {
    throw new UnprocessableEntityException({
      message: `${missing.length} referenced product(s) do not exist`,
      details: { missingProductIds: missing },
    });
  }
}

export async function assertCategoriesExist(
  tx: Prisma.TransactionClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const found = await tx.category.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const missing = difference(ids, found.map((row) => row.id));
  if (missing.length > 0) {
    throw new UnprocessableEntityException({
      message: `${missing.length} referenced category(ies) do not exist`,
      details: { missingCategoryIds: missing },
    });
  }
}

/** Elements of `a` not in `b`, preserving the order of `a`. */
export function difference(a: readonly string[], b: readonly string[]): string[] {
  const exclude = new Set(b);
  return a.filter((value) => !exclude.has(value));
}

export function intersection(a: readonly string[], b: readonly string[]): string[] {
  const include = new Set(b);
  return a.filter((value) => include.has(value));
}

export const sorted = (values: Iterable<string>): string[] => [...values].sort();
