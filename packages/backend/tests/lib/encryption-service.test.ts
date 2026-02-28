import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to mock the env before importing the module
vi.mock('../../src/utils/env.js', () => ({
  env: {
    ANIMUS_ENCRYPTION_KEY: 'test-encryption-key-for-testing',
    NODE_ENV: 'test',
  },
  PROJECT_ROOT: '/tmp/animus-test',
  DATA_DIR: '/tmp/animus-test/data',
}));

describe('EncryptionService', () => {
  // Import fresh for each test
  let encrypt: typeof import('../../src/lib/encryption-service.js').encrypt;
  let decrypt: typeof import('../../src/lib/encryption-service.js').decrypt;
  let isConfigured: typeof import('../../src/lib/encryption-service.js').isConfigured;

  beforeEach(async () => {
    // Reset module cache to get fresh key derivation
    vi.resetModules();
    const mod = await import('../../src/lib/encryption-service.js');
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
    isConfigured = mod.isConfigured;
  });

  it('reports configured when key is set', () => {
    expect(isConfigured()).toBe(true);
  });

  it('encrypts and decrypts roundtrip', () => {
    const plaintext = 'sk-abc123-secret-api-key';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).not.toContain(plaintext);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for same input (random IV)', () => {
    const plaintext = 'test-key';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);

    // But both decrypt to same value
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it('handles empty string', () => {
    const encrypted = encrypt('');
    expect(decrypt(encrypted)).toBe('');
  });

  it('handles unicode content', () => {
    const plaintext = 'Hello 🌍 — special chars: é, ñ, ü';
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('handles long content', () => {
    const plaintext = 'x'.repeat(10000);
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('throws on invalid ciphertext format', () => {
    expect(() => decrypt('not-valid')).toThrow('Invalid ciphertext format');
  });

  it('rejects legacy plain: format', () => {
    expect(() => decrypt('plain:dGVzdA==')).toThrow('Invalid ciphertext format');
  });
});

describe('EncryptionService (unconfigured)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../../src/utils/env.js', () => ({
      env: {
        ANIMUS_ENCRYPTION_KEY: '',
        NODE_ENV: 'test',
      },
      PROJECT_ROOT: '/tmp/animus-test',
      DATA_DIR: '/tmp/animus-test/data',
    }));
  });

  it('throws on encrypt when key not set', async () => {
    const mod = await import('../../src/lib/encryption-service.js');
    expect(mod.isConfigured()).toBe(false);
    expect(() => mod.encrypt('my-key')).toThrow('resolveSecrets()');
  });

  it('rejects legacy plain: format', async () => {
    const mod = await import('../../src/lib/encryption-service.js');
    expect(() => mod.decrypt('plain:dGVzdA==')).toThrow('resolveSecrets()');
  });
});
