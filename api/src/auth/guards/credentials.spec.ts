import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { extractCredential } from './credentials';

const req = (headers: Record<string, string | string[]>) => ({ headers }) as unknown as Request;

describe('extractCredential', () => {
  it('returns null without credentials', () => {
    expect(extractCredential(req({}))).toBeNull();
  });

  it('reads a bearer JWT', () => {
    expect(extractCredential(req({ authorization: 'Bearer abc.def.ghi' }))).toEqual({ kind: 'jwt', value: 'abc.def.ghi' });
    expect(extractCredential(req({ authorization: 'bearer   abc' }))).toEqual({ kind: 'jwt', value: 'abc' });
  });

  it('reads an API key from X-API-Key or from the bearer token', () => {
    expect(extractCredential(req({ 'x-api-key': ' zk_key ' }))).toEqual({ kind: 'api-key', value: 'zk_key' });
    expect(extractCredential(req({ authorization: 'Bearer zk_key' }))).toEqual({ kind: 'api-key', value: 'zk_key' });
  });

  it('rejects other schemes and ambiguous requests', () => {
    expect(() => extractCredential(req({ authorization: 'Basic dXNlcjpwYXNz' }))).toThrow(UnauthorizedException);
    expect(() => extractCredential(req({ authorization: 'Bearer' }))).toThrow(UnauthorizedException);
    expect(() =>
      extractCredential(req({ authorization: 'Bearer abc', 'x-api-key': 'zk_key' })),
    ).toThrow(/not both/);
  });
});
