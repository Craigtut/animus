import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../logger.js';

describe('redactSecrets', () => {
  it('redacts Anthropic API keys', () => {
    const input = 'key=sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
    expect(redactSecrets(input)).toBe('key=[REDACTED:sk-ant-***]');
  });

  it('redacts OpenAI project keys', () => {
    const input = 'key=sk-proj-abcdefghijklmnopqrstuvwxyz';
    expect(redactSecrets(input)).toBe('key=[REDACTED:sk-proj-***]');
  });

  it('redacts generic sk- keys', () => {
    const input = 'key=sk-abcdefghijklmnopqrstuvwxyz1234';
    expect(redactSecrets(input)).toBe('key=[REDACTED:sk-***]');
  });

  it('passes through non-matching strings unchanged', () => {
    const input = 'Normal log message with no secrets';
    expect(redactSecrets(input)).toBe(input);
  });

  it('redacts multiple keys in same string', () => {
    const input = 'keys: sk-ant-api03-abcdefghijklmnopqrstuvwxyz and sk-proj-1234567890abcdefghijklmn';
    const result = redactSecrets(input);
    expect(result).toContain('[REDACTED:sk-ant-***]');
    expect(result).toContain('[REDACTED:sk-proj-***]');
    expect(result).not.toContain('sk-ant-api03');
    expect(result).not.toContain('sk-proj-1234');
  });

  it('does not redact short sk- strings (less than 20 chars)', () => {
    const input = 'sk-short';
    expect(redactSecrets(input)).toBe(input);
  });
});
