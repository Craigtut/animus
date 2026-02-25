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
  Warning,
  ArrowsClockwise,
  Terminal,
} from '@phosphor-icons/react';
import { Button, SelectionCard, Tooltip, Typography } from '../../components/ui';
import { useOnboardingStore } from '../../store';
import { OnboardingNav } from './OnboardingNav';
import { trpc } from '../../utils/trpc';

type Provider = 'claude' | 'codex';
type ClaudeAuthTab = 'oauth' | 'api_key';
type CodexAuthTab = 'chatgpt' | 'api_key';

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

  // Auth method tabs
  const [claudeAuthTab, setClaudeAuthTab] = useState<ClaudeAuthTab>('oauth');
  const [codexAuthTab, setCodexAuthTab] = useState<CodexAuthTab>('chatgpt');

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
  const { data: detectData, refetch: refetchDetect, isFetching: isDetecting } = trpc.provider.detect.useQuery();

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

  // CLI binary installed on the system (required prerequisite)
  const claudeCliInstalled = claudeDetect?.cliInstalled ?? false;
  const codexCliInstalled = codexDetect?.cliInstalled ?? false;

  // CLI installed AND authenticated (credentials/auth files found)
  const claudeCliAvailable = claudeDetect?.methods.some((m) => m.method === 'cli' && m.available) ?? false;
  const codexCliAvailable = codexDetect?.methods.some((m) => m.method === 'cli' && m.available) ?? false;

  // Is the selected provider's CLI installed?
  const selectedCliInstalled = provider === 'claude' ? claudeCliInstalled : codexCliInstalled;

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

  // Shared styles
  const tabBarCss = css`
    display: flex;
    gap: ${theme.spacing[1]};
    border-bottom: 1px solid ${theme.colors.border.default};
  `;

  const tabCss = (active: boolean) => css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing[1.5]};
    padding: ${theme.spacing[2]} ${theme.spacing[4]};
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: ${theme.typography.fontSize.sm};
    font-weight: ${active ? theme.typography.fontWeight.medium : theme.typography.fontWeight.normal};
    color: ${active ? theme.colors.text.primary : theme.colors.text.hint};
    border-bottom: 2px solid ${active ? theme.colors.text.primary : 'transparent'};
    transition: color ${theme.transitions.fast}, border-color ${theme.transitions.fast};
    &:hover { color: ${theme.colors.text.primary}; }
  `;

  const tabPanelCss = css`
    padding: ${theme.spacing[4]} 0 0;
  `;

  // Credential input + inline validate row
  const renderCredentialInput = (opts: {
    label: string;
    placeholder: string;
    helpLink: { text: string; url: string };
  }) => (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
      {/* Label row with security tooltip */}
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[1.5]};`}>
        <label css={css`
          font-size: ${theme.typography.fontSize.sm};
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${theme.colors.text.secondary};
        `}>
          {opts.label}
        </label>
        <Tooltip content="Stored locally, encrypted at rest. Never leaves your instance." position="top">
          <ShieldCheck size={14} css={css`color: ${theme.colors.text.disabled}; cursor: help;`} />
        </Tooltip>
      </div>

      {/* Input + Validate button inline */}
      <div css={css`display: flex; gap: ${theme.spacing[2]}; align-items: flex-start;`}>
        <div css={css`flex: 1; position: relative;`}>
          <input
            type={showKey ? 'text' : 'password'}
            value={credential}
            onChange={(e) => {
              setCredential(e.target.value);
              setValidated('idle');
              setErrorMessage('');
            }}
            placeholder={opts.placeholder}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && credential.trim()) handleValidate();
            }}
            css={css`
              width: 100%;
              padding: ${theme.spacing[3]} ${theme.spacing[3]};
              padding-right: ${theme.spacing[10]};
              background: ${theme.colors.background.paper};
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
              border: 1px solid ${validated === 'error' ? theme.colors.error.main : validated === 'success' ? theme.colors.success.main : theme.colors.border.default};
              border-radius: ${theme.borderRadius.default};
              color: ${theme.colors.text.primary};
              font-size: ${theme.typography.fontSize.sm};
              line-height: ${theme.typography.lineHeight.normal};
              transition: border-color ${theme.transitions.fast};
              outline: none;
              &:focus { border-color: ${validated === 'error' ? theme.colors.error.main : validated === 'success' ? theme.colors.success.main : theme.colors.border.focus}; }
              &::placeholder { color: ${theme.colors.text.hint}; }
            `}
          />
          <div css={css`
            position: absolute;
            right: ${theme.spacing[3]};
            top: 50%;
            transform: translateY(-50%);
            display: flex;
            align-items: center;
            gap: ${theme.spacing[2]};
          `}>
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
                display: flex; padding: 0; background: none; border: none; cursor: pointer;
                &:hover { color: ${theme.colors.text.primary}; }
              `}
            >
              {showKey ? <EyeSlash size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <Button
          variant={validated === 'success' ? 'secondary' : 'primary'}
          size="sm"
          onClick={handleValidate}
          loading={validated === 'validating'}
          disabled={!credential.trim()}
          css={css`
            flex-shrink: 0;
            min-width: 90px;
            height: 38px;
          `}
        >
          {validated === 'success' ? (
            <span css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
              <CheckCircle size={14} weight="fill" /> Saved
            </span>
          ) : 'Validate'}
        </Button>
      </div>

      {/* Validation feedback */}
      {validated === 'error' && (
        <Typography.Caption as="span" color={theme.colors.error.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
          <XCircle size={12} weight="fill" /> {errorMessage || 'Invalid credential'}
        </Typography.Caption>
      )}

      {/* Help link */}
      <Typography.Caption
        as="a"
        href={opts.helpLink.url}
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
        {opts.helpLink.text} <ArrowSquareOut size={12} />
      </Typography.Caption>
    </div>
  );

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* Header — hierarchy flipped */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <Typography.SmallBody color="secondary" serif css={css`
          font-style: italic;
          letter-spacing: 0.01em;
        `}>
          The mind behind the curtain
        </Typography.SmallBody>
        <Typography.Title3 as="h2" css={css`
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          Choose which AI will power your Animus
        </Typography.Title3>
      </div>

      {/* Provider cards */}
      <div css={css`
        display: grid; grid-template-columns: 1fr 1fr; gap: ${theme.spacing[3]};
        @media (max-width: ${theme.breakpoints.sm}) { grid-template-columns: 1fr; }
      `}>
        {(['claude', 'codex'] as const).map((p) => {
          const isSelected = provider === p;
          const isInstalled = p === 'claude' ? claudeCliInstalled : codexCliInstalled;
          return (
            <SelectionCard
              key={p}
              selected={isSelected}
              padding="md"
              onClick={() => handleSwitchProvider(p)}
            >
              <div css={css`display: flex; align-items: center; justify-content: space-between; margin-bottom: ${theme.spacing[0.5]};`}>
                <Typography.SmallBodyAlt
                  as="h3"
                  css={css`color: ${theme.colors.text.primary};`}
                >
                  {p === 'claude' ? 'Claude' : 'Codex'}
                </Typography.SmallBodyAlt>
                {detectData && (
                  <Typography.Tiny
                    color={isInstalled ? theme.colors.success.main : theme.colors.text.disabled}
                    css={css`display: flex; align-items: center; gap: 3px;`}
                  >
                    {isInstalled ? (
                      <><CheckCircle size={10} weight="fill" /> Installed</>
                    ) : (
                      'Not installed'
                    )}
                  </Typography.Tiny>
                )}
              </div>
              <Typography.Caption css={css`color: ${theme.colors.text.hint};`}>
                {p === 'claude'
                  ? 'Full-featured, most capable.'
                  : 'Strong agentic abilities.'}
              </Typography.Caption>
            </SelectionCard>
          );
        })}
      </div>

      {/* ============================================================
          CLI not installed — blocking prerequisite
          ============================================================ */}
      {detectData && !selectedCliInstalled && (
        <div css={css`
          padding: ${theme.spacing[4]};
          border-radius: ${theme.borderRadius.md};
          border: 1px solid ${theme.colors.warning.main}33;
          background: ${theme.colors.warning.main}08;
          display: flex;
          flex-direction: column;
          gap: ${theme.spacing[3]};
        `}>
          <div css={css`display: flex; align-items: flex-start; gap: ${theme.spacing[3]};`}>
            <Warning size={20} weight="fill" css={css`color: ${theme.colors.warning.main}; flex-shrink: 0; margin-top: 1px;`} />
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
              <Typography.SmallBodyAlt>
                {provider === 'claude' ? 'Claude Code' : 'Codex'} CLI required
              </Typography.SmallBodyAlt>
              <Typography.Caption color="secondary">
                Install the {provider === 'claude' ? 'Claude Code' : 'Codex'} CLI first, then return here to authenticate.
              </Typography.Caption>
            </div>
          </div>

          <div css={css`
            background: ${theme.colors.background.elevated};
            border-radius: ${theme.borderRadius.sm};
            border: 1px solid ${theme.colors.border.default};
            padding: ${theme.spacing[3]} ${theme.spacing[3]};
            display: flex;
            flex-direction: column;
            gap: ${theme.spacing[1.5]};
          `}>
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
              <Terminal size={13} css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`} />
              <Typography.SmallBody as="code" css={css`
                font-family: ${theme.typography.fontFamily.mono};
                font-size: ${theme.typography.fontSize.xs};
                user-select: all;
              `}>
                {provider === 'claude'
                  ? 'npm install -g @anthropic-ai/claude-code'
                  : 'npm install -g @openai/codex'}
              </Typography.SmallBody>
            </div>
            {provider === 'claude' && (
              <Typography.Tiny color="hint" css={css`margin-left: 25px;`}>
                or: brew install claude-code
              </Typography.Tiny>
            )}
          </div>

          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => refetchDetect()}
              loading={isDetecting}
            >
              <ArrowsClockwise size={13} css={css`margin-right: ${theme.spacing[1]};`} />
              Check again
            </Button>
            <Typography.Caption
              as="a"
              href={provider === 'claude'
                ? 'https://docs.anthropic.com/en/docs/claude-code/getting-started'
                : 'https://github.com/openai/codex'}
              target="_blank"
              rel="noopener noreferrer"
              color="hint"
              css={css`
                display: inline-flex; align-items: center; gap: ${theme.spacing[1]};
                text-decoration: none;
                &:hover { color: ${theme.colors.text.secondary}; text-decoration: underline; }
              `}
            >
              Installation guide <ArrowSquareOut size={11} />
            </Typography.Caption>
          </div>
        </div>
      )}

      {/* ============================================================
          Authentication section — only when CLI is installed
          ============================================================ */}
      {selectedCliInstalled && (
        <div css={css`display: flex; flex-direction: column; gap: 0;`}>

          {/* CLI detected and authenticated — top-level card */}
          {((provider === 'claude' && claudeCliAvailable) || (provider === 'codex' && codexCliAvailable)) && (
            <div css={css`
              padding: ${theme.spacing[3]} ${theme.spacing[4]};
              border-radius: ${theme.borderRadius.md};
              border: 1px solid ${authMethod === 'cli' ? theme.colors.success.main + '33' : theme.colors.border.default};
              background: ${authMethod === 'cli' ? theme.colors.success.main + '08' : theme.colors.background.elevated};
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: ${theme.spacing[3]};
              margin-bottom: ${theme.spacing[4]};
            `}>
              <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                <CheckCircle size={16} weight="fill" css={css`color: ${theme.colors.success.main};`} />
                <Typography.SmallBody>
                  {provider === 'claude' ? 'Claude Code' : 'Codex'} authenticated
                </Typography.SmallBody>
              </div>
              {authMethod === 'cli' ? (
                <Typography.Caption as="span" color={theme.colors.success.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                  Active
                </Typography.Caption>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleUseCli}
                  loading={useCliMutation.isPending}
                >
                  Use CLI auth
                </Button>
              )}
            </div>
          )}

          {/* CLI installed but not authenticated */}
          {!((provider === 'claude' && claudeCliAvailable) || (provider === 'codex' && codexCliAvailable)) && (
            <div css={css`
              padding: ${theme.spacing[3]} ${theme.spacing[4]};
              border-radius: ${theme.borderRadius.md};
              border: 1px solid ${theme.colors.border.default};
              background: ${theme.colors.background.elevated};
              display: flex;
              align-items: center;
              gap: ${theme.spacing[2]};
              margin-bottom: ${theme.spacing[4]};
            `}>
              <Terminal size={15} css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`} />
              <Typography.Caption color="secondary">
                CLI installed. Authenticate below, or run{' '}
                <code css={css`font-family: ${theme.typography.fontFamily.mono}; font-size: inherit;`}>
                  {provider === 'claude' ? 'claude login' : 'codex auth'}
                </code>
                {' '}in your terminal.
              </Typography.Caption>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetchDetect()}
                loading={isDetecting}
                css={css`margin-left: auto; flex-shrink: 0;`}
              >
                <ArrowsClockwise size={12} />
              </Button>
            </div>
          )}

          {/* ========== CLAUDE AUTH TABS ========== */}
          {provider === 'claude' && (
            <div>
              <div css={tabBarCss}>
                <button onClick={() => { setClaudeAuthTab('oauth'); setCredential(''); setValidated('idle'); setErrorMessage(''); }} css={tabCss(claudeAuthTab === 'oauth')}>
                  OAuth Token
                </button>
                <button onClick={() => { setClaudeAuthTab('api_key'); setCredential(''); setValidated('idle'); setErrorMessage(''); }} css={tabCss(claudeAuthTab === 'api_key')}>
                  API Key
                </button>
              </div>

              <div css={tabPanelCss}>
                {claudeAuthTab === 'oauth' && renderCredentialInput({
                  label: 'OAuth Token',
                  placeholder: 'sk-ant-oat01-...',
                  helpLink: {
                    text: 'Generate a token with: claude setup-token',
                    url: 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
                  },
                })}

                {claudeAuthTab === 'api_key' && renderCredentialInput({
                  label: 'API Key',
                  placeholder: 'sk-ant-api03-...',
                  helpLink: {
                    text: 'Get an API key at console.anthropic.com',
                    url: 'https://console.anthropic.com',
                  },
                })}
              </div>
            </div>
          )}

          {/* ========== CODEX AUTH TABS ========== */}
          {provider === 'codex' && (
            <div>
              <div css={tabBarCss}>
                <button onClick={() => { setCodexAuthTab('chatgpt'); setCredential(''); setValidated('idle'); setErrorMessage(''); }} css={tabCss(codexAuthTab === 'chatgpt')}>
                  ChatGPT Sign In
                </button>
                <button onClick={() => { setCodexAuthTab('api_key'); setCredential(''); setValidated('idle'); setErrorMessage(''); }} css={tabCss(codexAuthTab === 'api_key')}>
                  API Key
                </button>
              </div>

              <div css={tabPanelCss}>
                {/* ChatGPT OAuth tab */}
                {codexAuthTab === 'chatgpt' && codexOAuthStatus === 'idle' && (
                  <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
                    <Typography.Caption color="secondary">
                      Use your ChatGPT subscription (Plus/Pro/Team)
                    </Typography.Caption>
                    <Button
                      size="sm"
                      onClick={handleCodexOAuthStart}
                      loading={codexInitiateMutation.isPending}
                    >
                      Sign in with ChatGPT
                    </Button>
                    <Typography.Tiny color="disabled">
                      Requires "Device code authentication" enabled in ChatGPT security settings
                    </Typography.Tiny>
                  </div>
                )}

                {/* ChatGPT OAuth: device code flow in progress */}
                {codexAuthTab === 'chatgpt' && codexOAuthStatus === 'pending' && codexOAuthData && (
                  <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
                    <div>
                      <Typography.Caption color="hint" css={css`margin-bottom: ${theme.spacing[1]};`}>
                        1. Open in your browser:
                      </Typography.Caption>
                      <Typography.SmallBodyAlt
                        as="a"
                        href={codexOAuthData.verificationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        css={css`
                          display: inline-flex; align-items: center; gap: ${theme.spacing[1]};
                          text-decoration: none;
                          &:hover { text-decoration: underline; }
                        `}
                      >
                        {codexOAuthData.verificationUrl} <ArrowSquareOut size={13} />
                      </Typography.SmallBodyAlt>
                    </div>

                    <div>
                      <Typography.Caption color="hint" css={css`margin-bottom: ${theme.spacing[1]};`}>
                        2. Enter this code:
                      </Typography.Caption>
                      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                        <Typography.SmallBodyAlt as="code" css={css`
                          font-weight: ${theme.typography.fontWeight.semibold};
                          letter-spacing: 0.15em;
                          background: ${theme.colors.background.elevated};
                          padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
                          border-radius: ${theme.borderRadius.sm};
                          border: 1px solid ${theme.colors.border.default};
                        `}>
                          {codexOAuthData.userCode}
                        </Typography.SmallBodyAlt>
                        <button
                          onClick={() => handleCopyCode(codexOAuthData.userCode)}
                          css={css`
                            display: flex; align-items: center; gap: 4px;
                            padding: ${theme.spacing[1]} ${theme.spacing[1.5]};
                            border-radius: ${theme.borderRadius.sm};
                            color: ${codeCopied ? theme.colors.success.main : theme.colors.text.hint};
                            cursor: pointer; background: none; border: none;
                            &:hover { color: ${codeCopied ? theme.colors.success.main : theme.colors.text.primary}; }
                          `}
                        >
                          <Typography.Tiny as="span" color={codeCopied ? theme.colors.success.main : theme.colors.text.hint}>
                            {codeCopied ? <><CheckCircle size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                          </Typography.Tiny>
                        </button>
                      </div>
                    </div>

                    <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                      <CircleNotch
                        size={14}
                        css={css`
                          color: ${theme.colors.text.hint};
                          animation: spin 1s linear infinite;
                          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                        `}
                      />
                      <Typography.Caption as="span" color="secondary">
                        Waiting for authorization...
                      </Typography.Caption>
                      {codexCountdown > 0 && (
                        <Typography.Tiny color="disabled" css={css`margin-left: auto;`}>
                          {formatCountdown(codexCountdown)}
                        </Typography.Tiny>
                      )}
                    </div>

                    <Button variant="ghost" size="sm" onClick={handleCodexOAuthCancel}>
                      Cancel
                    </Button>
                  </div>
                )}

                {/* ChatGPT OAuth: success */}
                {codexAuthTab === 'chatgpt' && codexOAuthStatus === 'success' && (
                  <div css={css`
                    display: flex; align-items: center; gap: ${theme.spacing[2]};
                    padding: ${theme.spacing[3]};
                    border-radius: ${theme.borderRadius.sm};
                    background: ${theme.colors.success.main}0d;
                    border: 1px solid ${theme.colors.success.main}33;
                  `}>
                    <CheckCircle size={18} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
                    <Typography.SmallBody as="span" color={theme.colors.success.main}>
                      Signed in with ChatGPT
                    </Typography.SmallBody>
                  </div>
                )}

                {/* ChatGPT OAuth: error/expired */}
                {codexAuthTab === 'chatgpt' && (codexOAuthStatus === 'error' || codexOAuthStatus === 'expired') && (
                  <div css={css`
                    display: flex; flex-direction: column; gap: ${theme.spacing[3]};
                    padding: ${theme.spacing[3]};
                    border-radius: ${theme.borderRadius.sm};
                    background: ${theme.colors.error.main}0d;
                    border: 1px solid ${theme.colors.error.main}33;
                  `}>
                    <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                      <XCircle size={18} weight="fill" css={css`color: ${theme.colors.error.main}; flex-shrink: 0;`} />
                      <Typography.SmallBody as="span" color={theme.colors.error.main}>
                        {codexOAuthMessage || 'Authorization failed'}
                      </Typography.SmallBody>
                    </div>
                    <Button variant="secondary" size="sm" onClick={handleCodexOAuthRetry}>
                      Try again
                    </Button>
                  </div>
                )}

                {/* API Key tab */}
                {codexAuthTab === 'api_key' && renderCredentialInput({
                  label: 'API Key',
                  placeholder: 'sk-proj-...',
                  helpLink: {
                    text: 'Get an API key at platform.openai.com',
                    url: 'https://platform.openai.com/api-keys',
                  },
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
        continueDisabled={!canContinue}
        continueTooltip={!canContinue ? 'Authenticate with your provider to continue' : undefined}
      />
    </div>
  );
}
