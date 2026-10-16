import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('applies safe defaults (stdio, loopback, IPv4 API URL)', () => {
    expect(loadConfig({})).toEqual({
      API_BASE_URL: 'http://127.0.0.1:3000/api/v1',
      AGENT_API_KEY: undefined,
      MCP_TRANSPORT: 'stdio',
      MCP_HTTP_HOST: '127.0.0.1',
      MCP_HTTP_PORT: 3001,
      MCP_REQUEST_TIMEOUT_MS: 10_000,
      MCP_HIDE_UNPERMITTED_TOOLS: true,
    });
  });

  it('parses overrides and treats blank strings as unset', () => {
    const config = loadConfig({
      API_BASE_URL: 'http://api:3000/api/v1',
      AGENT_API_KEY: '   ',
      MCP_TRANSPORT: 'http',
      MCP_HTTP_PORT: '8080',
      MCP_HIDE_UNPERMITTED_TOOLS: 'false',
    });
    expect(config).toMatchObject({
      API_BASE_URL: 'http://api:3000/api/v1',
      AGENT_API_KEY: undefined,
      MCP_TRANSPORT: 'http',
      MCP_HTTP_PORT: 8080,
      MCP_HIDE_UNPERMITTED_TOOLS: false,
    });
  });

  it('fails fast with readable messages', () => {
    expect(() => loadConfig({ MCP_TRANSPORT: 'carrier-pigeon', API_BASE_URL: 'not a url' })).toThrow(
      /MCP_TRANSPORT[\s\S]*API_BASE_URL|API_BASE_URL[\s\S]*MCP_TRANSPORT/,
    );
  });
});
