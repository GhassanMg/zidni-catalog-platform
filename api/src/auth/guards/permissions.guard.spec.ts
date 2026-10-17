import { METHOD_METADATA } from '@nestjs/common/constants';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiClientsController } from '../../api-clients/api-clients.controller';
import { AuditController } from '../../audit/audit.controller';
import { CategoriesController } from '../../categories/categories.controller';
import { HealthController } from '../../health/health.controller';
import { ProductsController } from '../../products/products.controller';
import type { AuditFailureRecorder } from '../../audit/audit-failure.recorder';
import { AuthController } from '../auth.controller';
import { ALLOW_AUTHENTICATED_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';
import type { Principal } from '../principal';
import { Permission } from '../permissions';
import { PermissionsGuard } from './permissions.guard';

function context(principal?: Principal): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
  } as unknown as ExecutionContext;
}

const agent = (permissions: Permission[]): Principal => ({
  type: 'AGENT',
  id: 'agent-id',
  label: 'agent',
  role: null,
  permissions,
});

describe('PermissionsGuard', () => {
  const reflector = new Reflector();
  const recorder = { record: jest.fn().mockResolvedValue(undefined) };
  const guard = new PermissionsGuard(reflector, recorder as unknown as AuditFailureRecorder);
  const policy = (values: { isPublic?: boolean; allowAuthenticated?: boolean; permissions?: Permission[] }) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === IS_PUBLIC_KEY) return values.isPublic ?? false;
      if (key === ALLOW_AUTHENTICATED_KEY) return values.allowAuthenticated ?? false;
      if (key === PERMISSIONS_KEY) return values.permissions;
      return undefined;
    });

  afterEach(() => jest.clearAllMocks());

  it('rejects an authenticated caller when the route declares no access policy', async () => {
    policy({});
    const error = await guard.canActivate(context(agent([]))).catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toEqual({
      message: 'Endpoint does not declare an access policy',
      details: { required: [], missing: [] },
    });
    expect(recorder.record).toHaveBeenCalledWith(expect.anything(), error);
  });

  it('allows a public route without a principal or a permission', async () => {
    policy({ isPublic: true });
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('allows any authenticated principal on an explicitly open route', async () => {
    policy({ allowAuthenticated: true });
    await expect(guard.canActivate(context(agent([])))).resolves.toBe(true);
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('still enforces permissions when a route is also marked allow-authenticated', async () => {
    policy({ allowAuthenticated: true, permissions: [Permission.CATEGORIES_WRITE] });
    await expect(guard.canActivate(context(agent([])))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a principal holding every required permission', async () => {
    policy({ permissions: [Permission.CATEGORIES_WRITE] });
    await expect(
      guard.canActivate(context(agent([Permission.CATEGORIES_READ, Permission.CATEGORIES_WRITE]))),
    ).resolves.toBe(true);
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('rejects with the missing permissions and records the failure', async () => {
    policy({ permissions: [Permission.CATEGORIES_READ, Permission.CATEGORIES_WRITE] });
    const error = await guard.canActivate(context(agent([Permission.CATEGORIES_READ]))).catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toEqual({
      message: 'Missing required permission: CATEGORIES_WRITE',
      details: { required: ['CATEGORIES_READ', 'CATEGORIES_WRITE'], missing: ['CATEGORIES_WRITE'] },
    });
    expect(recorder.record).toHaveBeenCalledWith(expect.anything(), error);
  });

  it('treats a missing principal as unauthenticated', async () => {
    policy({ permissions: [Permission.PRODUCTS_READ] });
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('treats a missing principal on an allow-authenticated route as unauthenticated', async () => {
    policy({ allowAuthenticated: true });
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

const CONTROLLERS = [
  AuthController,
  HealthController,
  ProductsController,
  CategoriesController,
  AuditController,
  ApiClientsController,
];

function routesOf(controller: new (...args: never[]) => object): string[] {
  return Object.getOwnPropertyNames(controller.prototype).filter(
    (name) => name !== 'constructor' && Reflect.getMetadata(METHOD_METADATA, controller.prototype[name]) !== undefined,
  );
}

/** Mirrors PermissionsGuard: method metadata overrides the controller. */
function accessPolicy(controller: new (...args: never[]) => object, methodName: string) {
  const handler = controller.prototype[methodName] as object;
  const read = <T>(key: string): T | undefined =>
    Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
  const permissions = read<Permission[]>(PERMISSIONS_KEY) ?? [];
  return {
    isPublic: read<boolean>(IS_PUBLIC_KEY) === true,
    allowAuthenticated: read<boolean>(ALLOW_AUTHENTICATED_KEY) === true,
    permissions,
  };
}

describe('controller access policies', () => {
  const routes = CONTROLLERS.flatMap((controller) =>
    routesOf(controller).map((method) => ({ controller, method, policy: accessPolicy(controller, method) })),
  );

  it('finds every HTTP handler', () => {
    expect(routes.map((route) => `${route.controller.name}.${route.method}`).sort()).toEqual([
      'ApiClientsController.create',
      'ApiClientsController.list',
      'ApiClientsController.revoke',
      'AuditController.list',
      'AuthController.login',
      'AuthController.me',
      'AuthController.register',
      'CategoriesController.create',
      'CategoriesController.findOne',
      'CategoriesController.list',
      'CategoriesController.remove',
      'CategoriesController.removeProduct',
      'CategoriesController.setProducts',
      'CategoriesController.update',
      'CategoriesController.updateProducts',
      'HealthController.live',
      'HealthController.ready',
      'ProductsController.create',
      'ProductsController.findOne',
      'ProductsController.list',
      'ProductsController.remove',
      'ProductsController.update',
    ]);
  });

  it('gives every route an explicit access policy', () => {
    const undeclared = routes
      .filter((route) => !route.policy.isPublic && !route.policy.allowAuthenticated && route.policy.permissions.length === 0)
      .map((route) => `${route.controller.name}.${route.method}`);
    expect(undeclared).toEqual([]);
  });

  it('uses allow-authenticated only for reading the caller', () => {
    const open = routes
      .filter((route) => route.policy.allowAuthenticated)
      .map((route) => `${route.controller.name}.${route.method}`);
    expect(open).toEqual(['AuthController.me']);
  });
});
