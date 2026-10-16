import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Channel } from '@prisma/client';
import type { Request } from 'express';
import type { Principal } from '../auth/principal';

/** Who is acting, through which channel, for which request. Passed explicitly to services. */
export interface RequestContext {
  actor: Principal | null;
  channel: Channel;
  requestId: string | null;
  ip: string | null;
  /** Name of the MCP tool that triggered the call, when the channel is MCP. */
  mcpTool: string | null;
}

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export function buildRequestContext(req: Request): RequestContext {
  const actor = req.principal ?? null;
  // Channel/tool headers are informational and only trusted from authenticated agents;
  // a human client cannot make its actions appear as MCP traffic.
  const isAgent = actor?.type === 'AGENT';
  const channelHeader = headerValue(req, 'x-client-channel')?.toLowerCase();
  const channel = isAgent && channelHeader === 'mcp' ? Channel.MCP : Channel.REST;
  const tool = headerValue(req, 'x-mcp-tool');

  return {
    actor,
    channel,
    requestId: req.id !== undefined ? String(req.id) : null,
    ip: req.ip ?? null,
    mcpTool: channel === Channel.MCP && tool && TOOL_NAME_PATTERN.test(tool) ? tool : null,
  };
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export const ReqCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  buildRequestContext(ctx.switchToHttp().getRequest<Request>()),
);
