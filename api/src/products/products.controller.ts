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
import {
  CreateProductDto,
  ListProductsQueryDto,
  ProductDto,
  UpdateProductDto,
} from './dto/product.dto';
import { ProductsService } from './products.service';

@ApiTags('Products')
@ApiAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions(Permission.PRODUCTS_READ)
  @ApiOperation({ summary: 'List products with their categories (paginated, filterable)' })
  @ApiOkResponse({ type: PaginatedResponseDto(ProductDto) })
  @ApiErrors(400)
  list(@Query() query: ListProductsQueryDto) {
    return this.products.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.PRODUCTS_READ)
  @ApiOperation({ summary: 'Get a product with its categories' })
  @ApiOkResponse({ type: ProductDto })
  @ApiErrors(400, 404)
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ProductDto> {
    return this.products.findOne(id);
  }

  @Post()
  @RequirePermissions(Permission.PRODUCTS_WRITE)
  @Audited(AuditResource.PRODUCT, AuditAction.CREATE)
  @ApiOperation({ summary: 'Create a product, optionally linking categories' })
  @ApiCreatedResponse({ type: ProductDto })
  @ApiErrors(400, 409, 422)
  create(@Body() dto: CreateProductDto, @ReqCtx() ctx: RequestContext): Promise<ProductDto> {
    return this.products.create(dto, ctx);
  }

  @Patch(':id')
  @RequirePermissions(Permission.PRODUCTS_WRITE)
  @Audited(AuditResource.PRODUCT, AuditAction.UPDATE)
  @ApiOperation({
    summary: 'Partially update a product',
    description: 'When `categoryIds` is present it replaces the full set of linked categories.',
  })
  @ApiOkResponse({ type: ProductDto })
  @ApiErrors(400, 404, 409, 422)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @ReqCtx() ctx: RequestContext,
  ): Promise<ProductDto> {
    return this.products.update(id, dto, ctx);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.PRODUCTS_WRITE)
  @Audited(AuditResource.PRODUCT, AuditAction.DELETE)
  @ApiOperation({
    summary: 'Delete a product',
    description: 'Removes the product and its category links. Categories are NOT deleted.',
  })
  @ApiNoContentResponse()
  @ApiErrors(400, 404)
  async remove(@Param('id', ParseUUIDPipe) id: string, @ReqCtx() ctx: RequestContext): Promise<void> {
    await this.products.remove(id, ctx);
  }
}
