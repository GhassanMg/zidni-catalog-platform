import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';

/**
 * Test environment = api/.env.test, with DATABASE_URL overridable via TEST_DATABASE_URL
 * (used by the dockerised test runner). A developer's own DATABASE_URL is deliberately
 * ignored so the suite can never truncate a non-test database.
 */
export function loadTestEnv(): Record<string, string> {
  const fileEnv = parse(readFileSync(join(__dirname, '..', '.env.test')));
  const databaseUrl = process.env.TEST_DATABASE_URL ?? fileEnv.DATABASE_URL;
  const dbName = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${dbName}": the name must end with "_test".`,
    );
  }
  return { ...fileEnv, DATABASE_URL: databaseUrl };
}
