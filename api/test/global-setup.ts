import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { loadTestEnv } from './test-env';

/** Brings the test database schema up to date once per run (same migrations as production). */
export default function globalSetup(): void {
  const env = { ...process.env, ...loadTestEnv() };
  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
