import type { ActorType, Permission, Role } from '@prisma/client';

/** The authenticated identity behind a request: a human user (JWT) or an AI agent (API key). */
export interface Principal {
  type: Extract<ActorType, 'USER' | 'AGENT'>;
  id: string;
  /** E-mail for users, client name for agents. Snapshotted into audit entries. */
  label: string;
  role: Role | null;
  permissions: Permission[];
}
