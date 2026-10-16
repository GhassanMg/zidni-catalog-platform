# MCP server

`mcp-server` exposes the catalog to AI agents as [Model Context Protocol](https://modelcontextprotocol.io)
tools. It is a thin, authenticated client of the REST API: every tool call becomes **one** REST
request made with the agent's own API key, so validation, authorization, business rules and audit
logging are exactly those of the API ([why](DECISIONS.md#2-architecture-the-mcp-server-is-just-another-api-client)).

```mermaid
sequenceDiagram
  participant A as AI agent
  participant M as mcp-server
  participant API as Catalog API
  participant DB as PostgreSQL
  A->>M: tools/call create_category {name, description}
  M->>M: validate input (zod, strict)
  M->>API: POST /api/v1/categories<br/>X-API-Key, X-Client-Channel: mcp, X-MCP-Tool, X-Request-Id
  API->>API: authenticate key → permissions guard → validation pipe
  API->>DB: BEGIN; insert category + links; insert audit_logs (channel MCP, tool, agent); COMMIT
  API-->>M: 201 {category}
  M-->>A: tool result (JSON)
  Note over API,DB: On 401/403/400/404/409/422 a FAILURE audit entry is written<br/>and the error envelope is returned to the agent verbatim (isError)
```

## Connecting

| Transport | Use | Authentication |
| --- | --- | --- |
| **stdio** | Desktop agents that spawn the server (Cursor, Claude Desktop) | `AGENT_API_KEY` env var (one agent per process) |
| **Streamable HTTP** (stateless) | Shared deployment, `http://localhost:3001/mcp` in Docker | `Authorization: Bearer zk_...` or `X-API-Key` **per request** |

Client configuration snippets are in the [README](../README.md#connecting-an-ai-agent).

| Env var | Default | Meaning |
| --- | --- | --- |
| `API_BASE_URL` | `http://127.0.0.1:3000/api/v1` | Catalog API base URL |
| `AGENT_API_KEY` | — | Agent key (stdio only; HTTP takes it per request) |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` | `127.0.0.1` / `3001` | HTTP bind address |
| `MCP_REQUEST_TIMEOUT_MS` | `10000` | Per API request timeout |
| `MCP_HIDE_UNPERMITTED_TOOLS` | `true` | List only tools the agent's permissions allow |

## Permissions and identity

- Agents are `api_clients` rows created by an admin (`POST /api/v1/api-clients`), each with an
  explicit permission list. Seeded: **`catalog-agent`** (`PRODUCTS_READ`, `CATEGORIES_READ`,
  `CATEGORIES_WRITE` — exactly the brief's agent) and **`readonly-agent`** (reads only).
- On connect the server calls `GET /auth/me` and advertises only the tools the agent may use.
  That is a usability feature; **enforcement is always the API's** (an agent that calls a hidden or
  forbidden tool gets a 403 and a FAILURE audit entry).
- Every write is audited with `actorType=AGENT`, the agent id and name, `channel=MCP`, the tool name
  (`metadata.mcpTool`), the request id and the before/after state. Query them with
  `list_audit_logs` (needs `AUDIT_READ`) or `GET /api/v1/audit-logs?channel=MCP`.

## Tools

The exact `tools/list` payload (JSON Schemas as agents receive them) is generated into
[`mcp-tools.json`](mcp-tools.json) by `npm run docs:export`. All input objects are **strict**
(unknown properties are rejected); all ids are UUIDs.

| Tool | Permission | Hints | REST call |
| --- | --- | --- | --- |
| `whoami` | — | read-only | `GET /auth/me` |
| `list_categories` | `CATEGORIES_READ` | read-only | `GET /categories` |
| `get_category` | `CATEGORIES_READ` | read-only | `GET /categories/:id` |
| `list_products` | `PRODUCTS_READ` | read-only | `GET /products` |
| `get_product` | `PRODUCTS_READ` | read-only | `GET /products/:id` |
| `create_category` | `CATEGORIES_WRITE` | write | `POST /categories` |
| `update_category` | `CATEGORIES_WRITE` | write, idempotent | `PATCH /categories/:id` |
| `delete_category` | `CATEGORIES_WRITE` | **destructive**, idempotent | `DELETE /categories/:id` |
| `add_products_to_category` | `CATEGORIES_WRITE` | write, idempotent | `PATCH /categories/:id/products` `{add}` |
| `remove_products_from_category` | `CATEGORIES_WRITE` | **destructive**, idempotent | `PATCH /categories/:id/products` `{remove}` |
| `set_category_products` | `CATEGORIES_WRITE` | **destructive**, idempotent | `PUT /categories/:id/products` |
| `list_audit_logs` | `AUDIT_READ` | read-only | `GET /audit-logs` |

All tools have `openWorldHint: false` (they only touch this catalog).

### Input schemas

**`whoami`** — `{}`. Returns `{ type, id, label, role, permissions }`.

**`list_categories`**

| Field | Type | Required | Notes |
| --- | --- | :-: | --- |
| `search` | string ≤ 100 | | case-insensitive match on name/description |
| `page` | integer ≥ 1 | | default 1 |
| `limit` | integer 1–100 | | default 20 |

Returns `{ data: [{ id, name, slug, description, productCount, createdAt, updatedAt }], meta: { page, limit, total, totalPages } }`.

**`get_category`** — `{ id: uuid }` (required). Returns the category with
`products: [{ id, sku, name, price, isActive }]`.

**`list_products`**

| Field | Type | Required | Notes |
| --- | --- | :-: | --- |
| `search` | string ≤ 100 | | name / SKU / description |
| `categoryId` | uuid | | only products in this category |
| `isActive` | boolean | | |
| `page`, `limit` | integer | | as above |

Each product includes `categories: [{ id, name, slug }]`; `price` is a decimal string (`"24.99"`).

**`get_product`** — `{ id: uuid }` (required).

**`create_category`**

| Field | Type | Required | Notes |
| --- | --- | :-: | --- |
| `name` | string 2–100 | ✓ | must contain a letter or digit; unique case/punctuation-insensitively (409 otherwise) |
| `description` | string 1–2000 | ✓ | |
| `productIds` | uuid[] ≤ 500 | | products to link; any unknown id → 422 listing all of them, nothing created |

**`update_category`**

| Field | Type | Required | Notes |
| --- | --- | :-: | --- |
| `id` | uuid | ✓ | |
| `name` | string 2–100 | | renaming re-derives the slug |
| `description` | string 1–2000 | | at least one of `name`/`description` (400 otherwise) |

**`delete_category`** — `{ id: uuid }` (required). Removes the category and its links; **products
are kept**. The audit entry lists `unlinkedProductIds`. Returns `{ deleted: true, id }`.

**`add_products_to_category`** — `{ categoryId: uuid, productIds: uuid[1..500] }` (both required).
Already-linked ids are no-ops. Returns `{ categoryId, productIds, added, removed }`; unknown
product ids → 422 `details.missingProductIds`, nothing changed.

**`remove_products_from_category`** — `{ categoryId: uuid, productIds: uuid[1..500] }` (both
required). Ids not linked are ignored; products themselves are never deleted.

**`set_category_products`** — `{ categoryId: uuid, productIds: uuid[0..500] }` (both required).
The category ends up linked to exactly this set (`[]` clears it); returns what was added/removed.

**`list_audit_logs`**

| Field | Type | Notes |
| --- | --- | --- |
| `resourceType` | `PRODUCT` \| `CATEGORY` \| `USER` \| `API_CLIENT` | |
| `resourceId` | string ≤ 64 | |
| `actorId` | uuid | |
| `action` | `CREATE` \| `UPDATE` \| `DELETE` \| `UPDATE_LINKS` \| `SET_LINKS` \| `REVOKE` | |
| `status` | `SUCCESS` \| `FAILURE` | |
| `channel` | `REST` \| `MCP` | |
| `from`, `to` | ISO-8601 date-time with offset | |
| `page`, `limit` | integer | newest first |

## Errors

Tool failures are returned as MCP results with `isError: true` and the API's error envelope, so the
model gets actionable information:

```json
{
  "error": {
    "statusCode": 422,
    "error": "Unprocessable Entity",
    "message": "1 referenced product(s) do not exist",
    "details": { "missingProductIds": ["3f1b9a52-7d3e-4c1a-9b8e-2a6f0c4d5e71"] },
    "requestId": "8f0e6a8e-..."
  }
}
```

| Status | Agent guidance |
| --- | --- |
| 400 | Fix the input (see `details`) |
| 403 | Missing permission — do not retry |
| 404 | The resource or link does not exist |
| 409 | Name conflict — choose another name or update the existing category |
| 422 | Some referenced ids do not exist (all listed) — nothing was changed |
| 503 | API unreachable. Reads were already retried; for writes the outcome is unknown — read back before retrying |

Input that violates a tool schema is rejected by the MCP server before any API call.

## Tests

`npm run test:mcp` runs [`api/test/mcp.e2e-spec.ts`](../api/test/mcp.e2e-spec.ts): the official MCP
SDK client → this server → HTTP → the real API → PostgreSQL, over in-memory and Streamable HTTP
transports. It verifies per-agent tool discovery, reads, every write tool with its audit entry,
403 enforcement with all tools exposed, 422/409/404 passthrough, API business rules beyond the tool
schema, schema rejection without API calls, and HTTP-transport authentication and agent isolation.
Unit tests in [`mcp-server/test`](../mcp-server/test) pin the exact REST request each tool makes.
