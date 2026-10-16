import { parse } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads api/.env.test into process.env, overriding anything inherited from the shell so a
 * developer's DATABASE_URL can never leak into the tests. TEST_DATABASE_URL (used by the
 * dockerised test runner) is the only accepted override. Refuses to run against a database
 * whose name does not end in "_test", because every suite truncates all tables.
 */
export function loadTestEnv(): void {
  const values = parse(readFileSync(resolve(__dirname, '../../.env.test')));
  Object.assign(process.env, values);
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

  const database = new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '');
  if (!database.endsWith('_test')) {
    throw new Error(`Refusing to run tests against non-test database "${database}"`);
  }
}
