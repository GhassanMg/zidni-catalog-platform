import { Permission, Role } from '@prisma/client';

export { Permission, Role };

/** Single source of truth for what each human role may do. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  [Role.ADMIN]: Object.values(Permission),
  [Role.USER]: [Permission.PRODUCTS_READ, Permission.CATEGORIES_READ],
};

/**
 * Permissions that may be granted to machine identities (AI agents).
 * API_CLIENTS_MANAGE is deliberately excluded: an agent must never be able to mint
 * or revoke credentials, which would let it escalate its own privileges.
 */
export const AGENT_ASSIGNABLE_PERMISSIONS: readonly Permission[] = [
  Permission.PRODUCTS_READ,
  Permission.PRODUCTS_WRITE,
  Permission.CATEGORIES_READ,
  Permission.CATEGORIES_WRITE,
  Permission.AUDIT_READ,
];

export function permissionsForRole(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
