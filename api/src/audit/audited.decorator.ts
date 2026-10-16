import { SetMetadata } from '@nestjs/common';
import { AuditAction, AuditResource } from '@prisma/client';

export const AUDITED_KEY = 'audit:operation';

export interface AuditedOperation {
  resource: AuditResource;
  action: AuditAction;
}

/**
 * Marks a write endpoint. Successful executions are audited by the service inside the
 * mutation's transaction; rejected/failed attempts are audited automatically (guards,
 * validation, business-rule and database errors) using this metadata.
 */
export const Audited = (resource: AuditResource, action: AuditAction) =>
  SetMetadata(AUDITED_KEY, { resource, action } satisfies AuditedOperation);
