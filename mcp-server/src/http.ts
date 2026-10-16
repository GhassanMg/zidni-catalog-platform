import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type Request, type Response } from 'express';
import { ApiError, CatalogApiClient } from './api-client';
import type { McpConfig } from './config';
import { createMcpServer } from './server';

interface Whoami {
  permissions: string[];
}

/**
 * Stateless Streamable HTTP transport. Each POST carries its own agent API key, so one
 * deployment can serve many agents, each limited to its own permissions. No session state
 * means horizontal scaling and restarts need no coordination.
 */
export function createHttpApp(config: McpConfig, fetchImpl?: typeof fetch): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/mcp', async (req: Request, res: Response) => {
    const apiKey = extractApiKey(req);
    if (!apiKey) {
      res
        .status(401)
        .json(rpcError(-32001, 'Missing agent API key (Authorization: Bearer zk_... or X-API-Key)'));
      return;
    }

    const api = new CatalogApiClient({
      baseUrl: config.API_BASE_URL,
      apiKey,
      timeoutMs: config.MCP_REQUEST_TIMEOUT_MS,
      fetchImpl,
    });

    let permissions: string[] | null = null;
    try {
      permissions = (await api.request<Whoami>('GET', '/auth/me')).permissions;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        res.status(401).json(rpcError(-32001, error.body.message));
        return;
      }
      // API unreachable: still serve the protocol; tool calls will report the outage.
    }

    const server = createMcpServer({
      api,
      permissions: config.MCP_HIDE_UNPERMITTED_TOOLS ? permissions : null,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[mcp-http] request handling failed', error);
      if (!res.headersSent) res.status(500).json(rpcError(-32603, 'Internal server error'));
    }
  });

  const methodNotAllowed = (_req: Request, res: Response) => {
    res
      .status(405)
      .set('Allow', 'POST')
      .json(rpcError(-32000, 'Method not allowed: this server is stateless, use POST /mcp'));
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  return app;
}

function extractApiKey(req: Request): string | undefined {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const match = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}

function rpcError(code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}
