import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditResource, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  assertCategoriesExist,
  categorySummarySelect,
  difference,
  formatPrice,
  lockProduct,
  sorted,
} from '../catalog/catalog.shared';
import { paginate, Paginated, skipTake } from '../common/dto/pagination.dto';
import type { RequestContext } from '../common/request-context';
import { changedFields } from '../common/utils/changed-fields';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProductDto,
  ListProductsQueryDto,
  ProductDto,
  UpdateProductDto,
} from './dto/product.dto';

const productInclude = {
  categories: {
    orderBy: { category: { name: 'asc' } },
    select: { category: { select: categorySummarySelect } },
  },
} satisfies Prisma.ProductInclude;

type ProductWithCategories = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ---------------------------------------------------------------- reads */

  async list(query: ListProductsQueryDto): Promise<Paginated<ProductDto>> {
    const where: Prisma.ProductWhereInput = {
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.categoryId ? { categories: { some: { categoryId: query.categoryId } } } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginate(rows.map(toProductDto), total, query);
  }

  async findOne(id: string): Promise<ProductDto> {
    const product = await this.prisma.product.findUnique({ where: { id }, include: productInclude });
    if (!product) throw new NotFoundException('Product not found');
    return toProductDto(product);
  }

  /* ---------------------------------------------------------------- writes */

  async create(dto: CreateProductDto, ctx: RequestContext): Promise<ProductDto> {
    const categoryIds = dto.categoryIds ?? [];
    return this.prisma.$transaction(async (tx) => {
      await assertCategoriesExist(tx, categoryIds);
      const created = await tx.product.create({
        data: {
          sku: dto.sku,
          name: dto.name,
          description: dto.description,
          price: new Prisma.Decimal(dto.price),
          stock: dto.stock ?? 0,
          isActive: dto.isActive ?? true,
          categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
        },
        include: productInclude,
      });
      const result = toProductDto(created);
      await this.audit.record(tx, ctx, {
        action: AuditAction.CREATE,
        resourceType: AuditResource.PRODUCT,
        resourceId: created.id,
        changes: { after: snapshot(result) },
      });
      return result;
    });
  }

  async update(id: string, dto: UpdateProductDto, ctx: RequestContext): Promise<ProductDto> {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException('Provide at least one field to update');
    }

    return this.prisma.$transaction(async (tx) => {
      await lockProduct(tx, id);
      const before = toProductDto(
        await tx.product.findUniqueOrThrow({ where: { id }, include: productInclude }),
      );

      if (dto.categoryIds !== undefined) {
        await assertCategoriesExist(tx, dto.categoryIds);
        const current = before.categories.map((c) => c.id);
        const toRemove = difference(current, dto.categoryIds);
        const toAdd = difference(dto.categoryIds, current);
        if (toRemove.length > 0) {
          await tx.productCategory.deleteMany({
            where: { productId: id, categoryId: { in: toRemove } },
          });
        }
        if (toAdd.length > 0) {
          await tx.productCategory.createMany({
            data: toAdd.map((categoryId) => ({ productId: id, categoryId })),
          });
        }
      }

      const updated = await tx.product.update({
        where: { id },
        data: {
          sku: dto.sku,
          name: dto.name,
          description: dto.description,
          price: dto.price !== undefined ? new Prisma.Decimal(dto.price) : undefined,
          stock: dto.stock,
          isActive: dto.isActive,
          // Always touch updatedAt, also when only the category set changed.
          updatedAt: new Date(),
        },
        include: productInclude,
      });
      const after = toProductDto(updated);
      await this.audit.record(tx, ctx, {
        action: AuditAction.UPDATE,
        resourceType: AuditResource.PRODUCT,
        resourceId: id,
        changes: { before: snapshot(before), after: snapshot(after) },
        metadata: { changedFields: changedFields(snapshot(before), snapshot(after)) },
      });
      return after;
    });
  }

  /** Deletes the product and its category links; the categories themselves are kept. */
  async remove(id: string, ctx: RequestContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockProduct(tx, id);
      const before = toProductDto(
        await tx.product.findUniqueOrThrow({ where: { id }, include: productInclude }),
      );
      await tx.product.delete({ where: { id } });
      await this.audit.record(tx, ctx, {
        action: AuditAction.DELETE,
        resourceType: AuditResource.PRODUCT,
        resourceId: id,
        changes: { before: snapshot(before) },
        metadata: { unlinkedCategoryIds: before.categories.map((c) => c.id) },
      });
    });
  }
}

function toProductDto(product: ProductWithCategories): ProductDto {
  const { categories, price, ...rest } = product;
  return {
    ...rest,
    price: formatPrice(price),
    categories: categories.map((link) => link.category),
  };
}

function snapshot(product: ProductDto) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    price: product.price,
    stock: product.stock,
    isActive: product.isActive,
    categoryIds: sorted(product.categories.map((c) => c.id)),
  };
}
