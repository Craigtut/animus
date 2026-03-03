import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

// Mock logger
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { encrypt, decrypt, setDek, clearDek, isConfigured } from '../encryption-service.js';

describe('EncryptionService', () => {
  const testDek = randomBytes(32);

  beforeEach(() => {
    // Start each test with a fresh DEK
    setDek(Buffer.from(testDek));
  });

  describe('setDek / clearDek / isConfigured', () => {
    it('isConfigured returns true after setDek', () => {
      expect(isConfigured()).toBe(true);
    });

    it('isConfigured returns false after clearDek', () => {
      clearDek();
      expect(isConfigured()).toBe(false);
    });

    it('isConfigured returns false before any DEK is set', () => {
      clearDek();
      expect(isConfigured()).toBe(false);
    });
  });

  describe('encrypt / decrypt', () => {
    it('encrypts and decrypts a string', () => {
      const plaintext = 'my secret API key';
      const ciphertext = encrypt(plaintext);
      expect(ciphertext).not.toBe(plaintext);
      expect(decrypt(ciphertext)).toBe(plaintext);
    });

    it('produces iv:ct:tag format', () => {
      const ciphertext = encrypt('hello');
      const parts = ciphertext.split(':');
      expect(parts).toHaveLength(3);
      // Each part should be valid base64
      for (const part of parts) {
        expect(() => Buffer.from(part, 'base64')).not.toThrow();
      }
    });

    it('produces unique ciphertexts for the same plaintext (random IV)', () => {
      const a = encrypt('same text');
      const b = encrypt('same text');
      expect(a).not.toBe(b);
      // Both should decrypt to the same value
      expect(decrypt(a)).toBe('same text');
      expect(decrypt(b)).toBe('same text');
    });

    it('handles empty string', () => {
      const ciphertext = encrypt('');
      expect(decrypt(ciphertext)).toBe('');
    });

    it('handles unicode text', () => {
      const plaintext = 'Hello, world! Special chars: key_123';
      const ciphertext = encrypt(plaintext);
      expect(decrypt(ciphertext)).toBe(plaintext);
    });

    it('throws on invalid ciphertext format', () => {
      expect(() => decrypt('not:valid')).toThrow(/Invalid ciphertext format/);
      expect(() => decrypt('single')).toThrow(/Invalid ciphertext format/);
    });

    it('throws on tampered ciphertext', () => {
      const ciphertext = encrypt('secret');
      const parts = ciphertext.split(':');
      // Tamper with the ciphertext portion
      parts[1] = Buffer.from('tampered').toString('base64');
      expect(() => decrypt(parts.join(':'))).toThrow();
    });
  });

  describe('sealed state', () => {
    it('encrypt throws when sealed', () => {
      clearDek();
      expect(() => encrypt('test')).toThrow(/sealed/i);
    });

    it('decrypt throws when sealed', () => {
      const ciphertext = encrypt('test');
      clearDek();
      expect(() => decrypt(ciphertext)).toThrow(/sealed/i);
    });

    it('works again after re-setting DEK', () => {
      const ciphertext = encrypt('test');
      clearDek();
      setDek(Buffer.from(testDek));
      expect(decrypt(ciphertext)).toBe('test');
    });
  });

  describe('key mismatch', () => {
    it('fails to decrypt with a different key', () => {
      const ciphertext = encrypt('secret');
      // Set a different DEK
      setDek(randomBytes(32));
      expect(() => decrypt(ciphertext)).toThrow();
    });
  });
});
