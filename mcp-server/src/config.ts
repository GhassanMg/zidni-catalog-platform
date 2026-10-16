import { z } from 'zod';

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);

export const configSchema = z.object({
  // 127.0.0.1 rather than localhost: avoids resolving to ::1 where another service may listen.
  API_BASE_URL: z.url().default('http://127.0.0.1:3000/api/v1'),
  AGENT_API_KEY: optionalString,
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  MCP_HTTP_HOST: z.string().default('127.0.0.1'),
  MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  MCP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
  MCP_HIDE_UNPERMITTED_TOOLS: z.stringbool().default(true),
});

export type McpConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid MCP server configuration:\n${issues}`);
  }
  return result.data;
}
