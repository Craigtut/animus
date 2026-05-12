export const OAUTH_DISPLAY_SUFFIX: Record<string, string> = {
  anthropic: '(Claude)',
  'openai-codex': '(ChatGPT)',
};

export const OAUTH_DESCRIPTIONS: Record<string, string> = {
  anthropic: 'Use your Claude Pro or Max subscription',
  'openai-codex': 'Use your ChatGPT Plus or Pro subscription',
  'github-copilot': 'Use your GitHub Copilot subscription',
};

export interface OAuthCardInfo {
  id: string;
  name: string;
  description: string;
}

export function buildOAuthCards(
  providers: Array<{ id: string; name: string; authMethods: string[] }>,
): OAuthCardInfo[] {
  return providers
    .filter(p => p.authMethods.includes('oauth'))
    .map(p => ({
      id: p.id,
      name: OAUTH_DISPLAY_SUFFIX[p.id] ? `${p.name} ${OAUTH_DISPLAY_SUFFIX[p.id]}` : p.name,
      description: OAUTH_DESCRIPTIONS[p.id] ?? `Sign in with your ${p.name} account`,
    }));
}
