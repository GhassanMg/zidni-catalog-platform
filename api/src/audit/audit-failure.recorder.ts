import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { toHttpError } from '../common/errors/http-error';
import { buildRequestContext } from '../common/request-context';
import { AuditService } from './audit.service';
import { AUDITED_KEY, AuditedOperation } from './audited.decorator';

/** Turns a rejected request on an @Audited route into a FAILURE audit entry. */
@Injectable()
export class AuditFailureRecorder {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async record(context: ExecutionContext, error: unknown): Promise<void> {
    if (context.getType() !== 'http') return;
    const operation = this.reflector.get<AuditedOperation | undefined>(
      AUDITED_KEY,
      context.getHandler(),
    );
    if (!operation) return;

    const req = context.switchToHttp().getRequest<Request>();
    const { statusCode, message } = toHttpError(error);
    const params = req.params ?? {};
    await this.audit.recordFailure(
      buildRequestContext(req),
      {
        action: operation.action,
        resourceType: operation.resource,
        resourceId: typeof params.id === 'string' ? params.id.slice(0, 64) : null,
        metadata: {
          method: req.method,
          path: req.originalUrl.split('?')[0],
          ...(typeof params.productId === 'string' ? { productId: params.productId.slice(0, 64) } : {}),
        },
      },
      { statusCode, message },
    );
  }
}
