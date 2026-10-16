import type { Request } from 'express';
import type { Principal } from '../auth/principal';
import { buildRequestContext } from './request-context';

const principal = (type: Principal['type']): Principal => ({
  type,
  id: `${type.toLowerCase()}-id`,
  label: type.toLowerCase(),
  role: type === 'USER' ? 'ADMIN' : null,
  permissions: [],
});

const req = (headers: Record<string, string>, who?: Principal) =>
  ({ headers, principal: who, id: 'req-1', ip: '10.0.0.1' }) as unknown as Request;

describe('buildRequestContext', () => {
  const mcpHeaders = { 'x-client-channel': 'MCP', 'x-mcp-tool': 'create_category' };

  it('marks agent traffic with the MCP channel header as MCP and keeps the tool name', () => {
    expect(buildRequestContext(req(mcpHeaders, principal('AGENT')))).toMatchObject({
      channel: 'MCP',
      mcpTool: 'create_category',
      requestId: 'req-1',
      ip: '10.0.0.1',
    });
  });

  it('never trusts the channel header from humans or anonymous callers', () => {
    expect(buildRequestContext(req(mcpHeaders, principal('USER')))).toMatchObject({ channel: 'REST', mcpTool: null });
    expect(buildRequestContext(req(mcpHeaders))).toMatchObject({ channel: 'REST', actor: null });
  });

  it('drops malformed tool names', () => {
    const ctx = buildRequestContext(
      req({ 'x-client-channel': 'mcp', 'x-mcp-tool': 'Robert"); DROP TABLE' }, principal('AGENT')),
    );
    expect(ctx).toMatchObject({ channel: 'MCP', mcpTool: null });
  });

  it('defaults agents without the header to REST', () => {
    expect(buildRequestContext(req({}, principal('AGENT'))).channel).toBe('REST');
  });
});
