import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { HttpMethod, RequestOptions } from './api-client';

export type Permission =
  | 'PRODUCTS_READ'
  | 'PRODUCTS_WRITE'
  | 'CATEGORIES_READ'
  | 'CATEGORIES_WRITE'
  | 'AUDIT_READ';

/** An API call already bound to the agent's credentials and the calling tool's name. */
export type ApiCall = <T = unknown>(
  method: HttpMethod,
  path: string,
  options?: Omit<RequestOptions, 'tool'>,
) => Promise<T>;

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  /** Permission the API will demand. Used to hide tools; enforcement stays in the API. */
  permission: Permission | null;
  annotations: ToolAnnotations;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  run: (call: ApiCall, input: Record<string, unknown>) => Promise<unknown>;
}

function defineTool<S extends z.ZodRawShape>(tool: {
  name: string;
  title: string;
  description: string;
  permission: Permission | null;
  annotations: ToolAnnotations;
  input: S;
  run: (call: ApiCall, input: z.infer<z.ZodObject<S>>) => Promise<unknown>;
}): ToolDefinition {
  const { input, run, ...rest } = tool;
  return {
    ...rest,
    inputSchema: z.object(input).strict(),
    run: (call, args) => run(call, args as z.infer<z.ZodObject<S>>),
  };
}

const id = (what: string) => z.guid().describe(`${what} UUID`);
const ids = (what: string, min = 0) =>
  z
    .array(z.guid())
    .min(min)
    .max(500)
    .describe(`${what} UUIDs (duplicates are ignored, max 500)`);
const page = z.number().int().min(1).optional().describe('Page number, starting at 1 (default 1)');
const limit = z.number().int().min(1).max(100).optional().describe('Page size, 1-100 (default 20)');
const seg = encodeURIComponent;

const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const write = (extra: Partial<ToolAnnotations>): ToolAnnotations => ({
  readOnlyHint: false,
  openWorldHint: false,
  ...extra,
});

export const TOOLS: readonly ToolDefinition[] = [
  /* ------------------------------------------------------------- identity */
  defineTool({
    name: 'whoami',
    title: 'Who am I',
    description:
      'Returns the identity this MCP session acts as and the permissions granted to it. Call this first if unsure what you are allowed to do.',
    permission: null,
    annotations: READ,
    input: {},
    run: (call) => call('GET', '/auth/me'),
  }),

  /* ------------------------------------------------------------- reads */
  defineTool({
    name: 'list_categories',
    title: 'List categories',
    description:
      'Paginated list of categories (name, slug, description, productCount). Use get_category for the linked products.',
    permission: 'CATEGORIES_READ',
    annotations: READ,
    input: {
      search: z.string().max(100).optional().describe('Case-insensitive match on name/description'),
      page,
      limit,
    },
    run: (call, input) => call('GET', '/categories', { query: input }),
  }),
  defineTool({
    name: 'get_category',
    title: 'Get category',
    description: 'A single category including every linked product (id, sku, name, price, isActive).',
    permission: 'CATEGORIES_READ',
    annotations: READ,
    input: { id: id('Category') },
    run: (call, { id: categoryId }) => call('GET', `/categories/${seg(categoryId)}`),
  }),
  defineTool({
    name: 'list_products',
    title: 'List products',
    description:
      'Paginated list of products, each with its categories. Filter by text, category or active flag.',
    permission: 'PRODUCTS_READ',
    annotations: READ,
    input: {
      search: z.string().max(100).optional().describe('Case-insensitive match on name/SKU/description'),
      categoryId: id('Only products in this category').optional(),
      isActive: z.boolean().optional(),
      page,
      limit,
    },
    run: (call, input) => call('GET', '/products', { query: input }),
  }),
  defineTool({
    name: 'get_product',
    title: 'Get product',
    description: 'A single product including all of its categories.',
    permission: 'PRODUCTS_READ',
    annotations: READ,
    input: { id: id('Product') },
    run: (call, { id: productId }) => call('GET', `/products/${seg(productId)}`),
  }),

  /* ------------------------------------------------------------- category writes */
  defineTool({
    name: 'create_category',
    title: 'Create category',
    description:
      'Creates a category, optionally linking existing products. Names must be unique (case/punctuation-insensitive).',
    permission: 'CATEGORIES_WRITE',
    annotations: write({ destructiveHint: false, idempotentHint: false }),
    input: {
      name: z.string().min(2).max(100),
      description: z.string().min(1).max(2000),
      productIds: ids('Products to link').optional(),
    },
    run: (call, input) => call('POST', '/categories', { body: input }),
  }),
  defineTool({
    name: 'update_category',
    title: 'Update category',
    description: 'Changes the name and/or description of a category. Provide at least one of them.',
    permission: 'CATEGORIES_WRITE',
    annotations: write({ destructiveHint: false, idempotentHint: true }),
    input: {
      id: id('Category'),
      name: z.string().min(2).max(100).optional(),
      description: z.string().min(1).max(2000).optional(),
    },
    run: (call, { id: categoryId, ...body }) =>
      call('PATCH', `/categories/${seg(categoryId)}`, { body }),
  }),
  defineTool({
    name: 'delete_category',
    title: 'Delete category',
    description:
      'Deletes a category and its product links. The products themselves are NOT deleted.',
    permission: 'CATEGORIES_WRITE',
    annotations: write({ destructiveHint: true, idempotentHint: true }),
    input: { id: id('Category') },
    run: async (call, { id: categoryId }) => {
      await call('DELETE', `/categories/${seg(categoryId)}`);
      return { deleted: true, id: categoryId };
    },
  }),

  /* ------------------------------------------------------------- relationship writes */
  defineTool({
    name: 'add_products_to_category',
    title: 'Add products to category',
    description:
      'Links products to a category. Already-linked products are left as they are. Fails without changes if any product id does not exist.',
    permission: 'CATEGORIES_WRITE',
    annotations: write({ destructiveHint: false, idempotentHint: true }),
    input: { categoryId: id('Category'), productIds: ids('Products to link', 1) },
    run: (call, { categoryId, productIds }) =>
      call('PATCH', `/categories/${seg(categoryId)}/products`, { body: { add: productIds } }),
  }),
  defineTool({
    name: 'remove_products_from_category',
    title: 'Remove products from category',
    description: 'Unlinks products from a category. Products not currently linked are ignored.',
    permission: 'CATEGORIES_WRITE',
    annotations: write({ destructiveHint: true, idempotentHint: true }),
    input: { categoryId: id('Category'), productIds: ids('Products to unlink', 1) },
    run: (call, { categoryId, productIds }) =>
      call('PATCH', `/categories/${seg(categoryId)}/products`, { body: { remove: productIds } }),
  }),
  defineTool({
    name: 'set_category_products',
    title: 'Set category products',
    description:
      'Replaces the complete set of products linked to a category (an empty list removes all links). Returns what was added and removed.',
    permission: 'CATEGORIES_WRITE',
    annotations: write({ destructiveHint: true, idempotentHint: true }),
    input: { categoryId: id('Category'), productIds: ids('The full set of products') },
    run: (call, { categoryId, productIds }) =>
      call('PUT', `/categories/${seg(categoryId)}/products`, { body: { productIds } }),
  }),

  /* ------------------------------------------------------------- audit */
  defineTool({
    name: 'list_audit_logs',
    title: 'List audit logs',
    description: 'Queries the append-only audit trail of write operations (newest first).',
    permission: 'AUDIT_READ',
    annotations: READ,
    input: {
      resourceType: z.enum(['PRODUCT', 'CATEGORY', 'USER', 'API_CLIENT']).optional(),
      resourceId: z.string().max(64).optional(),
      actorId: id('Actor').optional(),
      action: z
        .enum(['CREATE', 'UPDATE', 'DELETE', 'UPDATE_LINKS', 'SET_LINKS', 'REVOKE'])
        .optional(),
      status: z.enum(['SUCCESS', 'FAILURE']).optional(),
      channel: z.enum(['REST', 'MCP']).optional(),
      from: z.iso.datetime({ offset: true }).optional().describe('ISO-8601 lower bound'),
      to: z.iso.datetime({ offset: true }).optional().describe('ISO-8601 upper bound'),
      page,
      limit,
    },
    run: (call, input) => call('GET', '/audit-logs', { query: input }),
  }),
];
