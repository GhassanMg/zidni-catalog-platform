import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { Env } from './config/env';

export const API_PREFIX = 'api/v1';
export const DOCS_PATH = 'api/docs';

/** Shared by main.ts and the e2e tests so tests exercise the exact production pipeline. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  app.useBodyParser('json', { limit: '100kb' });
  app.disable('x-powered-by');
  if (config.get('TRUST_PROXY', { infer: true })) app.set('trust proxy', 1);

  app.use(
    helmet({
      // Swagger UI needs inline styles/scripts; the API itself only serves JSON.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
        },
      },
    }),
  );

  const origins = config.get('CORS_ORIGINS', { infer: true });
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-API-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    SwaggerModule.setup(DOCS_PATH, app, buildOpenApiDocument(app), {
      jsonDocumentUrl: `${DOCS_PATH}-json`,
      swaggerOptions: { persistAuthorization: true },
    });
  }
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Zidni Catalog API')
    .setDescription(
      [
        'Product & category management with role/permission-based access control.',
        '',
        '**Authentication** — humans: `POST /auth/login` then `Authorization: Bearer <jwt>`. ',
        'AI agents: `X-API-Key: zk_...` (or `Authorization: Bearer zk_...`).',
        '',
        '**Authorization** — every protected operation lists its required permissions under ',
        '`x-required-permissions`. ADMIN has all permissions; USER is read-only; agents have exactly ',
        'the permissions granted to their key.',
        '',
        '**Errors** — all errors share one envelope: `{ statusCode, error, message, details?, path, timestamp, requestId }`.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'api-key')
    .build();
  return SwaggerModule.createDocument(app, config);
}
