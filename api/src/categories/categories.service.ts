import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditResource, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  assertProductsExist,
  difference,
  intersection,
  lockCategory,
  productSummarySelect,
  sorted,
  toProductSummary,
} from '../catalog/catalog.shared';
import { paginate, Paginated, skipTake } from '../common/dto/pagination.dto';
import type { RequestContext } from '../common/request-context';
import { changedFields } from '../common/utils/changed-fields';
import { slugify } from '../common/utils/slugify';
import { PrismaService } from '../prisma/prisma.service';
import {
  CategoryDetailDto,
  CategoryDto,
  CategoryProductsResultDto,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  SetCategoryProductsDto,
  UpdateCategoryDto,
  UpdateCategoryProductsDto,
} from './dto/category.dto';

const detailInclude = {
  _count: { select: { products: true } },
  products: {
    orderBy: { product: { name: 'asc' } },
    select: { product: { select: productSummarySelect } },
  },
} satisfies Prisma.CategoryInclude;

type CategoryWithDetail = Prisma.CategoryGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ---------------------------------------------------------------- reads */

  async list(query: ListCategoriesQueryDto): Promise<Paginated<CategoryDto>> {
    const where: Prisma.CategoryWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        where,
        include: { _count: { select: { products: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.category.count({ where }),
    ]);
    return paginate(
      rows.map(({ _count, ...category }) => ({ ...category, productCount: _count.products })),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<CategoryDetailDto> {
    const category = await this.prisma.category.findUnique({ where: { id }, include: detailInclude });
    if (!category) throw new NotFoundException('Category not found');
    return toDetail(category);
  }

  /* ---------------------------------------------------------------- writes */

  async create(dto: CreateCategoryDto, ctx: RequestContext): Promise<CategoryDetailDto> {
    const slug = requireSlug(dto.name);
    const productIds = dto.productIds ?? [];

    return this.prisma.$transaction(async (tx) => {
      await assertProductsExist(tx, productIds);
      const created = await tx.category.create({
        data: {
          name: dto.name,
          slug,
          description: dto.description,
          products: { create: productIds.map((productId) => ({ productId })) },
        },
        include: detailInclude,
      });
      const result = toDetail(created);
      await this.audit.record(tx, ctx, {
        action: AuditAction.CREATE,
        resourceType: AuditResource.CATEGORY,
        resourceId: created.id,
        changes: { after: snapshot(result) },
      });
      return result;
    });
  }

  async update(id: string, dto: UpdateCategoryDto, ctx: RequestContext): Promise<CategoryDetailDto> {
    if (dto.name === undefined && dto.description === undefined) {
      throw new BadRequestException('Provide at least one field to update (name, description)');
    }

    return this.prisma.$transaction(async (tx) => {
      await lockCategory(tx, id);
      const before = toDetail(await tx.category.findUniqueOrThrow({ where: { id }, include: detailInclude }));
      const updated = await tx.category.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name, slug: requireSlug(dto.name) } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
        },
        include: detailInclude,
      });
      const after = toDetail(updated);
      await this.audit.record(tx, ctx, {
        action: AuditAction.UPDATE,
        resourceType: AuditResource.CATEGORY,
        resourceId: id,
        changes: { before: snapshot(before), after: snapshot(after) },
        metadata: { changedFields: changedFields(snapshot(before), snapshot(after)) },
      });
      return after;
    });
  }

  /** Deletes the category and its links; the linked products themselves are kept. */
  async remove(id: string, ctx: RequestContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockCategory(tx, id);
      const before = toDetail(await tx.category.findUniqueOrThrow({ where: { id }, include: detailInclude }));
      await tx.category.delete({ where: { id } });
      await this.audit.record(tx, ctx, {
        action: AuditAction.DELETE,
        resourceType: AuditResource.CATEGORY,
        resourceId: id,
        changes: { before: snapshot(before) },
        metadata: { unlinkedProductIds: before.products.map((p) => p.id) },
      });
    });
  }

  /** Incremental link change: add and/or remove specific products atomically. */
  async updateProducts(
    id: string,
    dto: UpdateCategoryProductsDto,
    ctx: RequestContext,
  ): Promise<CategoryProductsResultDto> {
    const add = dto.add ?? [];
    const remove = dto.remove ?? [];
    if (add.length === 0 && remove.length === 0) {
      throw new BadRequestException('Provide at least one product id in "add" or "remove"');
    }
    const overlap = intersection(add, remove);
    if (overlap.length > 0) {
      throw new BadRequestException({
        message: 'A product cannot be both added and removed in the same request',
        details: { productIds: overlap },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await lockCategory(tx, id);
      await assertProductsExist(tx, add);
      const current = await this.linkedProductIds(tx, id);
      const toAdd = difference(add, current);
      const toRemove = intersection(remove, current);
      await this.applyLinkDiff(tx, id, toAdd, toRemove);

      const result = buildLinkResult(id, current, toAdd, toRemove);
      await this.audit.record(tx, ctx, {
        action: AuditAction.UPDATE_LINKS,
        resourceType: AuditResource.CATEGORY,
        resourceId: id,
        changes: { before: { productIds: sorted(current) }, after: { productIds: result.productIds } },
        metadata: {
          added: result.added,
          removed: result.removed,
          alreadyLinked: intersection(add, current),
          notLinked: difference(remove, current),
        },
      });
      return result;
    });
  }

  /** Declarative link change: the category ends up linked to exactly `productIds`. */
  async setProducts(
    id: string,
    dto: SetCategoryProductsDto,
    ctx: RequestContext,
  ): Promise<CategoryProductsResultDto> {
    return this.prisma.$transaction(async (tx) => {
      await lockCategory(tx, id);
      await assertProductsExist(tx, dto.productIds);
      const current = await this.linkedProductIds(tx, id);
      const toAdd = difference(dto.productIds, current);
      const toRemove = difference(current, dto.productIds);
      await this.applyLinkDiff(tx, id, toAdd, toRemove);

      const result = buildLinkResult(id, current, toAdd, toRemove);
      await this.audit.record(tx, ctx, {
        action: AuditAction.SET_LINKS,
        resourceType: AuditResource.CATEGORY,
        resourceId: id,
        changes: { before: { productIds: sorted(current) }, after: { productIds: result.productIds } },
        metadata: { added: result.added, removed: result.removed },
      });
      return result;
    });
  }

  async removeProduct(id: string, productId: string, ctx: RequestContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockCategory(tx, id);
      const current = await this.linkedProductIds(tx, id);
      if (!current.includes(productId)) {
        throw new NotFoundException('Product is not linked to this category');
      }
      await this.applyLinkDiff(tx, id, [], [productId]);
      const result = buildLinkResult(id, current, [], [productId]);
      await this.audit.record(tx, ctx, {
        action: AuditAction.UPDATE_LINKS,
        resourceType: AuditResource.CATEGORY,
        resourceId: id,
        changes: { before: { productIds: sorted(current) }, after: { productIds: result.productIds } },
        metadata: { added: [], removed: [productId] },
      });
    });
  }

  /* ---------------------------------------------------------------- helpers */

  private async linkedProductIds(tx: Prisma.TransactionClient, categoryId: string): Promise<string[]> {
    const links = await tx.productCategory.findMany({
      where: { categoryId },
      select: { productId: true },
    });
    return links.map((link) => link.productId);
  }

  private async applyLinkDiff(
    tx: Prisma.TransactionClient,
    categoryId: string,
    toAdd: string[],
    toRemove: string[],
  ): Promise<void> {
    if (toRemove.length > 0) {
      await tx.productCategory.deleteMany({ where: { categoryId, productId: { in: toRemove } } });
    }
    if (toAdd.length > 0) {
      await tx.productCategory.createMany({
        data: toAdd.map((productId) => ({ categoryId, productId })),
      });
    }
    if (toAdd.length > 0 || toRemove.length > 0) {
      // Membership changes are a change to the category: bump updatedAt.
      await tx.category.update({ where: { id: categoryId }, data: { updatedAt: new Date() } });
    }
  }
}

function requireSlug(name: string): string {
  const slug = slugify(name);
  if (!slug) throw new BadRequestException('name must contain at least one letter or digit');
  return slug;
}

function toDetail(category: CategoryWithDetail): CategoryDetailDto {
  const { _count, products, ...rest } = category;
  return {
    ...rest,
    productCount: _count.products,
    products: products.map((link) => toProductSummary(link.product)),
  };
}

function snapshot(category: CategoryDetailDto) {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    productIds: sorted(category.products.map((p) => p.id)),
  };
}

function buildLinkResult(
  categoryId: string,
  current: string[],
  added: string[],
  removed: string[],
): CategoryProductsResultDto {
  const final = new Set(current);
  added.forEach((id) => final.add(id));
  removed.forEach((id) => final.delete(id));
  return { categoryId, productIds: sorted(final), added: sorted(added), removed: sorted(removed) };
}
