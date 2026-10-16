import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ActorType,
  AuditAction,
  AuditResource,
  AuditStatus,
  Channel,
} from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AuditResource, enumName: 'AuditResource' })
  @IsOptional()
  @IsEnum(AuditResource)
  resourceType?: AuditResource;

  @ApiPropertyOptional({ description: 'Usually a resource UUID' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resourceId?: string;

  @ApiPropertyOptional({ enum: ActorType, enumName: 'ActorType' })
  @IsOptional()
  @IsEnum(ActorType)
  actorType?: ActorType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ enum: AuditAction, enumName: 'AuditAction' })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ enum: AuditStatus, enumName: 'AuditStatus' })
  @IsOptional()
  @IsEnum(AuditStatus)
  status?: AuditStatus;

  @ApiPropertyOptional({ enum: Channel, enumName: 'Channel' })
  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59Z' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class AuditLogDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: AuditAction, enumName: 'AuditAction' })
  action: AuditAction;

  @ApiProperty({ enum: AuditResource, enumName: 'AuditResource' })
  resourceType: AuditResource;

  @ApiProperty({ nullable: true, type: String })
  resourceId: string | null;

  @ApiProperty({ enum: AuditStatus, enumName: 'AuditStatus' })
  status: AuditStatus;

  @ApiProperty({ enum: ActorType, enumName: 'ActorType' })
  actorType: ActorType;

  @ApiProperty({ nullable: true, format: 'uuid', type: String })
  actorId: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'catalog-agent' })
  actorLabel: string | null;

  @ApiProperty({ enum: Channel, enumName: 'Channel' })
  channel: Channel;

  @ApiProperty({ nullable: true, type: String })
  requestId: string | null;

  @ApiProperty({ nullable: true, type: String })
  ipAddress: string | null;

  @ApiPropertyOptional({
    description: '{ before, after } snapshots of the resource',
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  changes: unknown;

  @ApiPropertyOptional({
    description: 'Operation details (link diff, MCP tool, HTTP status and error for failures)',
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  metadata: unknown;

  @ApiProperty()
  createdAt: Date;
}
