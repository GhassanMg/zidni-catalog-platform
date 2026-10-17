import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuditFailureRecorder } from '../../audit/audit-failure.recorder';
import { ALLOW_AUTHENTICATED_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';
import { Permission } from '../permissions';

/**
 * Global, deny-by-default authorization. A route must opt in with one of:
 * `@Public()` (also skips authentication), `@AllowAuthenticated()`, or
 * `@RequirePermissions(...)`. A forgotten decorator is rejected, not exposed.
 * When both an allow-authenticated marker and permissions are present, the
 * permissions win.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditFailures: AuditFailureRecorder,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const principal = context.switchToHttp().getRequest<Request>().principal;
    if (!principal) throw new UnauthorizedException('Authentication required');

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets) ?? [];
    if (required.length === 0) {
      if (this.reflector.getAllAndOverride<boolean>(ALLOW_AUTHENTICATED_KEY, targets)) return true;
      await this.deny(context, {
        message: 'Endpoint does not declare an access policy',
        details: { required: [], missing: [] },
      });
    }

    const missing = required.filter((permission) => !principal.permissions.includes(permission));
    if (missing.length > 0) {
      await this.deny(context, {
        message: `Missing required permission: ${missing.join(', ')}`,
        details: { required, missing },
      });
    }
    return true;
  }

  private async deny(context: ExecutionContext, response: Record<string, unknown>): Promise<never> {
    const error = new ForbiddenException(response);
    await this.auditFailures.record(context, error);
    throw error;
  }
}
