import { ApiError, CatalogApiClient } from '../src/api-client';

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit]>;

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('Expected the request to fail');
    },
    (error: unknown) => error as ApiError,
  );

const jsonResponse = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function client(fetchMock: FetchMock, maxRetries = 2) {
  return new CatalogApiClient({
    baseUrl: 'http://api.test/api/v1/',
    apiKey: 'zk_test1234_secret',
    timeoutMs: 1_000,
    maxRetries,
    fetchImpl: fetchMock as unknown as typeof fetch,
  });
}

describe('CatalogApiClient', () => {
  it('authenticates as the agent, tags the channel/tool and serialises query and body', async () => {
    const fetchMock: FetchMock = jest.fn().mockResolvedValue(jsonResponse(201, { id: 'c1' }));
    const result = await client(fetchMock).request('POST', '/categories', {
      body: { name: 'A' },
      query: { dryRun: false, skip: undefined },
      tool: 'create_category',
    });

    expect(result).toEqual({ id: 'c1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/v1/categories?dryRun=false');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"A"}');
    expect(init.headers).toMatchObject({
      'X-API-Key': 'zk_test1234_secret',
      'X-Client-Channel': 'mcp',
      'X-MCP-Tool': 'create_category',
      'Content-Type': 'application/json',
      'X-Request-Id': expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('returns undefined for 204 responses', async () => {
    const fetchMock: FetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(client(fetchMock).request('DELETE', '/categories/1')).resolves.toBeUndefined();
  });

  it('surfaces the API error envelope unchanged', async () => {
    const body = {
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: '1 referenced product(s) do not exist',
      details: { missingProductIds: ['p1'] },
      requestId: 'r1',
    };
    const fetchMock: FetchMock = jest.fn().mockResolvedValue(jsonResponse(422, body));
    const error = await rejection(client(fetchMock).request('PATCH', '/x'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.body).toEqual(body);
  });

  it('copes with non-JSON error bodies', async () => {
    const fetchMock: FetchMock = jest.fn().mockResolvedValue(new Response('Bad gateway', { status: 500 }));
    const error = await rejection(client(fetchMock).request('GET', '/x'));
    expect(error.body).toMatchObject({ statusCode: 500, message: 'Bad gateway' });
  });

  it('retries reads on gateway errors and network failures', async () => {
    const fetchMock: FetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await expect(client(fetchMock).request('GET', '/products')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never retries writes and reports the outcome as unknown', async () => {
    const fetchMock: FetchMock = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    const error = await rejection(client(fetchMock).request('POST', '/categories', { body: {} }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(503);
    expect(error.body.message).toMatch(/outcome of this write is unknown/);
  });

  it('does not retry client errors', async () => {
    const fetchMock: FetchMock = jest.fn().mockResolvedValue(jsonResponse(403, { message: 'nope' }));
    await expect(client(fetchMock).request('GET', '/x')).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured number of read attempts', async () => {
    const fetchMock: FetchMock = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(client(fetchMock, 1).request('GET', '/x')).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
