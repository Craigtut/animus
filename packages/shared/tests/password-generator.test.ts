/**
 * Password Generator Tests
 */

import { describe, it, expect } from 'vitest';
import { generatePassword } from '../src/password-generator.js';

describe('generatePassword', () => {
  it('should generate a password of default length 32', () => {
    const pw = generatePassword();
    expect(pw.length).toBe(32);
  });

  it('should respect custom length', () => {
    const pw = generatePassword({ length: 16 });
    expect(pw.length).toBe(16);
  });

  it('should clamp length to minimum 8', () => {
    const pw = generatePassword({ length: 3 });
    expect(pw.length).toBe(8);
  });

  it('should clamp length to maximum 128', () => {
    const pw = generatePassword({ length: 200 });
    expect(pw.length).toBe(128);
  });

  it('should contain at least one uppercase letter', () => {
    // Run multiple times to ensure it's not flaky
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword();
      expect(pw).toMatch(/[A-Z]/);
    }
  });

  it('should contain at least one lowercase letter', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword();
      expect(pw).toMatch(/[a-z]/);
    }
  });

  it('should contain at least one digit', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword();
      expect(pw).toMatch(/[0-9]/);
    }
  });

  it('should contain at least one symbol by default', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword();
      expect(pw).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it('should not contain symbols when excludeSymbols is true', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword({ excludeSymbols: true });
      expect(pw).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it('should still have uppercase, lowercase, and digits with excludeSymbols', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword({ excludeSymbols: true, length: 8 });
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
    }
  });

  it('should generate unique passwords', () => {
    const passwords = new Set<string>();
    for (let i = 0; i < 100; i++) {
      passwords.add(generatePassword());
    }
    // All 100 should be unique
    expect(passwords.size).toBe(100);
  });

  it('should work at minimum length with all character sets', () => {
    const pw = generatePassword({ length: 8 });
    expect(pw.length).toBe(8);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[0-9]/);
    expect(pw).toMatch(/[^A-Za-z0-9]/);
  });
});
