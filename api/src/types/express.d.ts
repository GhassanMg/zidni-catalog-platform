import type { Principal } from '../auth/principal';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by AuthenticationGuard once credentials have been verified. */
      principal?: Principal;
    }
  }
}

export {};
