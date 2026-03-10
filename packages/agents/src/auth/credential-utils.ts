/**
 * Credential Utilities -- pure logic for credential type inference,
 * validation, and onboarding file management.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createTaggedLogger, type Logger } from '../logger.js';

let log: Logger = createTaggedLogger('CredentialUtils');

export type CredentialType = 'api_key' | 'oauth_token' | 'codex_oauth' | 'cli_detected';

/**
 * Auto-detect credential type from the key prefix.
 */
export function inferCredentialType(
  provider: string,
  key: string,
): CredentialType {
  if (provider === 'claude') {
    if (key.startsWith('sk-ant-oat01-')) return 'oauth_token';
    if (key.startsWith('sk-ant-api03-')) return 'api_key';
    if (key.startsWith('sk-ant-')) return 'api_key';
    return 'api_key';
  }
  if (provider === 'codex') {
    if (key.startsWith('sk-proj-')) return 'api_key';
    return 'api_key';
  }
  return 'api_key';
}

/**
 * Ensure ~/.claude.json has hasCompletedOnboarding: true.
 * Required for headless Claude SDK usage.
 */
export function ensureClaudeOnboardingFile(logger?: Logger): void {
  const l = logger ?? log;
  try {
    const filePath = join(homedir(), '.claude.json');

    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf8');
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(content) as Record<string, unknown>;
      } catch {
        data = {};
      }

      if (data['hasCompletedOnboarding'] === true) {
        return;
      }

      data['hasCompletedOnboarding'] = true;
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } else {
      writeFileSync(filePath, JSON.stringify({ hasCompletedOnboarding: true }, null, 2));
    }
  } catch (err) {
    l.warn('Failed to ensure Claude onboarding file', { error: String(err) });
  }
}

/**
 * Validate a Claude credential against the Anthropic API.
 */
export async function validateClaudeCredential(
  key: string,
  credentialType: CredentialType,
): Promise<{ valid: boolean; message: string }> {
  const headers: Record<string, string> = {
    'anthropic-version': '2023-06-01',
  };

  if (credentialType === 'oauth_token') {
    headers['Authorization'] = `Bearer ${key}`;
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  } else {
    headers['x-api-key'] = key;
  }

  const response = await fetch('https://api.anthropic.com/v1/models', {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (response.ok) {
    return { valid: true, message: 'Credential verified successfully' };
  }
  if (response.status === 401) {
    return { valid: false, message: 'Invalid credential — authentication failed' };
  }
  if (response.status === 403) {
    return { valid: true, message: 'Credential accepted (limited permissions)' };
  }
  return { valid: false, message: `Validation failed with status ${response.status}` };
}

/**
 * Validate a Codex/OpenAI credential against the OpenAI API.
 */
export async function validateCodexCredential(
  key: string,
): Promise<{ valid: boolean; message: string }> {
  const response = await fetch('https://api.openai.com/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (response.ok) {
    return { valid: true, message: 'API key verified successfully' };
  }
  if (response.status === 401) {
    return { valid: false, message: 'Invalid API key — authentication failed' };
  }
  return { valid: false, message: `Validation failed with status ${response.status}` };
}
