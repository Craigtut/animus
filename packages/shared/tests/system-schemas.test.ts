import { describe, expect, it } from 'vitest';
import { loginInputSchema, registerInputSchema } from '../src/schemas/system.js';

describe('auth schemas', () => {
  it('accepts password-only login input', () => {
    expect(loginInputSchema.parse({ password: 'correct-password' })).toEqual({
      password: 'correct-password',
    });
  });

  it('accepts password-only registration input', () => {
    expect(
      registerInputSchema.parse({
        password: 'correct-password',
        confirmPassword: 'correct-password',
      })
    ).toEqual({
      password: 'correct-password',
      confirmPassword: 'correct-password',
    });
  });

  it('rejects mismatched registration passwords', () => {
    expect(() =>
      registerInputSchema.parse({
        password: 'correct-password',
        confirmPassword: 'different-password',
      })
    ).toThrow(/Passwords do not match/);
  });
});
