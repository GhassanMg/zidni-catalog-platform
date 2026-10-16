import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { NestExpressApplication } from '@nestjs/platform-express';
import { CatalogApiClient, createHttpApp, createMcpServer, loadConfig } from '@zidni/mcp-server';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  API,
  auditEntries,
  createCategory,
  createProduct,
  createTestApp,
  Fixtures,
  link,
  MISSING_ID,
  prismaOf,
  resetDatabase,
  seedFixtures,
} from './support/app';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

const json = (result: unknown) => JSON.parse((result as ToolResult).content[0].text);
const isError = (result: unknown) => (result as ToolResult).isError === true;

/**
 * End-to-end through the real stack: MCP client -> MCP server -> HTTP -> Nest API -> Postgres.
 * Nothing is mocked; this is what an AI agent experiences.
 */
describe('MCP server (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  let apiBaseUrl: string;
  const clients: Client[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    apiBaseUrl = `http://127.0.0.1:${port}${API}`;
    prisma = prismaOf(app);
    await resetDatabase(prisma);
    fx = await seedFixtures(app);
  });

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await app.close();
  });

  /** Connects an MCP client to a fresh server acting as the given agent. */
  async function connect(apiKey: string, options: { hideUnpermitted?: boolean } = {}) {
    const api = new CatalogApiClient({ baseUrl: apiBaseUrl, apiKey, maxRetries: 0 });
    const permissions =
      options.hideUnpermitted === false
        ? null
        : (await api.request<{ permissions: string[] }>('GET', '/auth/me')).permissions;
    const server = createMcpServer({ api, permissions });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'e2e-test-agent', version: '1.0.0' });
    await client.connect(clientTransport);
    clients.push(client);
    return client;
  }

  const toolNames = async (client: Client) => (await client.listTools()).tools.map((t) => t.name).sort();

  describe('tool discovery', () => {
    it('advertises exactly the tools each agent is permitted to use', async () => {
      expect(await toolNames(await connect(fx.catalogAgent.key))).toEqual(
        [
          'add_products_to_category',
          'create_category',
          'delete_category',
          'get_category',
          'get_product',
          'list_categories',
          'list_products',
          'remove_products_from_category',
          'set_category_products',
          'update_category',
          'whoami',
        ].sort(),
      );
      expect(await toolNames(await connect(fx.readonlyAgent.key))).toEqual(
        ['get_category', 'get_product', 'list_categories', 'list_products', 'whoami'].sort(),
      );
      expect(await toolNames(await connect(fx.productAgent.key))).toEqual(
        ['get_product', 'list_audit_logs', 'list_products', 'whoami'].sort(),
      );
    });

    it('publishes JSON schemas and behaviour hints for every tool', async () => {
      const { tools } = await (await connect(fx.catalogAgent.key)).listTools();
      const create = tools.find((t) => t.name === 'create_category')!;
      expect(create.inputSchema).toMatchObject({
        type: 'object',
        required: expect.arrayContaining(['name', 'description']),
        additionalProperties: false,
      });
      expect(create.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
      expect(tools.find((t) => t.name === 'delete_category')!.annotations).toMatchObject({
        destructiveHint: true,
      });
      expect(tools.find((t) => t.name === 'list_products')!.annotations).toMatchObject({ readOnlyHint: true });
    });
  });

  describe('reads', () => {
    it('whoami reports the agent identity', async () => {
      const client = await connect(fx.readonlyAgent.key);
      expect(json(await client.callTool({ name: 'whoami', arguments: {} }))).toMatchObject({
        type: 'AGENT',
        id: fx.readonlyAgent.id,
        label: 'readonly-agent',
        permissions: ['PRODUCTS_READ', 'CATEGORIES_READ'],
      });
    });

    it('lists and fetches products and categories', async () => {
      const category = await createCategory(prisma, { name: 'MCP Readable', slug: 'mcp-readable' });
      const product = await createProduct(prisma, { name: 'MCP Readable Product' });
      await link(prisma, product.id, category.id);
      const client = await connect(fx.readonlyAgent.key);

      const products = json(
        await client.callTool({ name: 'list_products', arguments: { categoryId: category.id, limit: 5 } }),
      );
      expect(products.meta.total).toBe(1);
      expect(products.data[0]).toMatchObject({ id: product.id, categories: [{ id: category.id }] });

      const detail = json(await client.callTool({ name: 'get_category', arguments: { id: category.id } }));
      expect(detail.products.map((p: { id: string }) => p.id)).toEqual([product.id]);

      const fetched = json(await client.callTool({ name: 'get_product', arguments: { id: product.id } }));
      expect(fetched.sku).toBe(product.sku);
    });

    it('passes API 404s through as tool errors', async () => {
      const client = await connect(fx.readonlyAgent.key);
      const result = await client.callTool({ name: 'get_category', arguments: { id: MISSING_ID } });
      expect(isError(result)).toBe(true);
      expect(json(result).error).toMatchObject({ statusCode: 404, message: 'Category not found' });
    });
  });

  describe('writes', () => {
    it('creates, updates and deletes categories, each audited as MCP with the tool name', async () => {
      const client = await connect(fx.catalogAgent.key);
      const product = await createProduct(prisma);

      const created = json(
        await client.callTool({
          name: 'create_category',
          arguments: { name: 'Agent Picks', description: 'Curated by an agent', productIds: [product.id] },
        }),
      );
      expect(created).toMatchObject({ slug: 'agent-picks', productCount: 1 });

      const updated = json(
        await client.callTool({
          name: 'update_category',
          arguments: { id: created.id, description: 'Re-curated' },
        }),
      );
      expect(updated.description).toBe('Re-curated');

      expect(json(await client.callTool({ name: 'delete_category', arguments: { id: created.id } }))).toEqual({
        deleted: true,
        id: created.id,
      });
      expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();

      const entries = await auditEntries(prisma, { resourceId: created.id });
      expect(entries.map((e) => [e.action, e.status, e.channel, e.actorId, (e.metadata as { mcpTool?: string })?.mcpTool])).toEqual([
        ['CREATE', 'SUCCESS', 'MCP', fx.catalogAgent.id, 'create_category'],
        ['UPDATE', 'SUCCESS', 'MCP', fx.catalogAgent.id, 'update_category'],
        ['DELETE', 'SUCCESS', 'MCP', fx.catalogAgent.id, 'delete_category'],
      ]);
      for (const entry of entries) expect(entry.requestId).toEqual(expect.any(String));
    });

    it('manages product links (add / remove / set) with an audit entry per change', async () => {
      const client = await connect(fx.catalogAgent.key);
      const category = await createCategory(prisma);
      const [a, b, c] = await Promise.all([createProduct(prisma), createProduct(prisma), createProduct(prisma)]);

      const added = json(
        await client.callTool({
          name: 'add_products_to_category',
          arguments: { categoryId: category.id, productIds: [a.id, b.id] },
        }),
      );
      expect(added.productIds).toEqual([a.id, b.id].sort());

      const removed = json(
        await client.callTool({
          name: 'remove_products_from_category',
          arguments: { categoryId: category.id, productIds: [a.id] },
        }),
      );
      expect(removed).toMatchObject({ productIds: [b.id], removed: [a.id] });

      const set = json(
        await client.callTool({
          name: 'set_category_products',
          arguments: { categoryId: category.id, productIds: [c.id] },
        }),
      );
      expect(set).toMatchObject({ productIds: [c.id], added: [c.id], removed: [b.id] });

      const tools = (await auditEntries(prisma, { resourceId: category.id })).map(
        (e) => (e.metadata as { mcpTool?: string }).mcpTool,
      );
      expect(tools).toEqual(['add_products_to_category', 'remove_products_from_category', 'set_category_products']);
    });

    it('returns 422 with the missing ids and changes nothing', async () => {
      const client = await connect(fx.catalogAgent.key);
      const category = await createCategory(prisma);
      const product = await createProduct(prisma);

      const result = await client.callTool({
        name: 'add_products_to_category',
        arguments: { categoryId: category.id, productIds: [product.id, MISSING_ID] },
      });
      expect(isError(result)).toBe(true);
      expect(json(result).error).toMatchObject({ statusCode: 422, details: { missingProductIds: [MISSING_ID] } });
      expect(await prisma.productCategory.count({ where: { categoryId: category.id } })).toBe(0);
    });

    it('returns 409 for a duplicate category name', async () => {
      await createCategory(prisma, { name: 'Taken Name', slug: 'taken-name' });
      const client = await connect(fx.catalogAgent.key);
      const result = await client.callTool({
        name: 'create_category',
        arguments: { name: 'taken name', description: 'dup' },
      });
      expect(json(result).error).toMatchObject({ statusCode: 409 });
    });
  });

  describe('cannot bypass the API', () => {
    it('is still forbidden when the server advertises tools the agent lacks (API enforces, audited)', async () => {
      const client = await connect(fx.readonlyAgent.key, { hideUnpermitted: false });
      expect(await toolNames(client)).toContain('create_category');

      const before = await prisma.category.count();
      const result = await client.callTool({
        name: 'create_category',
        arguments: { name: 'Sneaky Category', description: 'should not exist' },
      });
      expect(isError(result)).toBe(true);
      expect(json(result).error).toMatchObject({
        statusCode: 403,
        details: { missing: ['CATEGORIES_WRITE'] },
      });
      expect(await prisma.category.count()).toBe(before);

      const failures = await auditEntries(prisma, { actorId: fx.readonlyAgent.id, status: 'FAILURE' });
      expect(failures.at(-1)).toMatchObject({ action: 'CREATE', resourceType: 'CATEGORY', channel: 'MCP' });
      expect(failures.at(-1)?.metadata).toMatchObject({ statusCode: 403, mcpTool: 'create_category' });
    });

    it('applies the API business rules even when the MCP schema accepts the input', async () => {
      const client = await connect(fx.catalogAgent.key);
      // Passes the tool schema (2+ chars) but the API requires a letter or digit.
      const result = await client.callTool({
        name: 'create_category',
        arguments: { name: '!!', description: 'punctuation only' },
      });
      expect(isError(result)).toBe(true);
      expect(json(result).error.statusCode).toBe(400);
    });

    it('rejects malformed tool input before it reaches the API', async () => {
      const client = await connect(fx.catalogAgent.key);
      const before = await prisma.auditLog.count();
      const outcomes = await Promise.all(
        [
          { name: 'get_category', arguments: { id: 'not-a-uuid' } },
          { name: 'create_category', arguments: { name: 'Extra', description: 'x', slug: 'nope' } },
          { name: 'add_products_to_category', arguments: { categoryId: MISSING_ID, productIds: [] } },
        ].map((call) =>
          client.callTool(call).then(
            (result) => isError(result),
            () => true,
          ),
        ),
      );
      expect(outcomes).toEqual([true, true, true]);
      expect(await prisma.auditLog.count()).toBe(before);
    });

    it('rejects an unknown or revoked agent key at the API', async () => {
      const api = new CatalogApiClient({
        baseUrl: apiBaseUrl,
        apiKey: 'zk_aaaaaaaa_0000000000000000000000000000000000000000',
        maxRetries: 0,
      });
      await expect(api.request('GET', '/auth/me')).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('Streamable HTTP transport', () => {
    let mcpServer: Server;
    let mcpUrl: URL;

    beforeAll(async () => {
      const config = loadConfig({ API_BASE_URL: apiBaseUrl, MCP_TRANSPORT: 'http' });
      const httpApp = createHttpApp(config);
      await new Promise<void>((resolve) => {
        mcpServer = httpApp.listen(0, '127.0.0.1', () => resolve());
      });
      mcpUrl = new URL(`http://127.0.0.1:${(mcpServer.address() as AddressInfo).port}/mcp`);
    });

    afterAll(() => new Promise<void>((resolve) => mcpServer.close(() => resolve())));

    const rpc = (headers: Record<string, string> = {}) =>
      fetch(mcpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });

    it('serves an authenticated agent per request (key in the Authorization header)', async () => {
      const client = new Client({ name: 'http-e2e-agent', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(mcpUrl, {
          requestInit: { headers: { Authorization: `Bearer ${fx.catalogAgent.key}` } },
        }),
      );
      clients.push(client);

      expect(await toolNames(client)).toContain('create_category');
      const created = json(
        await client.callTool({
          name: 'create_category',
          arguments: { name: 'Over HTTP', description: 'via streamable http' },
        }),
      );
      const [entry] = await auditEntries(prisma, { resourceId: created.id });
      expect(entry).toMatchObject({ channel: 'MCP', actorId: fx.catalogAgent.id });
    });

    it('isolates agents sharing one deployment (each sees only its own tools)', async () => {
      const res = await rpc({ 'X-API-Key': fx.readonlyAgent.key });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.tools.map((t: { name: string }) => t.name)).not.toContain('create_category');
    });

    it('rejects requests without a key or with an invalid key', async () => {
      const missing = await rpc();
      expect(missing.status).toBe(401);
      expect((await missing.json()).error.code).toBe(-32001);

      const invalid = await rpc({ 'X-API-Key': 'zk_bbbbbbbb_1111111111111111111111111111111111111111' });
      expect(invalid.status).toBe(401);
    });

    it('is stateless: GET/DELETE on /mcp are 405', async () => {
      expect((await fetch(mcpUrl)).status).toBe(405);
      expect((await fetch(mcpUrl, { method: 'DELETE' })).status).toBe(405);
    });
  });
});
