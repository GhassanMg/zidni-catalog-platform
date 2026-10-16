import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateApiClientDto, ctx: RequestContext): Promise<CreatedApiClientDto> {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException('expiresAt must be in the future');
    }
    const { key, prefix, hash } = generateApiKey();
    const client = await this.prisma.apiClient.create({
      data: {
        name: dto.name,
        keyPrefix: prefix,
        keyHash: hash,
        permissions: dto.permissions,
        expiresAt,
        createdById: ctx.actor?.type === 'USER' ? ctx.actor.id : null,
      },
    });
    return { ...toApiClientDto(client), apiKey: key };
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

  async revoke(id: string): Promise<void> {
    const client = await this.prisma.apiClient.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('API client not found');
    if (client.revokedAt) throw new ConflictException('API client is already revoked');
    await this.prisma.apiClient.update({ where: { id }, data: { revokedAt: new Date() } });
  }
}
