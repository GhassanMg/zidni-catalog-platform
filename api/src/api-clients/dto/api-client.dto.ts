import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiClient, Permission } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { Dedupe, Trim } from '../../common/dto/transforms';
import { AGENT_ASSIGNABLE_PERMISSIONS } from '../../auth/permissions';

export class CreateApiClientDto {
  @ApiProperty({ example: 'pricing-agent', minLength: 2, maxLength: 100 })
  @Trim()
  @IsString()
  @Length(2, 100)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/, {
    message: 'name may contain letters, digits, spaces, dots, dashes and underscores',
  })
  name: string;

  @ApiProperty({
    enum: AGENT_ASSIGNABLE_PERMISSIONS,
    isArray: true,
    example: [Permission.PRODUCTS_READ, Permission.CATEGORIES_READ, Permission.CATEGORIES_WRITE],
    description: 'Least privilege: grant only what the agent needs. API_CLIENTS_MANAGE is never assignable.',
  })
  @Dedupe()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AGENT_ASSIGNABLE_PERMISSIONS.length)
  @IsIn(AGENT_ASSIGNABLE_PERMISSIONS, { each: true })
  permissions: Permission[];

  @ApiPropertyOptional({ example: '2027-01-01T00:00:00.000Z', description: 'Optional expiry (must be in the future)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string;
}

export class ApiClientDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'catalog-agent' })
  name: string;

  @ApiProperty({ example: 'catalog1', description: 'Public, non-secret part of the key' })
  keyPrefix: string;

  @ApiProperty({ enum: Permission, enumName: 'Permission', isArray: true })
  permissions: Permission[];

  @ApiProperty({ enum: ['active', 'revoked', 'expired'] })
  status: 'active' | 'revoked' | 'expired';

  @ApiProperty({ nullable: true, type: Date })
  expiresAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  revokedAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  lastUsedAt: Date | null;

  @ApiProperty({ nullable: true, format: 'uuid', type: String })
  createdById: string | null;

  @ApiProperty()
  createdAt: Date;
}

export class CreatedApiClientDto extends ApiClientDto {
  @ApiProperty({
    example: 'zk_1a2b3c4d_Qm9yZ2V0LW1lLW5vdC10aGlzLWlzLW9ubHktYW4tZXhhbXBsZQ',
    description: 'The plaintext key. Returned ONLY in this response; store it securely.',
  })
  apiKey: string;
}

export function toApiClientDto(client: ApiClient, now = new Date()): ApiClientDto {
  const status = client.revokedAt
    ? 'revoked'
    : client.expiresAt && client.expiresAt <= now
      ? 'expired'
      : 'active';
  return {
    id: client.id,
    name: client.name,
    keyPrefix: client.keyPrefix,
    permissions: client.permissions,
    status,
    expiresAt: client.expiresAt,
    revokedAt: client.revokedAt,
    lastUsedAt: client.lastUsedAt,
    createdById: client.createdById,
    createdAt: client.createdAt,
  };
}
