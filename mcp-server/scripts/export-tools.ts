/**
 * Writes docs/mcp-tools.json: the exact tools/list response an agent receives (names,
 * descriptions, JSON Schemas, annotations), produced by the real server via the MCP SDK.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CatalogApiClient } from '../src/api-client';
import { createMcpServer, SERVER_INFO } from '../src/server';
import { TOOLS } from '../src/tools';

async function main(): Promise<void> {
  const api = new CatalogApiClient({ baseUrl: 'http://127.0.0.1/unused', apiKey: 'unused' });
  const server = createMcpServer({ api, permissions: null });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'tools-export', version: '1.0.0' });
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  await client.close();

  const permissionOf = new Map(TOOLS.map((tool) => [tool.name, tool.permission]));
  const output = {
    server: SERVER_INFO,
    tools: tools.map((tool) => ({ ...tool, 'x-required-permission': permissionOf.get(tool.name) })),
  };

  const target = resolve(process.argv[2] ?? resolve(process.cwd(), '..', 'docs', 'mcp-tools.json'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`${tools.length} MCP tools written to ${target}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
