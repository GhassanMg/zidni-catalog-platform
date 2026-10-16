import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CategorySummaryDto } from '../../catalog/catalog.shared';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Dedupe, QueryBoolean, Trim, UpperCase } from '../../common/dto/transforms';

const MAX_CATEGORIES_PER_PRODUCT = 50;
const MAX_PRICE = 9_999_999_999.99;

/* ------------------------------------------------------------------ requests */

export class CreateProductDto {
  @ApiProperty({
    example: 'TOY-PUZZLE-1000',
    description: 'Stock keeping unit; normalised to upper case, unique',
    pattern: '^[A-Z0-9][A-Z0-9_-]{1,63}$',
  })
  @UpperCase()
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,63}$/, {
    message: 'sku must be 2-64 chars of A-Z, 0-9, "-" or "_", starting with a letter or digit',
  })
  sku: string;

  @ApiProperty({ example: '1000-piece Jigsaw Puzzle', minLength: 2, maxLength: 200 })
  @Trim()
  @IsString()
  @Length(2, 200)
  name: string;

  @ApiProperty({ example: 'Landscape jigsaw puzzle, 70x50cm.', maxLength: 5000 })
  @Trim()
  @IsString()
  @Length(1, 5000)
  description: string;

  @ApiProperty({
    example: 24.99,
    minimum: 0,
    maximum: MAX_PRICE,
    description: 'JSON number with at most 2 decimal places. Returned as a decimal string.',
  })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_PRICE)
  price: number;

  @ApiPropertyOptional({ example: 100, minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  stock?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: MAX_CATEGORIES_PER_PRODUCT,
    description: 'Categories to link. On update, replaces the full set when provided.',
  })
  @IsOptional()
  @Dedupe()
  @IsArray()
  @ArrayMaxSize(MAX_CATEGORIES_PER_PRODUCT)
  @IsUUID('all', { each: true })
  categoryIds?: string[];
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive match on name, SKU or description' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only products linked to this category' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  isActive?: boolean;
}

/* ------------------------------------------------------------------ responses */

export class ProductDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ELEC-HEADPHONES-01' })
  sku: string;

  @ApiProperty({ example: 'Wireless Noise-Cancelling Headphones' })
  name: string;

  @ApiProperty({ example: 'Over-ear Bluetooth headphones with 30h battery life.' })
  description: string;

  @ApiProperty({ example: '199.99', description: 'Decimal string with 2 decimal places' })
  price: string;

  @ApiProperty({ example: 42 })
  stock: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ type: [CategorySummaryDto] })
  categories: CategorySummaryDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
