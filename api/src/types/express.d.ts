import type { Principal } from '../auth/principal';

declare global {
  namespace Express {
    interface Request {
      /** Set by AuthenticationGuard once credentials have been verified. */
      principal?: Principal;
    }
  }
}

export {};
