import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * API key format: zk_<prefix>_<secret>
 *  - prefix: 8 alphanumerics, stored in clear and indexed for O(1) lookup
 *  - secret: >= 32 url-safe chars (256 bits of entropy when generated)
 * Only the SHA-256 of the full key is persisted. A slow KDF (bcrypt/argon2) is unnecessary
 * because keys are high-entropy random values, and it would add latency to every request.
 */
export const API_KEY_PATTERN = /^zk_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{32,128})$/;

export interface GeneratedApiKey {
  key: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const key = `zk_${prefix}_${secret}`;
  return { key, prefix, hash: hashApiKey(key) };
}

export function parseApiKey(key: string): { prefix: string } | null {
  const match = API_KEY_PATTERN.exec(key);
  return match ? { prefix: match[1] } : null;
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith('zk_');
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function verifyApiKey(key: string, expectedHashHex: string): boolean {
  const actual = Buffer.from(hashApiKey(key), 'hex');
  const expected = Buffer.from(expectedHashHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
