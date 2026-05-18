import type { OAuthStatusEvent } from './cortex-credential-service.js';

export type OAuthAuthInfoLike = {
  url: string;
  instructions?: string;
  deviceCode?: string;
  flowType?: 'browser' | 'localhost_callback' | 'device_code';
  manualCodeRecommended?: boolean;
  callbackPort?: number;
  callbackPath?: string;
};

export type OAuthPromptInfoLike = {
  message: string;
  placeholder?: string;
  allowEmpty?: boolean;
};

const DEVICE_CODE_INSTRUCTIONS_RE = /\benter\s+code:\s*([A-Z0-9-]+)/i;
const OAUTH_CALLBACK_ROUTES: Record<string, { port: number; path: string }> = {
  anthropic: { port: 53692, path: '/callback' },
  'openai-codex': { port: 1455, path: '/auth/callback' },
};

export function normalizeOAuthAuthInfo(
  provider: string,
  info: OAuthAuthInfoLike | string,
  legacyInstructions?: string,
): OAuthAuthInfoLike {
  const raw = typeof info === 'string'
    ? { url: info, instructions: legacyInstructions }
    : info;
  const deviceCode = raw.deviceCode
    ?? raw.instructions?.match(DEVICE_CODE_INSTRUCTIONS_RE)?.[1];
  const isKnownDeviceCodeProvider = provider === 'github-copilot';
  const callbackRoute = OAUTH_CALLBACK_ROUTES[provider];
  const flowType = raw.flowType
    ?? (deviceCode || isKnownDeviceCodeProvider ? 'device_code'
      : callbackRoute ? 'localhost_callback'
      : 'browser');

  return {
    ...raw,
    ...(deviceCode ? { deviceCode } : {}),
    flowType,
    manualCodeRecommended: raw.manualCodeRecommended
      ?? (flowType === 'localhost_callback' && callbackRoute ? true : undefined),
    callbackPort: raw.callbackPort ?? (flowType === 'localhost_callback' ? callbackRoute?.port : undefined),
    callbackPath: raw.callbackPath ?? (flowType === 'localhost_callback' ? callbackRoute?.path : undefined),
  };
}

export function createOAuthAuthUrlEvent(authInfo: OAuthAuthInfoLike): Extract<OAuthStatusEvent, { type: 'auth_url' }> {
  return {
    type: 'auth_url',
    url: authInfo.url,
    ...(authInfo.instructions !== undefined ? { instructions: authInfo.instructions } : {}),
    ...(authInfo.deviceCode !== undefined ? { deviceCode: authInfo.deviceCode } : {}),
    ...(authInfo.flowType !== undefined ? { flowType: authInfo.flowType } : {}),
    ...(authInfo.manualCodeRecommended !== undefined ? { manualCodeRecommended: authInfo.manualCodeRecommended } : {}),
    ...(authInfo.callbackPort !== undefined ? { callbackPort: authInfo.callbackPort } : {}),
    ...(authInfo.callbackPath !== undefined ? { callbackPath: authInfo.callbackPath } : {}),
  };
}

export function createOAuthPromptEvent(prompt: OAuthPromptInfoLike): Extract<OAuthStatusEvent, { type: 'prompt' }> {
  return {
    type: 'prompt',
    message: prompt.message,
    ...(prompt.placeholder !== undefined ? { placeholder: prompt.placeholder } : {}),
    ...(prompt.allowEmpty !== undefined ? { allowEmpty: prompt.allowEmpty } : {}),
  };
}
