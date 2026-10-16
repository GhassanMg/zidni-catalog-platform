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
import { PERMISSIONS_KEY } from '../decorators';
import { Permission } from '../permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditFailures: AuditFailureRecorder,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const required =
      this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length === 0) return true;

    const principal = context.switchToHttp().getRequest<Request>().principal;
    if (!principal) throw new UnauthorizedException('Authentication required');

    const missing = required.filter((permission) => !principal.permissions.includes(permission));
    if (missing.length > 0) {
      const error = new ForbiddenException({
        message: `Missing required permission: ${missing.join(', ')}`,
        details: { required, missing },
      });
      await this.auditFailures.record(context, error);
      throw error;
    }
    return true;
  }
}
