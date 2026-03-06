import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';

vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('EncryptionService', () => {
  let encrypt: typeof import('../../src/lib/encryption-service.js').encrypt;
  let decrypt: typeof import('../../src/lib/encryption-service.js').decrypt;
  let isConfigured: typeof import('../../src/lib/encryption-service.js').isConfigured;
  let setDek: typeof import('../../src/lib/encryption-service.js').setDek;
  let clearDek: typeof import('../../src/lib/encryption-service.js').clearDek;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/lib/encryption-service.js');
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
    isConfigured = mod.isConfigured;
    setDek = mod.setDek;
    clearDek = mod.clearDek;

    // Provide a 32-byte test DEK (AES-256 requires 32 bytes)
    setDek(randomBytes(32));
  });

  afterEach(() => {
    clearDek();
  });

  it('reports configured when DEK is set', () => {
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
    const plaintext = 'Hello world, special chars: e, n, u';
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

describe('EncryptionService (sealed)', () => {
  let encrypt: typeof import('../../src/lib/encryption-service.js').encrypt;
  let decrypt: typeof import('../../src/lib/encryption-service.js').decrypt;
  let isConfigured: typeof import('../../src/lib/encryption-service.js').isConfigured;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/lib/encryption-service.js');
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
    isConfigured = mod.isConfigured;
    // Do NOT call setDek — vault stays sealed
  });

  it('reports not configured when DEK is not set', () => {
    expect(isConfigured()).toBe(false);
  });

  it('throws on encrypt when vault is sealed', () => {
    expect(() => encrypt('my-key')).toThrow('Vault is sealed');
  });

  it('throws on decrypt when vault is sealed', () => {
    expect(() => decrypt('plain:dGVzdA==')).toThrow('Vault is sealed');
  });
});
