/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Eye,
  EyeSlash,
  CheckCircle,
  XCircle,
  ShieldCheck,
  Copy,
  ArrowSquareOut,
  CircleNotch,
} from '@phosphor-icons/react';
import { Button, Input, SelectionCard, Typography } from '../../components/ui';
import { useOnboardingStore } from '../../store';
import { OnboardingNav } from './OnboardingNav';
import { trpc } from '../../utils/trpc';

type Provider = 'claude' | 'codex';

export function AgentProviderStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep } = useOnboardingStore();

  const [provider, setProvider] = useState<Provider>('claude');
  const [credential, setCredential] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [validated, setValidated] = useState<'idle' | 'validating' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [authMethod, setAuthMethod] = useState<'cli' | 'key' | 'codex_oauth' | null>(null);
  const [codexOAuthSession, setCodexOAuthSession] = useState<string | null>(null);

  // Codex OAuth UI state
  const [codexOAuthData, setCodexOAuthData] = useState<{
    userCode: string;
    verificationUrl: string;
    expiresIn: number;
  } | null>(null);
  const [codexOAuthStatus, setCodexOAuthStatus] = useState<'idle' | 'pending' | 'success' | 'error' | 'expired' | 'cancelled'>('idle');
  const [codexOAuthMessage, setCodexOAuthMessage] = useState('');
  const [codexCountdown, setCodexCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  // Detection query
  const { data: detectData } = trpc.provider.detect.useQuery();

  // Mutations
  const validateMutation = trpc.provider.validateKey.useMutation();
  const saveKeyMutation = trpc.provider.saveKey.useMutation();
  const useCliMutation = trpc.provider.useCli.useMutation();
  const codexInitiateMutation = trpc.codexAuth.initiate.useMutation();
  const codexCancelMutation = trpc.codexAuth.cancel.useMutation();

  // Codex OAuth status subscription
  trpc.codexAuth.status.useSubscription(
    { sessionId: codexOAuthSession! },
    {
      enabled: codexOAuthSession !== null && codexOAuthStatus === 'pending',
      onData: (data) => {
        if (data.status === 'success') {
          setCodexOAuthStatus('success');
          setAuthMethod('codex_oauth');
          stopCountdown();
        } else if (data.status === 'error') {
          setCodexOAuthStatus('error');
          setCodexOAuthMessage(data.message ?? 'Authorization failed');
          stopCountdown();
        } else if (data.status === 'expired') {
          setCodexOAuthStatus('expired');
          setCodexOAuthMessage('Authorization code expired');
          stopCountdown();
        } else if (data.status === 'cancelled') {
          setCodexOAuthStatus('cancelled');
          stopCountdown();
        }
      },
    }
  );

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  // Cleanup countdown on unmount
  useEffect(() => {
    return () => stopCountdown();
  }, [stopCountdown]);

  // Derive CLI detection from detect results
  const claudeDetect = detectData?.find((d) => d.provider === 'claude');
  const codexDetect = detectData?.find((d) => d.provider === 'codex');

  const claudeCliAvailable = claudeDetect?.methods.some((m) => m.method === 'cli' && m.available) ?? false;
  const codexCliAvailable = codexDetect?.methods.some((m) => m.method === 'cli' && m.available) ?? false;

  // Infer credential type from input prefix (client-side, for badge display)
  const inferredType = (() => {
    if (provider === 'claude') {
      if (credential.startsWith('sk-ant-oat01-')) return 'OAuth Token';
      if (credential.startsWith('sk-ant-api03-')) return 'API Key';
      if (credential.startsWith('sk-ant-')) return 'API Key';
    }
    if (provider === 'codex') {
      if (credential.startsWith('sk-')) return 'API Key';
    }
    return null;
  })();

  const handleValidate = async () => {
    if (!credential.trim()) return;
    setValidated('validating');
    setErrorMessage('');

    validateMutation.mutate(
      { provider, key: credential },
      {
        onSuccess: (result) => {
          if (result.valid) {
            // Auto-save on successful validation
            saveKeyMutation.mutate(
              { provider, key: credential, credentialType: result.credentialType as 'api_key' | 'oauth_token' | undefined },
              {
                onSuccess: () => {
                  setValidated('success');
                  setAuthMethod('key');
                },
                onError: (err) => {
                  setValidated('error');
                  setErrorMessage(err.message ?? 'Failed to save credential');
                },
              }
            );
          } else {
            setValidated('error');
            setErrorMessage(result.message);
          }
        },
        onError: (err) => {
          setValidated('error');
          setErrorMessage(err.message ?? 'Validation failed');
        },
      }
    );
  };

  const handleUseCli = () => {
    useCliMutation.mutate(
      { provider },
      {
        onSuccess: () => {
          setAuthMethod('cli');
        },
      }
    );
  };

  const handleCodexOAuthStart = async () => {
    setCodexOAuthStatus('pending');
    setCodexOAuthMessage('');
    setCodexOAuthData(null);

    codexInitiateMutation.mutate(undefined, {
      onSuccess: (result) => {
        setCodexOAuthData({
          userCode: result.userCode,
          verificationUrl: result.verificationUrl,
          expiresIn: result.expiresIn,
        });
        setCodexOAuthSession(result.sessionId);
        setCodexCountdown(result.expiresIn);

        // Start countdown timer
        stopCountdown();
        countdownRef.current = setInterval(() => {
          setCodexCountdown((prev) => {
            if (prev <= 1) {
              stopCountdown();
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      },
      onError: (err) => {
        setCodexOAuthStatus('error');
        setCodexOAuthMessage(err.message ?? 'Failed to start authentication');
      },
    });
  };

  const handleCodexOAuthCancel = () => {
    if (codexOAuthSession) {
      codexCancelMutation.mutate({ sessionId: codexOAuthSession });
    }
    setCodexOAuthStatus('cancelled');
    setCodexOAuthSession(null);
    setCodexOAuthData(null);
    stopCountdown();
  };

  const handleCodexOAuthRetry = () => {
    setCodexOAuthStatus('idle');
    setCodexOAuthSession(null);
    setCodexOAuthData(null);
    setCodexOAuthMessage('');
    stopCountdown();
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Fallback: select text
    }
  };

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleSwitchProvider = (p: Provider) => {
    setProvider(p);
    setValidated('idle');
    setCredential('');
    setErrorMessage('');
    setAuthMethod(null);
    // Reset Codex OAuth state when switching
    if (codexOAuthSession) {
      codexCancelMutation.mutate({ sessionId: codexOAuthSession });
    }
    setCodexOAuthStatus('idle');
    setCodexOAuthSession(null);
    setCodexOAuthData(null);
    setCodexOAuthMessage('');
    stopCountdown();
  };

  const canContinue = authMethod !== null;

  const handleContinue = () => {
    markStepComplete('agent_provider');
    setCurrentStep('identity');
    navigate('/onboarding/identity');
  };

  const handleBack = () => navigate('/onboarding/welcome');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[8]};`}>
      {/* Header */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
        <Typography.Title3 as="h2" serif css={css`font-weight: ${theme.typography.fontWeight.light};`}>
          The mind behind the curtain
        </Typography.Title3>
        <Typography.SmallBody color="secondary">
          Choose which AI will power your Animus. You can change this later in settings.
        </Typography.SmallBody>
      </div>

      {/* Provider cards */}
      <div css={css`
        display: grid; grid-template-columns: 1fr 1fr; gap: ${theme.spacing[4]};
        @media (max-width: ${theme.breakpoints.sm}) { grid-template-columns: 1fr; }
      `}>
        {(['claude', 'codex'] as const).map((p) => {
          const isSelected = provider === p;
          return (
            <SelectionCard
              key={p}
              selected={isSelected}
              padding="lg"
              onClick={() => handleSwitchProvider(p)}
            >
              <Typography.Subtitle
                as="h3"
                css={css`
                  margin-bottom: ${theme.spacing[1]};
                  color: ${theme.colors.text.primary};
                `}
              >
                {p === 'claude' ? 'Claude' : 'Codex'}
              </Typography.Subtitle>
              <Typography.SmallBody css={css`
                color: ${theme.colors.text.secondary};
              `}>
                {p === 'claude'
                  ? 'The default choice. Full-featured and the most capable.'
                  : 'An alternative with strong agentic abilities.'}
              </Typography.SmallBody>
            </SelectionCard>
          );
        })}
      </div>

      {/* Auth methods */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>

        {/* CLI detection card */}
        {((provider === 'claude' && claudeCliAvailable) || (provider === 'codex' && codexCliAvailable)) && (
          <div css={css`
            padding: ${theme.spacing[4]};
            border-radius: ${theme.borderRadius.md};
            border: 1px solid ${theme.colors.border.default};
            background: ${theme.colors.background.elevated};
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: ${theme.spacing[3]};
          `}>
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[0.5]};`}>
              <Typography.SmallBodyAlt>
                {provider === 'claude' ? 'Claude Code' : 'Codex CLI'} detected and authenticated
              </Typography.SmallBodyAlt>
              <Typography.Caption color="hint">
                Use your existing CLI installation
              </Typography.Caption>
            </div>
            {authMethod === 'cli' ? (
              <Typography.SmallBody as="span" color={theme.colors.success.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                <CheckCircle size={16} weight="fill" /> Using CLI
              </Typography.SmallBody>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleUseCli}
                loading={useCliMutation.isPending}
              >
                Use existing installation
              </Button>
            )}
          </div>
        )}

        {/* Divider */}
        {((provider === 'claude' && claudeCliAvailable) || (provider === 'codex' && codexCliAvailable)) && (
          <div css={css`
            display: flex;
            align-items: center;
            gap: ${theme.spacing[3]};
          `}>
            <div css={css`flex: 1; height: 1px; background: ${theme.colors.border.light};`} />
            <Typography.Caption color="disabled">{provider === 'codex' ? 'or choose an authentication method' : 'or enter credentials manually'}</Typography.Caption>
            <div css={css`flex: 1; height: 1px; background: ${theme.colors.border.light};`} />
          </div>
        )}

        {/* Claude: key/token input */}
        {provider === 'claude' && (
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
            <div css={css`position: relative;`}>
              <Input
                label="API Key or OAuth Token"
                type={showKey ? 'text' : 'password'}
                value={credential}
                onChange={(e) => {
                  setCredential((e.target as HTMLInputElement).value);
                  setValidated('idle');
                  setErrorMessage('');
                }}
                placeholder="sk-ant-api03-... or sk-ant-oat01-..."
                helperText="Paste an API key (sk-ant-api03-...) or an OAuth token from claude setup-token (sk-ant-oat01-...)"
                rightElement={
                  <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                    {inferredType && credential.length > 8 && (
                      <Typography.Caption color="hint" css={css`
                        background: ${theme.colors.background.elevated};
                        padding: 2px ${theme.spacing[1.5]};
                        border-radius: ${theme.borderRadius.sm};
                        white-space: nowrap;
                      `}>
                        {inferredType}
                      </Typography.Caption>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      css={css`
                        color: ${theme.colors.text.hint};
                        display: flex; padding: 0;
                        &:hover { color: ${theme.colors.text.primary}; }
                      `}
                    >
                      {showKey ? <EyeSlash size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                }
              />
            </div>

            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleValidate}
                loading={validated === 'validating'}
                disabled={!credential}
              >
                Validate
              </Button>
              {validated === 'success' && (
                <Typography.SmallBody as="span" color={theme.colors.success.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                  <CheckCircle size={16} weight="fill" /> Verified and saved
                </Typography.SmallBody>
              )}
              {validated === 'error' && (
                <Typography.SmallBody as="span" color={theme.colors.error.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                  <XCircle size={16} weight="fill" /> {errorMessage || 'Invalid credential'}
                </Typography.SmallBody>
              )}
            </div>

            <Typography.Caption
              as="a"
              href="https://console.anthropic.com"
              target="_blank"
              rel="noopener noreferrer"
              color="hint"
              css={css`
                display: inline-flex;
                align-items: center;
                gap: ${theme.spacing[1]};
                text-decoration: none;
                &:hover { color: ${theme.colors.text.secondary}; text-decoration: underline; }
              `}
            >
              Get an API key at console.anthropic.com <ArrowSquareOut size={12} />
            </Typography.Caption>
          </div>
        )}

        {/* Codex: ChatGPT OAuth + API key */}
        {provider === 'codex' && codexOAuthStatus === 'idle' && (
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            {/* Option A: ChatGPT Sign In */}
            <div css={css`
              padding: ${theme.spacing[4]};
              border-radius: ${theme.borderRadius.md};
              border: 1px solid ${theme.colors.border.default};
              display: flex;
              flex-direction: column;
              gap: ${theme.spacing[3]};
            `}>
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[0.5]};`}>
                <Typography.SmallBodyAlt>
                  ChatGPT Sign In
                </Typography.SmallBodyAlt>
                <Typography.Caption color="hint">
                  Use your ChatGPT subscription (Plus/Pro/Team)
                </Typography.Caption>
              </div>
              <Button
                size="sm"
                onClick={handleCodexOAuthStart}
                loading={codexInitiateMutation.isPending}
              >
                Sign in with ChatGPT
              </Button>
              <Typography.Caption color="disabled">
                Requires "Device code authentication" enabled in ChatGPT security settings
              </Typography.Caption>
            </div>

            {/* Divider */}
            <div css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[3]};
            `}>
              <div css={css`flex: 1; height: 1px; background: ${theme.colors.border.light};`} />
              <Typography.Caption color="disabled">or</Typography.Caption>
              <div css={css`flex: 1; height: 1px; background: ${theme.colors.border.light};`} />
            </div>

            {/* Option B: API Key */}
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
              <Input
                label="API Key"
                type={showKey ? 'text' : 'password'}
                value={credential}
                onChange={(e) => {
                  setCredential((e.target as HTMLInputElement).value);
                  setValidated('idle');
                  setErrorMessage('');
                }}
                placeholder="sk-proj-..."
                rightElement={
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    css={css`
                      color: ${theme.colors.text.hint};
                      display: flex; padding: 0;
                      &:hover { color: ${theme.colors.text.primary}; }
                    `}
                  >
                    {showKey ? <EyeSlash size={18} /> : <Eye size={18} />}
                  </button>
                }
              />

              <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleValidate}
                  loading={validated === 'validating'}
                  disabled={!credential}
                >
                  Validate
                </Button>
                {validated === 'success' && (
                  <Typography.SmallBody as="span" color={theme.colors.success.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                    <CheckCircle size={16} weight="fill" /> Verified and saved
                  </Typography.SmallBody>
                )}
                {validated === 'error' && (
                  <Typography.SmallBody as="span" color={theme.colors.error.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                    <XCircle size={16} weight="fill" /> {errorMessage || 'Invalid key'}
                  </Typography.SmallBody>
                )}
              </div>

              <Typography.Caption
                as="a"
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                color="hint"
                css={css`
                  display: inline-flex;
                  align-items: center;
                  gap: ${theme.spacing[1]};
                  text-decoration: none;
                  &:hover { color: ${theme.colors.text.secondary}; text-decoration: underline; }
                `}
              >
                Get an API key at platform.openai.com/api-keys <ArrowSquareOut size={12} />
              </Typography.Caption>
            </div>
          </div>
        )}

        {/* Codex OAuth: device code flow in progress */}
        {provider === 'codex' && codexOAuthStatus === 'pending' && codexOAuthData && (
          <div css={css`
            padding: ${theme.spacing[5]};
            border-radius: ${theme.borderRadius.md};
            border: 1px solid ${theme.colors.border.default};
            display: flex;
            flex-direction: column;
            gap: ${theme.spacing[4]};
          `}>
            <div>
              <Typography.SmallBody color="secondary" css={css`margin-bottom: ${theme.spacing[2]};`}>
                <Typography.Caption as="span" color="hint">1.</Typography.Caption>{' '}
                Open in your browser:
              </Typography.SmallBody>
              <Typography.SmallBodyAlt
                as="a"
                href={codexOAuthData.verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
                css={css`
                  display: inline-flex;
                  align-items: center;
                  gap: ${theme.spacing[1]};
                  text-decoration: none;
                  &:hover { text-decoration: underline; }
                `}
              >
                {codexOAuthData.verificationUrl} <ArrowSquareOut size={14} />
              </Typography.SmallBodyAlt>
            </div>

            <div>
              <Typography.SmallBody color="secondary" css={css`margin-bottom: ${theme.spacing[2]};`}>
                <Typography.Caption as="span" color="hint">2.</Typography.Caption>{' '}
                Enter this code:
              </Typography.SmallBody>
              <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                <Typography.Subtitle as="code" css={css`
                  font-weight: ${theme.typography.fontWeight.semibold};
                  letter-spacing: 0.15em;
                  background: ${theme.colors.background.elevated};
                  padding: ${theme.spacing[2]} ${theme.spacing[4]};
                  border-radius: ${theme.borderRadius.sm};
                  border: 1px solid ${theme.colors.border.default};
                `}>
                  {codexOAuthData.userCode}
                </Typography.Subtitle>
                <button
                  onClick={() => handleCopyCode(codexOAuthData.userCode)}
                  css={css`
                    display: flex;
                    align-items: center;
                    gap: ${theme.spacing[1]};
                    padding: ${theme.spacing[1]} ${theme.spacing[2]};
                    border-radius: ${theme.borderRadius.sm};
                    color: ${codeCopied ? theme.colors.success.main : theme.colors.text.hint};
                    cursor: pointer;
                    &:hover { color: ${codeCopied ? theme.colors.success.main : theme.colors.text.primary}; }
                  `}
                >
                  <Typography.Caption as="span" color={codeCopied ? theme.colors.success.main : theme.colors.text.hint}>
                    {codeCopied ? <CheckCircle size={14} /> : <Copy size={14} />}
                    {codeCopied ? ' Copied' : ' Copy'}
                  </Typography.Caption>
                </button>
              </div>
            </div>

            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
              <CircleNotch
                size={16}
                css={css`
                  color: ${theme.colors.text.hint};
                  animation: spin 1s linear infinite;
                  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                `}
              />
              <Typography.SmallBody as="span" color="secondary">
                Waiting for authorization...
              </Typography.SmallBody>
              {codexCountdown > 0 && (
                <Typography.Caption color="disabled" css={css`margin-left: auto;`}>
                  Expires in {formatCountdown(codexCountdown)}
                </Typography.Caption>
              )}
            </div>

            <Button variant="ghost" size="sm" onClick={handleCodexOAuthCancel}>
              Cancel
            </Button>
          </div>
        )}

        {/* Codex OAuth: success */}
        {provider === 'codex' && codexOAuthStatus === 'success' && (
          <div css={css`
            padding: ${theme.spacing[4]};
            border-radius: ${theme.borderRadius.md};
            border: 1px solid ${theme.colors.success.main}33;
            background: ${theme.colors.success.main}0d;
            display: flex;
            align-items: center;
            gap: ${theme.spacing[2]};
          `}>
            <CheckCircle size={20} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
            <Typography.SmallBody as="span" color={theme.colors.success.main}>
              Signed in with ChatGPT successfully
            </Typography.SmallBody>
          </div>
        )}

        {/* Codex OAuth: error/expired */}
        {provider === 'codex' && (codexOAuthStatus === 'error' || codexOAuthStatus === 'expired') && (
          <div css={css`
            padding: ${theme.spacing[4]};
            border-radius: ${theme.borderRadius.md};
            border: 1px solid ${theme.colors.error.main}33;
            background: ${theme.colors.error.main}0d;
            display: flex;
            flex-direction: column;
            gap: ${theme.spacing[3]};
          `}>
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
              <XCircle size={20} weight="fill" css={css`color: ${theme.colors.error.main}; flex-shrink: 0;`} />
              <Typography.SmallBody as="span" color={theme.colors.error.main}>
                {codexOAuthMessage || 'Authorization failed'}
              </Typography.SmallBody>
            </div>
            <Button variant="secondary" size="sm" onClick={handleCodexOAuthRetry}>
              Try again
            </Button>
          </div>
        )}

        {/* Security footnote */}
        <div css={css`
          display: flex; align-items: center; gap: ${theme.spacing[1.5]};
          margin-top: ${theme.spacing[1]};
        `}>
          <ShieldCheck size={14} css={css`flex-shrink: 0; color: ${theme.colors.text.disabled};`} />
          <Typography.Caption color="disabled">
            Stored locally on your server, encrypted at rest. Never leaves your instance.
          </Typography.Caption>
        </div>
      </div>

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
        continueDisabled={!canContinue}
      />
    </div>
  );
}
