import { z } from 'zod';

const booleanString = z.stringbool();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgresql:// connection string'),
  DB_CONNECT_RETRIES: z.coerce.number().int().min(0).max(100).default(10),
  DB_CONNECT_RETRY_DELAY_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  JWT_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  JWT_ISSUER: z.string().min(1).default('zidni-catalog-api'),
  JWT_AUDIENCE: z.string().min(1).default('zidni-catalog-clients'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  TRUST_PROXY: booleanString.default(false),
  SWAGGER_ENABLED: booleanString.default(true),

  THROTTLE_ENABLED: booleanString.default(true),
  THROTTLE_TTL_MS: z.coerce.number().int().min(1_000).default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
