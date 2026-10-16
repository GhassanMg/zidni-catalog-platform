import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuditAction, AuditResource, Permission } from '@prisma/client';
import { Audited } from '../audit/audited.decorator';
import { ApiAuth, RequirePermissions } from '../auth/decorators';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { PaginatedResponseDto } from '../common/dto/pagination.dto';
import { ReqCtx } from '../common/request-context';
import type { RequestContext } from '../common/request-context';
import { CategoriesService } from './categories.service';
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

@ApiTags('Categories')
@ApiAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions(Permission.CATEGORIES_READ)
  @ApiOperation({ summary: 'List categories (paginated, searchable) with product counts' })
  @ApiOkResponse({ type: PaginatedResponseDto(CategoryDto) })
  @ApiErrors(400)
  list(@Query() query: ListCategoriesQueryDto) {
    return this.categories.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.CATEGORIES_READ)
  @ApiOperation({ summary: 'Get a category with its linked products' })
  @ApiOkResponse({ type: CategoryDetailDto })
  @ApiErrors(400, 404)
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<CategoryDetailDto> {
    return this.categories.findOne(id);
  }

  @Post()
  @RequirePermissions(Permission.CATEGORIES_WRITE)
  @Audited(AuditResource.CATEGORY, AuditAction.CREATE)
  @ApiOperation({ summary: 'Create a category, optionally linking products' })
  @ApiCreatedResponse({ type: CategoryDetailDto })
  @ApiErrors(400, 409, 422)
  create(@Body() dto: CreateCategoryDto, @ReqCtx() ctx: RequestContext): Promise<CategoryDetailDto> {
    return this.categories.create(dto, ctx);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CATEGORIES_WRITE)
  @Audited(AuditResource.CATEGORY, AuditAction.UPDATE)
  @ApiOperation({ summary: 'Update category name and/or description' })
  @ApiOkResponse({ type: CategoryDetailDto })
  @ApiErrors(400, 404, 409)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @ReqCtx() ctx: RequestContext,
  ): Promise<CategoryDetailDto> {
    return this.categories.update(id, dto, ctx);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.CATEGORIES_WRITE)
  @Audited(AuditResource.CATEGORY, AuditAction.DELETE)
  @ApiOperation({
    summary: 'Delete a category',
    description: 'Removes the category and its product links. Linked products are NOT deleted.',
  })
  @ApiNoContentResponse()
  @ApiErrors(400, 404)
  async remove(@Param('id', ParseUUIDPipe) id: string, @ReqCtx() ctx: RequestContext): Promise<void> {
    await this.categories.remove(id, ctx);
  }

  @Patch(':id/products')
  @RequirePermissions(Permission.CATEGORIES_WRITE)
  @Audited(AuditResource.CATEGORY, AuditAction.UPDATE_LINKS)
  @ApiOperation({
    summary: 'Link and/or unlink specific products (atomic)',
    description:
      'Adding an already-linked product or removing a non-linked one is a no-op (reported in the audit entry).',
  })
  @ApiOkResponse({ type: CategoryProductsResultDto })
  @ApiErrors(400, 404, 422)
  updateProducts(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryProductsDto,
    @ReqCtx() ctx: RequestContext,
  ): Promise<CategoryProductsResultDto> {
    return this.categories.updateProducts(id, dto, ctx);
  }

  @Put(':id/products')
  @RequirePermissions(Permission.CATEGORIES_WRITE)
  @Audited(AuditResource.CATEGORY, AuditAction.SET_LINKS)
  @ApiOperation({ summary: 'Replace the complete set of linked products (atomic)' })
  @ApiOkResponse({ type: CategoryProductsResultDto })
  @ApiErrors(400, 404, 422)
  setProducts(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCategoryProductsDto,
    @ReqCtx() ctx: RequestContext,
  ): Promise<CategoryProductsResultDto> {
    return this.categories.setProducts(id, dto, ctx);
  }

  @Delete(':id/products/:productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.CATEGORIES_WRITE)
  @Audited(AuditResource.CATEGORY, AuditAction.UPDATE_LINKS)
  @ApiOperation({ summary: 'Unlink a single product from the category' })
  @ApiNoContentResponse()
  @ApiErrors(400, 404)
  async removeProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @ReqCtx() ctx: RequestContext,
  ): Promise<void> {
    await this.categories.removeProduct(id, productId, ctx);
  }
}
