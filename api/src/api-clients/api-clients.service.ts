import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditResource } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { generateApiKey } from '../auth/api-key';
import { paginate, Paginated, PaginationQueryDto, skipTake } from '../common/dto/pagination.dto';
import type { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApiClientDto,
  CreateApiClientDto,
  CreatedApiClientDto,
  toApiClientDto,
} from './dto/api-client.dto';

@Injectable()
export class ApiClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateApiClientDto, ctx: RequestContext): Promise<CreatedApiClientDto> {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException('expiresAt must be in the future');
    }
    const { key, prefix, hash } = generateApiKey();

    return this.prisma.$transaction(async (tx) => {
      const client = await tx.apiClient.create({
        data: {
          name: dto.name,
          keyPrefix: prefix,
          keyHash: hash,
          permissions: dto.permissions,
          expiresAt,
          createdById: ctx.actor?.type === 'USER' ? ctx.actor.id : null,
        },
      });
      const snapshot = toApiClientDto(client);
      // The snapshot never contains key material (only the public prefix).
      await this.audit.record(tx, ctx, {
        action: AuditAction.CREATE,
        resourceType: AuditResource.API_CLIENT,
        resourceId: client.id,
        changes: { after: snapshot },
      });
      return { ...snapshot, apiKey: key };
    });
  }

  async list(query: PaginationQueryDto): Promise<Paginated<ApiClientDto>> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.apiClient.findMany({ orderBy: { createdAt: 'desc' }, ...skipTake(query) }),
      this.prisma.apiClient.count(),
    ]);
    const now = new Date();
    return paginate(
      rows.map((row) => toApiClientDto(row, now)),
      total,
      query,
    );
  }

  async revoke(id: string, ctx: RequestContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const client = await tx.apiClient.findUnique({ where: { id } });
      if (!client) throw new NotFoundException('API client not found');
      if (client.revokedAt) throw new ConflictException('API client is already revoked');
      const revoked = await tx.apiClient.update({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, ctx, {
        action: AuditAction.REVOKE,
        resourceType: AuditResource.API_CLIENT,
        resourceId: id,
        changes: { before: toApiClientDto(client), after: toApiClientDto(revoked) },
      });
    });
  }
}
