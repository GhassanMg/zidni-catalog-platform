import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { looksLikeApiKey } from '../api-key';

export interface Credential {
  kind: 'jwt' | 'api-key';
  value: string;
}

/**
 * Accepted forms:
 *   Authorization: Bearer <jwt>
 *   Authorization: Bearer zk_...      (agent API key)
 *   X-API-Key: zk_...                 (agent API key)
 * Sending two credentials is rejected rather than silently picking one.
 */
export function extractCredential(req: Request): Credential | null {
  const apiKey = single(req.headers['x-api-key'])?.trim();
  const authorization = single(req.headers.authorization)?.trim();
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];

  if (authorization && !bearer) {
    throw new UnauthorizedException('Authorization header must use the Bearer scheme');
  }
  if (apiKey && bearer) {
    throw new UnauthorizedException(
      'Provide either an Authorization bearer token or an X-API-Key header, not both',
    );
  }
  if (apiKey) return { kind: 'api-key', value: apiKey };
  if (bearer) return { kind: looksLikeApiKey(bearer) ? 'api-key' : 'jwt', value: bearer };
  return null;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
