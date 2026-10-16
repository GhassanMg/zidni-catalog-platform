import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApiError, CatalogApiClient } from './api-client';
import { ApiCall, TOOLS, ToolDefinition } from './tools';

export const SERVER_INFO = { name: 'zidni-catalog', version: '1.0.0' } as const;

const INSTRUCTIONS = [
  'Tools for the Zidni product catalog (products, categories and their many-to-many links).',
  'Every call is executed by the catalog API under this session\'s agent identity: the API validates',
  'input, enforces permissions and records every write in an audit log attributed to the agent.',
  'Errors are returned verbatim from the API ({ statusCode, error, message, details }).',
  'A 403 means the agent lacks a permission - do not retry; a 422 lists ids that do not exist.',
].join(' ');

export interface CreateMcpServerOptions {
  api: CatalogApiClient;
  /**
   * Permissions of the agent (from whoami). When given, tools the agent cannot use are not
   * advertised (least privilege / less confusion for the model). When null, all tools are
   * listed - the API still rejects anything not permitted.
   */
  permissions?: readonly string[] | null;
}

export function createMcpServer({ api, permissions = null }: CreateMcpServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  for (const tool of visibleTools(permissions)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { title: tool.title, ...tool.annotations },
      },
      async (args) => runTool(tool, api, args as Record<string, unknown>),
    );
  }
  return server;
}

export function visibleTools(permissions: readonly string[] | null): ToolDefinition[] {
  return TOOLS.filter(
    (tool) => !permissions || !tool.permission || permissions.includes(tool.permission),
  );
}

async function runTool(
  tool: ToolDefinition,
  api: CatalogApiClient,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const call: ApiCall = (method, path, options) =>
    api.request(method, path, { ...options, tool: tool.name });
  try {
    return success(await tool.run(call, args));
  } catch (error) {
    if (error instanceof ApiError) return failure(error);
    console.error(`[mcp] tool ${tool.name} failed unexpectedly`, error);
    return failure(
      new ApiError(500, {
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'The MCP server failed to execute the tool',
      }),
    );
  }
}

function success(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data ?? { ok: true }, null, 2) }] };
}

function failure(error: ApiError): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: error.body }, null, 2) }],
  };
}
