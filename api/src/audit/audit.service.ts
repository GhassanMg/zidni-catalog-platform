import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  AuditAction,
  AuditLog,
  AuditResource,
  AuditStatus,
  Prisma,
} from '@prisma/client';
import type { Principal } from '../auth/principal';
import { paginate, Paginated, skipTake } from '../common/dto/pagination.dto';
import type { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { ListAuditLogsQueryDto } from './dto/audit-log.dto';

export interface AuditEntry {
  action: AuditAction;
  resourceType: AuditResource;
  resourceId: string | null;
  changes?: { before?: unknown; after?: unknown };
  metadata?: Record<string, unknown>;
  /** Overrides the request actor, e.g. self-registration where the actor is the created user. */
  actor?: Pick<Principal, 'type' | 'id' | 'label'>;
}

export interface AuditFailure {
  statusCode: number;
  message: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a successful write. MUST be given the transaction client of the mutation it
   * describes: the entry commits or rolls back together with the change, so the log can
   * never claim something happened that did not (or miss something that did).
   */
  async record(tx: Prisma.TransactionClient, ctx: RequestContext, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: this.toData(ctx, entry, AuditStatus.SUCCESS) });
  }

  /**
   * Records a rejected/failed write attempt (401/403/400/404/409/...). Written outside any
   * transaction (the mutation was rolled back or never started). Never throws: failing to
   * audit a failure must not replace the original error returned to the client.
   */
  async recordFailure(ctx: RequestContext, entry: AuditEntry, failure: AuditFailure): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: this.toData(
          ctx,
          {
            ...entry,
            metadata: {
              ...entry.metadata,
              statusCode: failure.statusCode,
              error: failure.message.slice(0, 500),
            },
          },
          AuditStatus.FAILURE,
        ),
      });
    } catch (error) {
      this.logger.error(
        `Failed to write FAILURE audit entry for ${entry.action} ${entry.resourceType}: ${
          (error as Error).message
        }`,
      );
    }
  }

  async list(query: ListAuditLogsQueryDto): Promise<Paginated<AuditLog>> {
    const where: Prisma.AuditLogWhereInput = {
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      actorType: query.actorType,
      actorId: query.actorId,
      action: query.action,
      status: query.status,
      channel: query.channel,
      createdAt:
        query.from || query.to
          ? {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            }
          : undefined,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...skipTake(query),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  private toData(
    ctx: RequestContext,
    entry: AuditEntry,
    status: AuditStatus,
  ): Prisma.AuditLogCreateInput {
    const actor = entry.actor ?? ctx.actor;
    const metadata = { ...entry.metadata, ...(ctx.mcpTool ? { mcpTool: ctx.mcpTool } : {}) };
    return {
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      status,
      actorType: actor?.type ?? ActorType.ANONYMOUS,
      actorId: actor?.id ?? null,
      actorLabel: actor?.label ?? null,
      channel: ctx.channel,
      requestId: ctx.requestId,
      ipAddress: ctx.ip,
      changes: entry.changes ? toJson(entry.changes) : undefined,
      metadata: Object.keys(metadata).length > 0 ? toJson(metadata) : undefined,
    };
  }
}

/** Dates -> ISO strings, Decimals -> strings, undefined dropped: exactly what JSON can hold. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
