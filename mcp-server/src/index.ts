#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiError, CatalogApiClient } from './api-client';
import { loadConfig } from './config';
import { createHttpApp } from './http';
import { createMcpServer } from './server';

// stdout is reserved for the MCP protocol in stdio mode: all diagnostics go to stderr.
const log = (message: string) => console.error(`[zidni-mcp] ${message}`);

async function startStdio(config: ReturnType<typeof loadConfig>): Promise<void> {
  if (!config.AGENT_API_KEY) {
    throw new Error('AGENT_API_KEY is required when MCP_TRANSPORT=stdio');
  }
  const api = new CatalogApiClient({
    baseUrl: config.API_BASE_URL,
    apiKey: config.AGENT_API_KEY,
    timeoutMs: config.MCP_REQUEST_TIMEOUT_MS,
  });

  let permissions: string[] | null = null;
  try {
    const me = await api.request<{ label: string; permissions: string[] }>('GET', '/auth/me');
    permissions = me.permissions;
    log(`authenticated as "${me.label}" with [${me.permissions.join(', ')}]`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new Error(`The catalog API rejected AGENT_API_KEY: ${error.body.message}`);
    }
    log(`could not reach the catalog API at start-up (${(error as Error).message}); exposing all tools`);
  }

  const server = createMcpServer({
    api,
    permissions: config.MCP_HIDE_UNPERMITTED_TOOLS ? permissions : null,
  });
  await server.connect(new StdioServerTransport());
  log(`stdio server ready (API: ${config.API_BASE_URL})`);
}

function startHttp(config: ReturnType<typeof loadConfig>): void {
  const app = createHttpApp(config);
  const httpServer = app.listen(config.MCP_HTTP_PORT, config.MCP_HTTP_HOST, () => {
    log(`Streamable HTTP server on http://${config.MCP_HTTP_HOST}:${config.MCP_HTTP_PORT}/mcp`);
  });
  const shutdown = () => httpServer.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.MCP_TRANSPORT === 'http') startHttp(config);
  else await startStdio(config);
}

main().catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
