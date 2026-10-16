import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from '../auth.service';
import { IS_PUBLIC_KEY } from '../decorators';
import { extractCredential } from './credentials';

/** Global, deny-by-default authentication. Routes must opt out explicitly with @Public(). */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const credential = extractCredential(req);
    if (!credential) throw new UnauthorizedException('Authentication required');

    req.principal =
      credential.kind === 'api-key'
        ? await this.auth.authenticateApiKey(credential.value)
        : await this.auth.authenticateAccessToken(credential.value);
    return true;
  }
}
