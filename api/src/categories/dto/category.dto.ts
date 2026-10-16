import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { ProductSummaryDto } from '../../catalog/catalog.shared';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Dedupe, Trim } from '../../common/dto/transforms';

export const MAX_IDS_PER_REQUEST = 500;

/* ------------------------------------------------------------------ requests */

export class CreateCategoryDto {
  @ApiProperty({ example: 'Toys & Games', minLength: 2, maxLength: 100 })
  @Trim()
  @IsString()
  @Length(2, 100)
  @Matches(/[\p{L}\p{N}]/u, { message: 'name must contain at least one letter or digit' })
  name: string;

  @ApiProperty({ example: 'Board games, puzzles and toys for all ages.', maxLength: 2000 })
  @Trim()
  @IsString()
  @Length(1, 2000)
  description: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: MAX_IDS_PER_REQUEST,
    description: 'Products to link on creation. Duplicates are ignored; unknown ids -> 422.',
  })
  @IsOptional()
  @Dedupe()
  @IsArray()
  @ArrayMaxSize(MAX_IDS_PER_REQUEST)
  @IsUUID('all', { each: true })
  productIds?: string[];
}

export class UpdateCategoryDto extends PartialType(OmitType(CreateCategoryDto, ['productIds'])) {}

export class UpdateCategoryProductsDto {
  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'Product ids to link' })
  @IsOptional()
  @Dedupe()
  @IsArray()
  @ArrayMaxSize(MAX_IDS_PER_REQUEST)
  @IsUUID('all', { each: true })
  add?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'Product ids to unlink' })
  @IsOptional()
  @Dedupe()
  @IsArray()
  @ArrayMaxSize(MAX_IDS_PER_REQUEST)
  @IsUUID('all', { each: true })
  remove?: string[];
}

export class SetCategoryProductsDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'The complete set of products for the category ([] removes all links)',
  })
  @Dedupe()
  @IsArray()
  @ArrayMaxSize(MAX_IDS_PER_REQUEST)
  @IsUUID('all', { each: true })
  productIds: string[];
}

export class ListCategoriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive match on name or description' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/* ------------------------------------------------------------------ responses */

export class CategoryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Electronics' })
  name: string;

  @ApiProperty({ example: 'electronics', description: 'Derived from name; unique' })
  slug: string;

  @ApiProperty({ example: 'Devices, gadgets and accessories.' })
  description: string;

  @ApiProperty({ example: 12 })
  productCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class CategoryDetailDto extends CategoryDto {
  @ApiProperty({ type: [ProductSummaryDto] })
  products: ProductSummaryDto[];
}

export class CategoryProductsResultDto {
  @ApiProperty({ format: 'uuid' })
  categoryId: string;

  @ApiProperty({ type: [String], description: 'Final set of linked product ids (sorted)' })
  productIds: string[];

  @ApiProperty({ type: [String], description: 'Links created by this request' })
  added: string[];

  @ApiProperty({ type: [String], description: 'Links removed by this request' })
  removed: string[];
}
