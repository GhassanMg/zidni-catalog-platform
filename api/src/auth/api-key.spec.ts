import { API_KEY_PATTERN, generateApiKey, hashApiKey, looksLikeApiKey, parseApiKey, verifyApiKey } from './api-key';

describe('api-key', () => {
  it('generates well-formed, unique keys whose hash is SHA-256 hex', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).toMatch(API_KEY_PATTERN);
    expect(a.key.startsWith(`zk_${a.prefix}_`)).toBe(true);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(a.key).not.toBe(b.key);
    expect(a.prefix).not.toBe(b.prefix);
  });

  it('parses the prefix and rejects malformed keys', () => {
    const { key, prefix } = generateApiKey();
    expect(parseApiKey(key)).toEqual({ prefix });
    for (const bad of ['', 'zk_', 'zk_short_secret', `zk_${prefix}_tooshort`, `xx_${prefix}_${'a'.repeat(40)}`, `zk_${prefix}_${'a'.repeat(129)}`]) {
      expect(parseApiKey(bad)).toBeNull();
    }
  });

  it('verifies only the exact key', () => {
    const { key, hash } = generateApiKey();
    expect(verifyApiKey(key, hash)).toBe(true);
    expect(verifyApiKey(`${key}x`, hash)).toBe(false);
    expect(verifyApiKey(key, 'not-hex')).toBe(false);
  });

  it('recognises the key namespace', () => {
    expect(looksLikeApiKey('zk_abc')).toBe(true);
    expect(looksLikeApiKey('eyJhbGciOi')).toBe(false);
  });
});
