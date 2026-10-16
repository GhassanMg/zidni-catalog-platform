import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadTestEnv } from './test-env';

/** Brings the test database schema up to date once per run (suites truncate data themselves). */
export default function globalSetup(): void {
  loadTestEnv();
  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
}
