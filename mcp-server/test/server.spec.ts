import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CatalogApiClient } from '../src/api-client';
import { createMcpServer, visibleTools } from '../src/server';
import { TOOLS } from '../src/tools';

const CATEGORY = '0b6f1c3e-2a4d-4e5f-8a9b-1c2d3e4f5a6b';
const PRODUCT = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

interface Recorded {
  method: string;
  url: string;
  body: unknown;
  tool: string | undefined;
}

async function harness(response: () => Response = () => Response.json({ ok: true })) {
  const calls: Recorded[] = [];
  const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({
      method: String(init.method),
      url: url.replace('http://api.test/api/v1', ''),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      tool: headers['X-MCP-Tool'],
    });
    return response();
  });
  const api = new CatalogApiClient({
    baseUrl: 'http://api.test/api/v1',
    apiKey: 'zk_test1234_secret',
    maxRetries: 0,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const server = createMcpServer({ api, permissions: null });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'unit', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, calls };
}

describe('visibleTools', () => {
  it('shows everything when permissions are unknown', () => {
    expect(visibleTools(null)).toHaveLength(TOOLS.length);
  });

  it('filters by permission but always keeps whoami', () => {
    expect(visibleTools([]).map((t) => t.name)).toEqual(['whoami']);
    expect(visibleTools(['AUDIT_READ']).map((t) => t.name)).toEqual(['whoami', 'list_audit_logs']);
  });

  it('declares a permission for every tool except whoami', () => {
    for (const tool of TOOLS) {
      if (tool.name === 'whoami') expect(tool.permission).toBeNull();
      else expect(tool.permission).not.toBeNull();
    }
  });

  it('marks write tools as non-read-only and read tools as read-only', () => {
    for (const tool of TOOLS) {
      expect(tool.annotations.readOnlyHint).toBe(!tool.permission?.endsWith('_WRITE'));
    }
  });
});

describe('tool -> API mapping', () => {
  it.each([
    ['whoami', {}, 'GET', '/auth/me', undefined],
    ['list_categories', { search: 'toy', page: 2 }, 'GET', '/categories?search=toy&page=2', undefined],
    ['get_category', { id: CATEGORY }, 'GET', `/categories/${CATEGORY}`, undefined],
    ['list_products', { categoryId: CATEGORY, isActive: true }, 'GET', `/products?categoryId=${CATEGORY}&isActive=true`, undefined],
    ['get_product', { id: PRODUCT }, 'GET', `/products/${PRODUCT}`, undefined],
    ['create_category', { name: 'Toys', description: 'd' }, 'POST', '/categories', { name: 'Toys', description: 'd' }],
    ['update_category', { id: CATEGORY, name: 'New' }, 'PATCH', `/categories/${CATEGORY}`, { name: 'New' }],
    ['delete_category', { id: CATEGORY }, 'DELETE', `/categories/${CATEGORY}`, undefined],
    ['add_products_to_category', { categoryId: CATEGORY, productIds: [PRODUCT] }, 'PATCH', `/categories/${CATEGORY}/products`, { add: [PRODUCT] }],
    ['remove_products_from_category', { categoryId: CATEGORY, productIds: [PRODUCT] }, 'PATCH', `/categories/${CATEGORY}/products`, { remove: [PRODUCT] }],
    ['set_category_products', { categoryId: CATEGORY, productIds: [] }, 'PUT', `/categories/${CATEGORY}/products`, { productIds: [] }],
    ['list_audit_logs', { channel: 'MCP', status: 'FAILURE' }, 'GET', '/audit-logs?status=FAILURE&channel=MCP', undefined],
  ])('%s', async (name, args, method, url, body) => {
    const { client, calls } = await harness();
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([{ method, url, body, tool: name }]);
    await client.close();
  });

  it('covers every tool in the table above', () => {
    expect(TOOLS).toHaveLength(12);
  });

  it('returns API errors as tool errors with the original envelope', async () => {
    const { client } = await harness(() =>
      Response.json({ statusCode: 403, error: 'Forbidden', message: 'Missing required permission: CATEGORIES_WRITE' }, { status: 403 }),
    );
    const result = await client.callTool({ name: 'create_category', arguments: { name: 'Toys', description: 'd' } });
    expect(result.isError).toBe(true);
    const content = result.content as { text: string }[];
    expect(JSON.parse(content[0].text)).toEqual({
      error: { statusCode: 403, error: 'Forbidden', message: 'Missing required permission: CATEGORIES_WRITE' },
    });
    await client.close();
  });

  it('validates input before calling the API', async () => {
    const { client, calls } = await harness();
    const result = await client
      .callTool({ name: 'get_category', arguments: { id: 'nope' } })
      .then((r) => r.isError, () => true);
    expect(result).toBe(true);
    expect(calls).toEqual([]);
    await client.close();
  });
});
