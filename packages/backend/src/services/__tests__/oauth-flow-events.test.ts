import { describe, expect, it } from 'vitest';
import {
  createOAuthAuthUrlEvent,
  createOAuthPromptEvent,
  normalizeOAuthAuthInfo,
} from '../oauth-flow-events.js';

describe('oauth flow event helpers', () => {
  it('extracts device codes from provider instructions', () => {
    const result = normalizeOAuthAuthInfo(
      'github-copilot',
      'https://github.com/login/device',
      'Enter code: ABCD-1234',
    );

    expect(result).toEqual({
      url: 'https://github.com/login/device',
      instructions: 'Enter code: ABCD-1234',
      deviceCode: 'ABCD-1234',
      flowType: 'device_code',
    });
  });

  it('preserves localhost callback metadata on auth URL events', () => {
    const authInfo = normalizeOAuthAuthInfo('anthropic', {
      url: 'https://claude.ai/oauth/authorize',
      instructions: 'Complete login in your browser.',
    });
    const event = createOAuthAuthUrlEvent(authInfo);

    expect(event).toEqual({
      type: 'auth_url',
      url: 'https://claude.ai/oauth/authorize',
      instructions: 'Complete login in your browser.',
      flowType: 'localhost_callback',
      manualCodeRecommended: true,
      callbackPort: 53692,
      callbackPath: '/callback',
    });
  });

  it('preserves prompt placeholder and allow-empty metadata', () => {
    const event = createOAuthPromptEvent({
      message: 'GitHub Enterprise URL/domain (blank for github.com)',
      placeholder: 'company.ghe.com',
      allowEmpty: true,
    });

    expect(event).toEqual({
      type: 'prompt',
      message: 'GitHub Enterprise URL/domain (blank for github.com)',
      placeholder: 'company.ghe.com',
      allowEmpty: true,
    });
  });
});
