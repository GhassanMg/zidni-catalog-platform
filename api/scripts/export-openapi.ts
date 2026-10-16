/**
 * Writes the OpenAPI document to docs/openapi.json without a database or a listening server.
 * Runs from the compiled build (decorator metadata is required): `npm run openapi:export -w api`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Only needed to satisfy env validation; no connection is opened (no app.init()).
process.env.DATABASE_URL ??= 'postgresql://openapi:openapi@127.0.0.1:5432/openapi';
process.env.JWT_SECRET ??= 'openapi-export-placeholder-secret-0123456789';
process.env.LOG_LEVEL = 'silent';

async function main(): Promise<void> {
  const { NestFactory } = await import('@nestjs/core');
  // Imported after the env defaults above: config validation runs when AppModule loads.
  const { AppModule } = await import('../src/app.module.js');
  const { API_PREFIX, buildOpenApiDocument } = await import('../src/app.setup.js');

  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  app.setGlobalPrefix(API_PREFIX);
  const document = buildOpenApiDocument(app);
  await app.close();

  const target = resolve(process.argv[2] ?? resolve(process.cwd(), '..', 'docs', 'openapi.json'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`OpenAPI document written to ${target} (${Object.keys(document.paths).length} paths)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
