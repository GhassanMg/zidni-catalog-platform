import { randomUUID } from 'node:crypto';

/** Mirrors the API's error envelope so agents receive the exact same information. */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  /** MCP tool that initiated the call; recorded by the API in the audit log. */
  tool?: string;
}

export interface CatalogApiClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  /** Extra attempts for idempotent reads on network errors / 502-504. */
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);

/**
 * Thin HTTP client for the catalog REST API. The MCP server holds NO business logic and NO
 * database access: every tool call is a normal API request authenticated with the agent's own
 * key, so validation, authorization, business rules and audit logging cannot be bypassed.
 */
export class CatalogApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CatalogApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    // Only reads are retried: replaying a write after an ambiguous failure could apply it twice.
    const attempts = method === 'GET' ? this.maxRetries + 1 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await this.fetchImpl(url, {
          method,
          headers: this.headers(options),
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (RETRYABLE_STATUS.has(response.status) && attempt < attempts) {
          await sleep(backoff(attempt));
          continue;
        }
        return await parseResponse<T>(response);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        lastError = error;
        if (attempt < attempts) await sleep(backoff(attempt));
      }
    }

    throw new ApiError(503, {
      statusCode: 503,
      error: 'Service Unavailable',
      message: describeTransportError(lastError, method, this.timeoutMs),
    });
  }

  private buildUrl(path: string, query?: QueryParams): string {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private headers(options: RequestOptions): Record<string, string> {
    return {
      Accept: 'application/json',
      'X-API-Key': this.apiKey,
      'X-Client-Channel': 'mcp',
      'X-Request-Id': randomUUID(),
      ...(options.tool ? { 'X-MCP-Tool': options.tool } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    };
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let body: unknown;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const error = (body ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(response.status, {
      statusCode: response.status,
      error: error.error ?? response.statusText,
      message: error.message ?? `Request failed with status ${response.status}`,
      ...(error.details !== undefined ? { details: error.details } : {}),
      ...(error.requestId ? { requestId: error.requestId } : {}),
    });
  }
  return body as T;
}

function describeTransportError(error: unknown, method: HttpMethod, timeoutMs: number): string {
  const isTimeout = error instanceof Error && error.name === 'TimeoutError';
  const reason = isTimeout
    ? `no response within ${timeoutMs}ms`
    : error instanceof Error
      ? (error.cause instanceof Error ? error.cause.message : error.message)
      : String(error);
  const outcome =
    method === 'GET'
      ? ''
      : ' The outcome of this write is unknown: read the resource back before retrying.';
  return `Catalog API is unreachable (${reason}).${outcome}`;
}

function backoff(attempt: number): number {
  return Math.min(200 * 2 ** (attempt - 1), 2_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
