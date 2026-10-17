# Technical & design decisions

Each section states the decision, why it was chosen, and what was traded away.

- [1. Stack](#1-stack)
- [2. Architecture: the MCP server is just another API client](#2-architecture-the-mcp-server-is-just-another-api-client)
- [3. Authentication](#3-authentication)
- [4. Authorization (RBAC)](#4-authorization-rbac)
- [5. API design, validation and errors](#5-api-design-validation-and-errors)
- [6. Relationship integrity](#6-relationship-integrity)
- [7. Audit logging](#audit-logging)
- [8. MCP tool design](#8-mcp-tool-design)
- [9. Availability and reliability](#9-availability-and-reliability)
- [10. Security checklist](#10-security-checklist)
- [11. Testing strategy](#11-testing-strategy)
- [12. Trade-offs and what I would do next](#12-trade-offs-and-what-i-would-do-next)

---

## 1. Stack

| Choice | Why | Alternatives considered |
| --- | --- | --- |
| **NestJS 11** (Express 5) | Preferred by the brief; DI, guards/pipes/interceptors/filters map 1:1 onto the cross-cutting requirements (auth, validation, audit, errors); first-class Swagger. | Nest 12 had just been released — 11.x is the mature line with full ecosystem support. |
| **PostgreSQL 16** | Relational integrity is the core of the task: FKs, CHECK constraints, triggers, native enums, row locks, `pg_trgm` for search, JSONB for audit payloads. | MySQL (weaker CHECK/trigger story), MongoDB (no relational integrity for M:N). |
| **Prisma 6** | Typed client generated from one schema, versioned SQL migrations (reviewable, hand-editable for CHECKs/triggers), interactive transactions, `$queryRaw` for `FOR UPDATE`. | TypeORM (weaker typing, migration drift), Drizzle (good, but less established in Nest). Prisma 7/8 were very new/pre-release and change client generation; 6.19 is the stable line. |
| **class-validator DTOs** (API) / **zod** (env + MCP) | DTO decorators double as Swagger schema; zod is what the MCP SDK consumes to publish JSON Schemas, and is ideal for env parsing. | zod everywhere (would lose Nest's Swagger integration). |
| **@modelcontextprotocol/sdk** | Official SDK: protocol correctness, stdio + Streamable HTTP transports, schema publication. | Hand-rolled JSON-RPC (no reason to). |
| **Jest + supertest** against real Postgres | Tests the actual SQL, constraints, triggers and locks; mocks would hide exactly the bugs that matter here. | Testcontainers (heavier; compose already provides Postgres). |
| **npm workspaces** monorepo | One `npm ci`, one lockfile, shared scripts; the MCP e2e test imports the MCP server source directly. | Separate repos (harder to review and run). |

## 2. Architecture: the MCP server is just another API client

**Decision.** `mcp-server` is a separate process that talks to the REST API over HTTP using the
agent's own API key. It has no database credentials and contains no business logic.

**Why.** The brief requires that MCP "must not bypass the application's validation, authorization,
or business rules". Making that true *by construction* is stronger than making it true by
discipline: there is literally no code path from a tool to the database except through the same
guards → validation pipes → services → transactions → audit logging that serve every other client.
A second benefit is that the REST API is the single, documented contract (OpenAPI), and the MCP
layer stays small (~12 declarative tool definitions).

**Trade-off.** One extra network hop per tool call (negligible for agent workloads) and a second
deployable. Rejected alternative: importing Nest services into the MCP process — faster, but it
would duplicate guard/audit wiring and invite drift.

## 3. Authentication

Two kinds of principals, one guard:

### Humans: e-mail + password → short-lived JWT

- `POST /auth/login` verifies a bcrypt hash and issues an **HS256 JWT valid for 15 minutes**,
  with pinned `issuer`/`audience` and algorithm.
- **The user is re-loaded on every request.** The token only proves identity; role and
  `is_active` come from the database. Demoting an admin or disabling an account takes effect on the
  next request — not when the token expires. (A primary-key lookup per request is cheap.)
- Login is rate-limited (10/min per IP), returns the *same* 401 for unknown e-mail and wrong
  password, and compares against a dummy hash for unknown e-mails so response timing does not
  reveal which accounts exist.
- `POST /auth/register` always creates a **USER**; sending `role` is a 400 (unknown fields are
  forbidden), so self-escalation is impossible. Admins are provisioned by seed/ops.

**Why JWT** over server sessions: stateless, standard for REST APIs and Swagger's "Authorize"
button, no session store to run. Re-loading the user removes JWT's classic weakness (stale
privileges). **Trade-off:** no refresh tokens — clients log in again after 15 minutes. Acceptable
for this scope; refresh-token rotation is listed under next steps.

### AI agents: scoped API keys

- Format `zk_<8-char prefix>_<43-char secret>` (256 bits of randomness). The key is shown
  **once** at creation; only its **SHA-256** is stored, compared with `timingSafeEqual`.
- The public **prefix** is a unique index, so lookup is O(1) without scanning hashes.
- Each key carries an **explicit permission list**, optional **expiry**, can be **revoked**
  instantly, and records `last_used_at` (throttled to one write per minute per key).
- Accepted as `X-API-Key: zk_...` or `Authorization: Bearer zk_...` (what most MCP clients can send).
  Sending both a JWT and a key is rejected rather than guessing.

**Why API keys for agents** rather than JWTs from a user login: agents are long-running machine
identities, not people. They need credentials that are independently scoped (least privilege),
revocable without affecting a human account, and attributable in the audit log to *that agent*.
**Why SHA-256 and not bcrypt** for keys: bcrypt protects *low-entropy* secrets (passwords) against
brute force; a 256-bit random key cannot be brute-forced, and a slow hash would add ~100 ms to
every agent request.

## 4. Authorization (RBAC)

**Decision: permission-based RBAC.** Code checks *permissions*, never role names:

| Permission | ADMIN | USER | Agents |
| --- | :-: | :-: | --- |
| `PRODUCTS_READ` | ✓ | ✓ | if granted |
| `CATEGORIES_READ` | ✓ | ✓ | if granted |
| `PRODUCTS_WRITE` | ✓ | | if granted |
| `CATEGORIES_WRITE` | ✓ | | if granted |
| `AUDIT_READ` | ✓ | | if granted |
| `API_CLIENTS_MANAGE` | ✓ | | **never** |

- Roles map to permissions in one table ([`permissions.ts`](../api/src/auth/permissions.ts)).
  Admin = read/write, normal user = read-only, exactly as the brief requires.
- Agents get only the permissions on their key. The brief's agent (read everything, manage
  categories and their product links) is `catalog-agent`: `PRODUCTS_READ`, `CATEGORIES_READ`,
  `CATEGORIES_WRITE` — it cannot touch products themselves.
- `API_CLIENTS_MANAGE` can **never** be granted to an agent (validated in the DTO): an agent that
  could mint keys could escalate its own privileges.
- **Deny by default, for authentication and authorization.** I decided a route with no access
  decorator is closed. Authentication already worked that way: the guard is global, and only
  `@Public()` (login, register, health) skips it. Authorization did not. `PermissionsGuard` used
  to allow any authenticated caller when `@RequirePermissions` was missing, so one forgotten
  decorator would expose the endpoint. The endpoint × principal matrix would not catch that for a
  route it does not already list. The guard now requires an explicit policy:
  - `@Public()` — no credential.
  - `@AllowAuthenticated()` — any logged-in user or agent, no specific permission. I use this only
    on `GET /auth/me`, which has to describe whoever is calling.
  - `@RequirePermissions(...)` — every other operation, published in OpenAPI as
    `x-required-permissions`.
  A handler with none of these is rejected with 403. If `@AllowAuthenticated()` and
  `@RequirePermissions(...)` are both present, the permissions win.

**Why permissions instead of `@Roles('ADMIN')`:** humans and agents share one model. An agent is
not "an admin" or "a user" — it is a set of capabilities. New roles (e.g. "catalog editor") become
a one-line table change, not a code audit.

## 5. API design, validation and errors

- Versioned prefix `/api/v1`, resource-oriented routes, `PATCH` for partial updates, `204` for deletes.
- **Validation:** global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` (unknown fields
  → 400, which is what blocks mass-assignment like `role` or `slug`), `transform`, and
  `ParseUUIDPipe` on ids. Inputs are trimmed/normalised (`sku` upper-cased, e-mail lower-cased, id
  arrays de-duplicated). Prices must be JSON numbers with ≤ 2 decimals; pagination is capped at 100.
- **One error envelope everywhere** (REST and MCP):
  `{ statusCode, error, message, details?, path, timestamp, requestId }`. Validation errors list
  `details: [{ field, errors[] }]`; 422s list every missing id; 403s list `required`/`missing`
  permissions. Unexpected errors become a generic 500 — internal messages and SQL never leak.
- **Status codes:**

| Code | When |
| --- | --- |
| 400 | Validation failure, malformed JSON, contradictory request (same id in `add` and `remove`), empty update |
| 401 | Missing/invalid/expired/revoked credential |
| 403 | Authenticated but lacking a permission |
| 404 | Resource (or link) does not exist |
| 409 | Unique conflict (SKU, category name/slug, agent name), already-revoked key |
| 422 | Request is well-formed but references products/categories that do not exist |
| 413 / 429 | Body over 100 kB / rate limit exceeded |
| 503 | Database unavailable (readiness probe, Prisma init/pool errors) |

- Prisma errors are mapped centrally (`P2002`→409, `P2025`→404, `P2003`→409, `P2034`→409,
  `P2024`→503, CHECK violation→400) so services stay free of error plumbing.

## 6. Relationship integrity

- **Every multi-step write is one transaction** (link changes, create-with-links, product
  category replacement, delete + audit).
- **Row locks:** link operations start with `SELECT ... FOR UPDATE` on the category (or product),
  serialising concurrent edits of the same aggregate. Without it two concurrent "add" requests can
  each read the old link set and produce wrong audit diffs. Covered by a concurrency test
  (6 parallel adds → 6 links, 6 accurate audit entries).
- **All referenced ids are verified** inside the transaction; the 422 lists *every* missing id so a
  client (or agent) can fix the request in one go, and nothing is written.
- **Two ways to manage links**, because agents and UIs need different semantics:
  - incremental `PATCH /categories/:id/products { add, remove }` — idempotent; the response and
    audit entry report what *actually* changed (`added`, `removed`) and what was a no-op
    (`alreadyLinked`, `notLinked`);
  - declarative `PUT /categories/:id/products { productIds }` — "make it exactly this set";
  - plus `DELETE /categories/:id/products/:productId` (404 if not linked) and `categoryIds` on
    product create/update (replace semantics).
- **Delete semantics:** deleting a category never deletes products (and vice versa); only links go,
  and the audit entry records which ones. A link change bumps the category's `updated_at`.
- **Unique names that humans perceive as equal** are rejected via the slug
  (`"Home & Garden"` = `"home garden"`), Unicode-aware so Arabic names work.

<a id="audit-logging"></a>
## 7. Audit logging

**What is recorded for every write** (create/update/delete, link changes, registration, key
creation/revocation): action, resource type and id, status (SUCCESS/FAILURE), actor type/id/label,
channel (REST/MCP), MCP tool name, request id, IP, timestamp, `{ before, after }` snapshots, and
operation metadata (changed fields, link diff, unlinked ids, HTTP status and error for failures).

**Accuracy guarantees:**

1. **Successful entries are written in the same transaction as the change.** The log can never
   claim something happened that rolled back, nor miss something that committed.
2. **Failed and denied attempts are recorded too** — an agent trying a write it is not allowed to
   do is exactly what an operator wants to see. 401/403 are recorded by the guards (they run
   before interceptors); validation, business-rule and database failures by a global interceptor.
   Failure logging never throws (it must not replace the real error returned to the client).
3. **The channel cannot be spoofed by humans:** `X-Client-Channel: mcp` / `X-MCP-Tool` are honoured
   only from authenticated agent principals, and tool names are pattern-validated.
4. **Append-only at the database level** (trigger rejects UPDATE/DELETE), and no FKs, so entries
   outlive deleted resources and revoked agents.
5. Snapshots never contain secrets (password hashes and API keys are never part of a snapshot).

**Not audited, deliberately:** reads (high volume, not "write actions"; request logs with request
ids cover them), and requests rejected before routing (rate-limited 429s, malformed JSON bodies) —
those never reach an operation, and are visible in the structured request log.

## 8. MCP tool design

12 tools: `whoami`; reads `list_categories`, `get_category`, `list_products`, `get_product`,
`list_audit_logs`; writes `create_category`, `update_category`, `delete_category`,
`add_products_to_category`, `remove_products_from_category`, `set_category_products`.
Details and schemas: [MCP.md](MCP.md).

- **Task-shaped, granular tools** rather than one generic "call API" tool: models choose tools by
  name/description, and granular tools carry precise schemas and **behaviour annotations**
  (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so clients can ask for confirmation before
  destructive calls.
- **Strict input schemas** (zod `.strict()`, UUID formats, bounds) reject malformed calls before
  they reach the API — but the API remains the authority (a test proves an input the MCP schema
  accepts is still rejected by API business rules).
- **Least privilege in discovery:** on connect, the server calls `whoami` and lists only the tools
  the agent can use (less confusion, fewer wasted calls). This is UX, not security — the API
  enforces permissions regardless (tested with all tools exposed).
- **Errors are returned verbatim** as `isError` results with the API envelope, so the model sees
  "403 Missing required permission: CATEGORIES_WRITE" or "422 missingProductIds: [...]" and can
  react correctly.
- **Safe retries:** reads are retried on network errors/502–504 with backoff; **writes are never
  retried** (a replay after an ambiguous failure could apply twice) and a write timeout says "the
  outcome is unknown — read back before retrying".
- **Transports:** stdio (desktop agents spawn it with one key) and **stateless Streamable HTTP**
  (each request carries its own key → one deployment serves many agents, each isolated to its own
  permissions; no session affinity needed to scale or restart).

## 9. Availability and reliability

- **Fail fast on bad config:** all env vars validated with zod at boot (e.g. `JWT_SECRET` ≥ 32 chars).
- **Start reliably:** DB connection retried with exponential backoff; compose healthchecks +
  `depends_on: service_healthy` order postgres → api → mcp-server; migrations applied on container
  start (`prisma migrate deploy` is idempotent); seed is idempotent.
- **Demo credentials belong to this evaluation stack only.** `docker compose up` runs the
  production image (`NODE_ENV=production`) and sets `SEED_ALLOW_PRODUCTION=true`, so the admin,
  user, and agent keys published in the README exist after one command. The seed script otherwise
  refuses to run when `NODE_ENV` is `production`. I kept this as the only Compose file on purpose.
  A reviewer clones the repo and runs that command; those passwords are how they log in. A real
  server would not use this file. It would not seed demo users, and it would refuse to start until
  `JWT_SECRET`, the database password, and the admin and agent credentials were set to values other
  than the published defaults. I did not add a second Compose file for that, so the evaluation path
  stays the one command in the README.
- **Health:** `/health/live` (process) and `/health/ready` (`SELECT 1` with a 2 s timeout → 503),
  used by the Docker healthcheck.
- **Graceful shutdown** hooks close the HTTP server and DB pool.
- **Operational failures are typed:** DB down → 503 with a retry hint; pool exhaustion → 503;
  serialisation conflicts → 409; MCP client timeouts → 503 with an explicit message.
- **Traceability:** every response carries `X-Request-Id` (an incoming well-formed id is honoured,
  the MCP server sends one per call); the same id is in the structured log and the audit entry.

## 10. Security checklist

- Authentication and authorization are both deny-by-default. A route with no `@Public()`,
  `@AllowAuthenticated()`, or `@RequirePermissions()` decorator is rejected.
- Least privilege for agents; agents can never manage credentials; humans cannot self-assign roles.
- Secrets: bcrypt (passwords), SHA-256 (high-entropy keys), keys shown once, credentials redacted
  from logs (`authorization`, `x-api-key`, `cookie`).
- Input: whitelisting DTOs, UUID validation, size caps (body 100 kB, arrays ≤ 500, page ≤ 100).
- Helmet security headers, CORS allow-list, rate limiting (global + stricter on auth routes).
- Containers run as the unprivileged `node` user with production dependencies only.
- Enumeration resistance: UUIDs, uniform login errors with timing equalisation.
- **Dependency advisories (accepted, documented):** `npm audit` reports advisories in
  *dev tooling* (Jest 29's `braces`/`micromatch`/istanbul chain) and, in the runtime image, in the
  **Prisma CLI** (`deepmerge-ts`, used when loading Prisma's own config for `migrate deploy`) and
  **`@nestjs/swagger`** (`js-yaml`, used only for YAML output; the API serves JSON). None of these
  code paths process untrusted input. Every fix is a major upgrade (Jest 30, Prisma 7, Swagger 12 →
  Nest 12), which I chose not to take in the middle of this build; it is the first item under next steps.

## 11. Testing strategy

- **Real database, no mocks for integration**: constraints, triggers, locks and SQL are what break in
  production. A safety check refuses to run tests against a database not named `*_test`.
- **Authorization is tested as a matrix** (every protected endpoint × every principal type) rather
  than a few hand-picked cases, so a missing `@RequirePermissions` cannot slip through.
- **MCP is tested end-to-end** with the official SDK client against the real server and API, over
  both transports — the same path a real agent takes.
- Unit tests cover the pure logic (key format, permission table, error mapping, request context,
  MCP client retry policy, the exact REST call each tool makes).

## 12. Trade-offs and what I would do next

| Not done (yet) | Why acceptable now | Next step |
| --- | --- | --- |
| Major upgrades (Jest 30, Prisma 7, Nest/Swagger 12) | Advisories not reachable (see §10) | Upgrade on a dedicated branch with the test suite as the safety net |
| Refresh tokens | 15-min tokens + re-login is fine for an evaluation API | Rotating refresh tokens with reuse detection |
| Optimistic concurrency (ETag / `If-Match`) | Row locks prevent corruption; last-writer-wins on field edits | `version` column + `412 Precondition Failed` |
| Soft delete | Hard delete + full before-snapshot in the audit log allows reconstruction | `deleted_at` if restore becomes a requirement |
| MCP OAuth 2.1 (spec authorization) | Bearer API keys work in all current MCP clients | OAuth with per-agent scopes mapped to permissions |
| Distributed rate limiting | In-memory throttler is correct for a single instance | Redis store when scaling horizontally |
| Audit retention/partitioning | Volume is small | Monthly partitions + retention policy, export to SIEM |
| Product writes via MCP | Not requested; agent scope is categories + links | Tools exist in the API (`PRODUCTS_WRITE`); adding MCP tools is declarative |
