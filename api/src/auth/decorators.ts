import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiExtension, ApiSecurity } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { Permission } from './permissions';

export const IS_PUBLIC_KEY = 'auth:public';
export const ALLOW_AUTHENTICATED_KEY = 'auth:allow-authenticated';
export const PERMISSIONS_KEY = 'auth:permissions';

/** Opts a route out of authentication (the global guard is deny-by-default). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Any authenticated principal may call this route; no specific permission is required.
 * The only current use is `GET /auth/me`, which describes the caller.
 */
export const AllowAuthenticated = () => SetMetadata(ALLOW_AUTHENTICATED_KEY, true);

/** Route requires ALL listed permissions. Also documented in OpenAPI as `x-required-permissions`. */
export const RequirePermissions = (...permissions: Permission[]) =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    ApiExtension('x-required-permissions', permissions),
    ApiErrors(403),
  );

/** OpenAPI: route accepts either a user JWT or an agent API key. */
export const ApiAuth = () =>
  applyDecorators(ApiBearerAuth('jwt'), ApiSecurity('api-key'), ApiErrors(401));

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request>().principal,
);
