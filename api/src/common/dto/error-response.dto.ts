import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 404 })
  statusCode: number;

  @ApiProperty({ example: 'Not Found' })
  error: string;

  @ApiProperty({ example: 'Category not found' })
  message: string;

  @ApiPropertyOptional({
    description: 'Structured details (validation errors, missing ids, conflicting fields, ...)',
    example: [{ field: 'name', errors: ['name must be longer than or equal to 2 characters'] }],
  })
  details?: unknown;

  @ApiProperty({ example: '/api/v1/categories/9b2f...' })
  path: string;

  @ApiProperty({ example: '2026-10-15T20:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '1f0e7c1c-8b5e-4a4f-9a41-0b8f2b5c1d2e' })
  requestId: string;
}
