# Zidni Catalog Platform

Product & category management API (**NestJS 11 + PostgreSQL 16 + Prisma**) with an **MCP server**
that lets AI agents read the catalog and manage categories and their product links — through
exactly the same validation, authorization, business rules and audit logging as every other client.

```mermaid
flowchart LR
  Human["Human client / Swagger UI"] -->|"Bearer JWT"| Api
  Agent["AI agent (Cursor, Claude, ...)"] -->|"MCP: stdio or Streamable HTTP"| Mcp["mcp-server"]
  Mcp -->|"REST + agent's own API key"| Api
  subgraph Api ["api (NestJS)"]
    direction LR
    Guards["Authentication + Permissions guards"] --> Pipes["Validation pipes"] --> Services["Domain services (transactions)"]
    Services --> Audit["AuditService (same transaction)"]
  end
  Services --> Db[("PostgreSQL")]
  Audit --> Db
```

The MCP server has **no database access and no business logic**: each tool is one authenticated
REST call made with the agent's own key, so it cannot bypass anything by construction.

| Document | What it covers |
| --- | --- |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Technical & design decisions, auth reasoning, trade-offs |
| [`docs/ERD.md`](docs/ERD.md) | ERD, keys, constraints, indexes, extra attributes |
| [`docs/MCP.md`](docs/MCP.md) | MCP tools, input schemas, permissions, client setup |
| [`docs/AI_DEVELOPMENT_REPORT.md`](docs/AI_DEVELOPMENT_REPORT.md) | AI-assisted workflow, review & validation |
| [`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md) | The plan approved before coding + refinements |
| [`docs/openapi.json`](docs/openapi.json) · [`docs/mcp-tools.json`](docs/mcp-tools.json) | Generated API / tool specs |

---

## Quick start (Docker — nothing else required)

```bash
docker compose up --build -d
```

The first build takes about 5–10 minutes on Docker Desktop. Later `docker compose up` commands reuse those images and finish in seconds.

| Service | URL |
| --- | --- |
| Swagger UI | http://localhost:3000/api/docs (raw spec: `/api/docs-json`) |
| REST API | http://localhost:3000/api/v1 |
| MCP (Streamable HTTP) | http://localhost:3001/mcp |
| PostgreSQL | `localhost:5433` (user/password/db: `zidni`) |

Optional database GUI: `docker compose --profile tools up -d pgadmin` → http://localhost:5050
(`admin@zidni.com` / `admin`, the Zidni server is pre-registered; its DB password is `zidni`).

On start the API applies migrations and runs an idempotent seed. Ports clash? Copy
[`.env.example`](.env.example) to `.env` and change `API_PORT`, `MCP_PORT` or `POSTGRES_PORT`.

### Seeded identities (local evaluation only)

| Identity | Credential | Permissions |
| --- | --- | --- |
| Admin | `admin@zidni.local` / `Admin@12345` | everything |
| Normal user | `user@zidni.local` / `User@123456` | `PRODUCTS_READ`, `CATEGORIES_READ` |
| `catalog-agent` | `zk_catalog1_dev-catalog-agent-secret-change-me` | `PRODUCTS_READ`, `CATEGORIES_READ`, `CATEGORIES_WRITE` |
| `readonly-agent` | `zk_readonl1_dev-readonly-agent-secret-change-me` | `PRODUCTS_READ`, `CATEGORIES_READ` |

Plus 4 categories and 5 products. Admins mint further agent keys with `POST /api/v1/api-clients`.

### Try it

```bash
# Human: log in, then call the API with the token (or use "Authorize" in Swagger UI)
TOKEN=$(curl -s localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@zidni.local","password":"Admin@12345"}' | jq -r .accessToken)
curl -s localhost:3000/api/v1/categories -H "Authorization: Bearer $TOKEN" | jq

# The normal user is read-only
USER_TOKEN=$(curl -s localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"user@zidni.local","password":"User@123456"}' | jq -r .accessToken)
curl -s -X POST localhost:3000/api/v1/categories -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Nope","description":"x"}' | jq   # -> 403

# Agent over MCP (JSON-RPC over Streamable HTTP)
curl -s localhost:3001/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer zk_catalog1_dev-catalog-agent-secret-change-me' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_category","arguments":{"name":"Agent Picks","description":"Created by an AI agent"}}}' | jq

# Every write is in the audit log (who, what, when, through which channel/tool)
curl -s "localhost:3000/api/v1/audit-logs?channel=MCP" -H "Authorization: Bearer $TOKEN" | jq '.data[0]'
```

---

## Tests

All suites run against a real PostgreSQL database (`zidni_test`, created automatically by the
compose Postgres init script). The test harness refuses to run against any database whose name
does not end in `_test`.

**In Docker (no local Node.js needed):**

```bash
docker compose --profile test run --rm tests
```

**Locally** (Node.js ≥ 20.11, Postgres from compose):

```bash
npm ci
docker compose up -d postgres
npm run test:all          # everything below, in order
```

| Command | Scope | Count |
| --- | --- | --- |
| `npm test` | Unit tests (api + mcp-server): key handling, RBAC table, guards, error mapping, slugs, MCP client retries and tool → REST mapping | 71 |
| `npm run test:e2e` | Core functionality + **permissions**: CRUD, validation, relationship integrity, concurrency, full endpoint × principal authorization matrix, API keys, audit trail (incl. DB-level immutability) | 174 |
| `npm run test:mcp` | **MCP operations** end-to-end: real MCP client → MCP server → HTTP → API → Postgres, nothing mocked; in-memory and Streamable HTTP transports | 17 |

`npm run lint` and `npm run typecheck` cover both workspaces.

---

## Local development (without Docker for the apps)

```bash
npm ci
docker compose up -d postgres            # Postgres on localhost:5433
cp api/.env.example api/.env
npm run db:migrate && npm run db:seed
npm run dev:api                          # http://localhost:3000/api/docs
```

MCP server against the local API:

```bash
npm run build -w mcp-server
# stdio (what desktop agents spawn):
AGENT_API_KEY=zk_catalog1_dev-catalog-agent-secret-change-me node mcp-server/dist/index.js
# or Streamable HTTP on :3001 (key sent per request by the client):
MCP_TRANSPORT=http node mcp-server/dist/index.js
```

Regenerate the published specs after API or tool changes: `npm run docs:export`.

### Connecting an AI agent

Cursor (`.cursor/mcp.json`) / Claude Desktop (`claude_desktop_config.json`) — **HTTP** (Docker stack):

```json
{
  "mcpServers": {
    "zidni-catalog": {
      "url": "http://localhost:3001/mcp",
      "headers": { "Authorization": "Bearer zk_catalog1_dev-catalog-agent-secret-change-me" }
    }
  }
}
```

**stdio** (spawned by the client; build `mcp-server` first):

```json
{
  "mcpServers": {
    "zidni-catalog": {
      "command": "node",
      "args": ["/absolute/path/to/repo/mcp-server/dist/index.js"],
      "env": {
        "API_BASE_URL": "http://127.0.0.1:3000/api/v1",
        "AGENT_API_KEY": "zk_catalog1_dev-catalog-agent-secret-change-me"
      }
    }
  }
}
```

---

## Repository layout

```
api/                      NestJS application
  prisma/                 schema.prisma, SQL migrations (incl. CHECK constraints + audit trigger), seed
  src/auth                JWT + API-key authentication, permission guard, decorators
  src/api-clients         agent key management (admin)
  src/categories          categories + product-link endpoints
  src/products            products
  src/audit               audit service, failure recorder/interceptor, audit-log endpoint
  src/common              error envelope, validation pipe, request context, pagination, utils
  src/health              liveness / readiness
  test/                   e2e + MCP integration suites
  scripts/                OpenAPI export
mcp-server/               MCP server (stdio + Streamable HTTP) — a thin, authenticated API client
  src/tools.ts            tool definitions (zod input schemas, permissions, annotations)
docker/                   Postgres init (test DB), test-runner image
docs/                     design docs, generated OpenAPI and MCP tool specs
```

## Git history

`main` only receives `--no-ff` merges of focused branches, so `git log --graph --first-parent main`
reads as the build story: `chore/scaffold` → `feat/database` → `feat/auth-rbac` → `feat/audit-log`
→ `feat/catalog` → `feat/mcp-server` → `chore/docker` → `test/e2e-mcp` → `docs/reports`.
