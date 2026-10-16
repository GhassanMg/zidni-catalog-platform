import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuditFailureRecorder } from '../../audit/audit-failure.recorder';
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
  const requires = (permissions: Permission[] | undefined) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(permissions);

  afterEach(() => jest.clearAllMocks());

  it('allows routes without requirements', async () => {
    requires(undefined);
    await expect(guard.canActivate(context())).resolves.toBe(true);
  });

  it('allows a principal holding every required permission', async () => {
    requires([Permission.CATEGORIES_WRITE]);
    await expect(
      guard.canActivate(context(agent([Permission.CATEGORIES_READ, Permission.CATEGORIES_WRITE]))),
    ).resolves.toBe(true);
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('rejects with the missing permissions and records the failure', async () => {
    requires([Permission.CATEGORIES_READ, Permission.CATEGORIES_WRITE]);
    const error = await guard.canActivate(context(agent([Permission.CATEGORIES_READ]))).catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toEqual({
      message: 'Missing required permission: CATEGORIES_WRITE',
      details: { required: ['CATEGORIES_READ', 'CATEGORIES_WRITE'], missing: ['CATEGORIES_WRITE'] },
    });
    expect(recorder.record).toHaveBeenCalledWith(expect.anything(), error);
  });

  it('treats a missing principal as unauthenticated', async () => {
    requires([Permission.PRODUCTS_READ]);
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
