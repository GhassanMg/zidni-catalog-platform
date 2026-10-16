import { AGENT_ASSIGNABLE_PERMISSIONS, Permission, permissionsForRole, Role } from './permissions';

describe('permissions', () => {
  it('gives admins every permission', () => {
    expect(permissionsForRole(Role.ADMIN).sort()).toEqual(Object.values(Permission).sort());
  });

  it('gives normal users read-only access to the catalog', () => {
    expect(permissionsForRole(Role.USER).sort()).toEqual(
      [Permission.CATEGORIES_READ, Permission.PRODUCTS_READ].sort(),
    );
  });

  it('never allows agents to manage credentials', () => {
    expect(AGENT_ASSIGNABLE_PERMISSIONS).not.toContain(Permission.API_CLIENTS_MANAGE);
  });

  it('returns a copy, so callers cannot mutate the role table', () => {
    permissionsForRole(Role.USER).push(Permission.PRODUCTS_WRITE);
    expect(permissionsForRole(Role.USER)).not.toContain(Permission.PRODUCTS_WRITE);
  });
});
