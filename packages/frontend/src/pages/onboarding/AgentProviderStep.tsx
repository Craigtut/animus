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
  CaretRight,
  SignOut,
} from '@phosphor-icons/react';
import { Button, SelectionCard, Tooltip, Typography } from '../../components/ui';
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
  const [authMethod, setAuthMethod] = useState<'cli' | 'key' | 'codex_oauth' | 'claude_oauth' | null>(null);
  const [codexOAuthSession, setCodexOAuthSession] = useState<string | null>(null);

  // Claude OAuth state (spawns `claude auth login`)
  const [claudeOAuthSession, setClaudeOAuthSession] = useState<string | null>(null);
  const [claudeOAuthStatus, setClaudeOAuthStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [claudeOAuthMessage, setClaudeOAuthMessage] = useState('');

  // Codex CLI auth state (spawns `codex login`)
  const [codexCliAuthSession, setCodexCliAuthSession] = useState<string | null>(null);
  const [codexCliAuthStatus, setCodexCliAuthStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [codexCliAuthMessage, setCodexCliAuthMessage] = useState('');

  // Codex device-code OAuth UI state
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

  // Collapsible alternative methods
  const [altMethodsExpanded, setAltMethodsExpanded] = useState(false);

  // Detection query
  const { data: detectData, refetch: refetchDetect, isFetching: isDetecting } = trpc.provider.detect.useQuery();

  // Mutations
  const validateMutation = trpc.provider.validateKey.useMutation();
  const saveKeyMutation = trpc.provider.saveKey.useMutation();
  const useCliMutation = trpc.provider.useCli.useMutation();

  // Device-code OAuth (Codex)
  const codexInitiateMutation = trpc.codexAuth.initiate.useMutation();
  const codexCancelMutation = trpc.codexAuth.cancel.useMutation();

  // CLI auth (Claude: `claude auth login`)
  const claudeInitiateMutation = trpc.claudeAuth.initiate.useMutation();
  const claudeCancelMutation = trpc.claudeAuth.cancel.useMutation();
  const claudeLogoutMutation = trpc.claudeAuth.logout.useMutation({
    onSuccess: () => refetchDetect(),
  });

  // CLI auth (Codex: `codex login`)
  const codexCliInitiateMutation = trpc.codexCliAuth.initiate.useMutation();
  const codexCliCancelMutation = trpc.codexCliAuth.cancel.useMutation();
  const codexCliLogoutMutation = trpc.codexCliAuth.logout.useMutation({
    onSuccess: () => refetchDetect(),
  });

  // Claude OAuth status subscription
  trpc.claudeAuth.status.useSubscription(
    { sessionId: claudeOAuthSession! },
    {
      enabled: claudeOAuthSession !== null && claudeOAuthStatus === 'pending',
      onData: (data) => {
        if (data.status === 'success') {
          setClaudeOAuthStatus('success');
          setAuthMethod('claude_oauth');
          refetchDetect();
        } else if (data.status === 'error') {
          setClaudeOAuthStatus('error');
          setClaudeOAuthMessage(data.message ?? 'Authentication failed');
        } else if (data.status === 'cancelled') {
          setClaudeOAuthStatus('idle');
        }
      },
    }
  );

  // Codex CLI auth status subscription
  trpc.codexCliAuth.status.useSubscription(
    { sessionId: codexCliAuthSession! },
    {
      enabled: codexCliAuthSession !== null && codexCliAuthStatus === 'pending',
      onData: (data) => {
        if (data.status === 'success') {
          setCodexCliAuthStatus('success');
          setAuthMethod('cli');
          refetchDetect();
        } else if (data.status === 'error') {
          setCodexCliAuthStatus('error');
          setCodexCliAuthMessage(data.message ?? 'Authentication failed');
        } else if (data.status === 'cancelled') {
          setCodexCliAuthStatus('idle');
        }
      },
    }
  );

  // Codex device-code OAuth status subscription
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

  // Is the selected provider's CLI installed / authenticated?
  const selectedCliInstalled = provider === 'claude' ? claudeCliInstalled : codexCliInstalled;
  const cliAvailable = provider === 'claude' ? claudeCliAvailable : codexCliAvailable;

  // Auto-set authMethod when CLI is already authenticated
  useEffect(() => {
    if (cliAvailable && authMethod === null) {
      setAuthMethod('cli');
    }
  }, [cliAvailable, authMethod]);

  const canContinue = authMethod !== null || cliAvailable;

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

  // CLI sign-in handlers
  const handleClaudeOAuthStart = async () => {
    setClaudeOAuthStatus('pending');
    setClaudeOAuthMessage('');
    claudeInitiateMutation.mutate(undefined, {
      onSuccess: (result) => {
        setClaudeOAuthSession(result.sessionId);
        // The mutation now awaits auth completion and returns the result directly
        if (result.status === 'success') {
          setClaudeOAuthStatus('success');
          setAuthMethod('claude_oauth');
          refetchDetect();
        } else if (result.status === 'error') {
          setClaudeOAuthStatus('error');
          setClaudeOAuthMessage(result.message ?? 'Authentication failed');
        }
      },
      onError: (err) => {
        setClaudeOAuthStatus('error');
        setClaudeOAuthMessage(err.message ?? 'Failed to start authentication');
      },
    });
  };

  const handleClaudeOAuthCancel = () => {
    if (claudeOAuthSession) claudeCancelMutation.mutate({ sessionId: claudeOAuthSession });
    setClaudeOAuthStatus('idle');
    setClaudeOAuthSession(null);
  };

  const handleCodexCliAuthStart = async () => {
    setCodexCliAuthStatus('pending');
    setCodexCliAuthMessage('');
    codexCliInitiateMutation.mutate(undefined, {
      onSuccess: (result) => setCodexCliAuthSession(result.sessionId),
      onError: (err) => {
        setCodexCliAuthStatus('error');
        setCodexCliAuthMessage(err.message ?? 'Failed to start authentication');
      },
    });
  };

  const handleCodexCliAuthCancel = () => {
    if (codexCliAuthSession) codexCliCancelMutation.mutate({ sessionId: codexCliAuthSession });
    setCodexCliAuthStatus('idle');
    setCodexCliAuthSession(null);
  };

  // Sign out
  const handleSignOut = (p: Provider) => {
    if (p === 'claude') {
      claudeLogoutMutation.mutate();
    } else {
      codexCliLogoutMutation.mutate();
    }
    setAuthMethod(null);
    // Reset any in-progress auth flows
    setClaudeOAuthStatus('idle');
    setClaudeOAuthSession(null);
    setCodexCliAuthStatus('idle');
    setCodexCliAuthSession(null);
  };

  // Codex device-code OAuth handlers (alternative method)
  const handleCodexOAuthStart = async () => {
    setCodexOAuthStatus('pending');
    setCodexOAuthMessage('');
    setCodexOAuthData(null);
    codexInitiateMutation.mutate(undefined, {
      onSuccess: (result) => {
        setCodexOAuthData({
          userCode: result.userCode ?? '',
          verificationUrl: result.verificationUrl ?? '',
          expiresIn: result.expiresIn ?? 0,
        });
        setCodexOAuthSession(result.sessionId);
        setCodexCountdown(result.expiresIn ?? 0);
        stopCountdown();
        countdownRef.current = setInterval(() => {
          setCodexCountdown((prev) => {
            if (prev <= 1) { stopCountdown(); return 0; }
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
    if (codexOAuthSession) codexCancelMutation.mutate({ sessionId: codexOAuthSession });
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
    setAltMethodsExpanded(false);
    // Reset all OAuth/CLI auth state when switching
    if (codexOAuthSession) codexCancelMutation.mutate({ sessionId: codexOAuthSession });
    setCodexOAuthStatus('idle');
    setCodexOAuthSession(null);
    setCodexOAuthData(null);
    setCodexOAuthMessage('');
    stopCountdown();
    if (claudeOAuthSession) claudeCancelMutation.mutate({ sessionId: claudeOAuthSession });
    setClaudeOAuthStatus('idle');
    setClaudeOAuthSession(null);
    setClaudeOAuthMessage('');
    if (codexCliAuthSession) codexCliCancelMutation.mutate({ sessionId: codexCliAuthSession });
    setCodexCliAuthStatus('idle');
    setCodexCliAuthSession(null);
    setCodexCliAuthMessage('');
  };

  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation();
  const { data: persona } = trpc.persona.get.useQuery();

  const handleContinue = () => {
    // Persist selected provider to system settings (fire-and-forget; heartbeat
    // hasn't started yet so the write will land before the first tick)
    updateSettingsMutation.mutate({ defaultAgentProvider: provider });

    // If using CLI auth, save the cli_detected sentinel so Settings page
    // (which checks hasKey via the DB) knows credentials are configured
    if (authMethod === 'cli') {
      useCliMutation.mutate({ provider });
    }

    markStepComplete('agent_provider');

    // If persona is already finalized (restored from save), skip to main app
    if (persona?.isFinalized) {
      setCurrentStep('complete');
      navigate('/');
      return;
    }

    setCurrentStep('identity');
    navigate('/onboarding/identity');
  };

  const handleBack = () => navigate('/onboarding/welcome');

  // Credential input + inline validate row
  const renderCredentialInput = (opts: {
    label: string;
    placeholder: string;
    helpLink: { text: string; url: string };
  }) => (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
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

      <div css={css`display: flex; gap: ${theme.spacing[2]}; align-items: stretch;`}>
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
          css={css`flex-shrink: 0; min-width: 90px;`}
        >
          {validated === 'success' ? (
            <span css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
              <CheckCircle size={14} weight="fill" /> Saved
            </span>
          ) : 'Validate'}
        </Button>
      </div>

      {validated === 'error' && (
        <Typography.Caption as="span" color={theme.colors.error.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
          <XCircle size={12} weight="fill" /> {errorMessage || 'Invalid credential'}
        </Typography.Caption>
      )}

      <Typography.Caption
        as="a"
        href={opts.helpLink.url}
        target="_blank"
        rel="noopener noreferrer"
        color="hint"
        css={css`
          display: inline-flex; align-items: center; gap: ${theme.spacing[1]};
          text-decoration: none;
          &:hover { color: ${theme.colors.text.secondary}; text-decoration: underline; }
        `}
      >
        {opts.helpLink.text} <ArrowSquareOut size={12} />
      </Typography.Caption>
    </div>
  );

  // The pending/error UI for CLI sign-in flows (shared between Claude and Codex)
  const renderCliAuthFlow = (opts: {
    status: 'idle' | 'pending' | 'success' | 'error';
    message: string;
    onStart: () => void;
    onCancel: () => void;
    onRetry: () => void;
    isPending: boolean;
    label: string;
    subtitle: string;
  }) => {
    if (opts.status === 'idle') return null; // handled by the primary button
    if (opts.status === 'pending') {
      return (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
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
              Waiting for authentication... Complete sign-in in your browser.
            </Typography.Caption>
          </div>
          <Button variant="ghost" size="sm" onClick={opts.onCancel}>
            Cancel
          </Button>
        </div>
      );
    }
    if (opts.status === 'success') {
      return (
        <div css={css`
          display: flex; align-items: center; gap: ${theme.spacing[2]};
          padding: ${theme.spacing[3]};
          border-radius: ${theme.borderRadius.sm};
          background: ${theme.colors.success.main}0d;
          border: 1px solid ${theme.colors.success.main}33;
        `}>
          <CheckCircle size={18} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
          <Typography.SmallBody as="span" color={theme.colors.success.main}>
            {opts.label}
          </Typography.SmallBody>
        </div>
      );
    }
    // error
    return (
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
            {opts.message || 'Authentication failed'}
          </Typography.SmallBody>
        </div>
        <Button variant="secondary" size="sm" onClick={opts.onRetry}>
          Try again
        </Button>
      </div>
    );
  };

  // Get the current CLI auth flow status for the primary button
  const cliAuthStatus = provider === 'claude' ? claudeOAuthStatus : codexCliAuthStatus;
  const cliAuthMessage = provider === 'claude' ? claudeOAuthMessage : codexCliAuthMessage;
  const cliAuthIsPending = provider === 'claude' ? claudeInitiateMutation.isPending : codexCliInitiateMutation.isPending;

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* Header */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <Typography.Body color="secondary" serif css={css`
          font-style: italic;
        `}>
          The mind behind the curtain
        </Typography.Body>
        <Typography.Title3 as="h2" css={css`
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          Choose a provider for your Animus
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
              <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; margin-bottom: ${theme.spacing[0.5]};`}>
                <Typography.SmallBodyAlt
                  as="h3"
                  css={css`color: ${theme.colors.text.primary};`}
                >
                  {p === 'claude' ? 'Anthropic' : 'OpenAI'}
                </Typography.SmallBodyAlt>
                {detectData && (
                  <Typography.Tiny
                    color={isInstalled ? theme.colors.success.main : theme.colors.text.disabled}
                    css={css`display: flex; align-items: center; gap: 3px;`}
                  >
                    {isInstalled ? (
                      <><CheckCircle size={10} weight="fill" /> Available</>
                    ) : (
                      'SDK not found'
                    )}
                  </Typography.Tiny>
                )}
              </div>
              <Typography.Caption css={css`color: ${theme.colors.text.hint};`}>
                {p === 'claude'
                  ? 'Uses Claude Code under the hood'
                  : 'Uses Codex under the hood'}
              </Typography.Caption>
            </SelectionCard>
          );
        })}
      </div>

      {/* ============================================================
          State C: Agent SDK not available -- blocking prerequisite
          This should rarely trigger since SDKs are bundled with the app.
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
                {provider === 'claude' ? 'Claude' : 'Codex'} agent SDK not found
              </Typography.SmallBodyAlt>
              <Typography.Caption color="secondary">
                The {provider === 'claude' ? 'Claude Agent SDK' : 'Codex SDK'} component could not be located. Try reinstalling the application, or install the SDK package manually.
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
                  ? 'npm install @anthropic-ai/claude-agent-sdk'
                  : 'npm install @openai/codex-sdk'}
              </Typography.SmallBody>
            </div>
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
          </div>
        </div>
      )}

      {/* ============================================================
          State A: CLI already authenticated -- simple signed-in card
          ============================================================ */}
      {selectedCliInstalled && cliAvailable && (
        <div css={css`
          padding: ${theme.spacing[4]};
          border-radius: ${theme.borderRadius.md};
          border: 1px solid ${theme.colors.success.main}33;
          background: ${theme.colors.success.main}08;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: ${theme.spacing[3]};
        `}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
            <CheckCircle size={22} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
            <div>
              <Typography.SmallBodyAlt>
                {provider === 'claude' ? 'Claude' : 'Codex'} is signed in
              </Typography.SmallBodyAlt>
              <Typography.Caption color="hint">
                {provider === 'claude' ? 'Claude Code' : 'Codex'} CLI authenticated
              </Typography.Caption>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleSignOut(provider)}
            loading={provider === 'claude' ? claudeLogoutMutation.isPending : codexCliLogoutMutation.isPending}
            css={css`flex-shrink: 0;`}
          >
            <SignOut size={14} css={css`margin-right: ${theme.spacing[1]};`} />
            Sign out
          </Button>
        </div>
      )}

      {/* ============================================================
          State B: CLI installed, not authenticated
          ============================================================ */}
      {selectedCliInstalled && !cliAvailable && (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>

          {/* Primary CLI sign-in button */}
          {cliAuthStatus === 'idle' && (
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
              <Button
                size="md"
                onClick={provider === 'claude' ? handleClaudeOAuthStart : handleCodexCliAuthStart}
                loading={cliAuthIsPending}
                css={css`align-self: flex-start;`}
              >
                Sign in with {provider === 'claude' ? 'Claude' : 'ChatGPT'}
              </Button>
              <Typography.Tiny color="disabled">
                Recommended. Opens a browser to sign in.
              </Typography.Tiny>
            </div>
          )}

          {/* CLI auth flow pending/success/error states */}
          {renderCliAuthFlow({
            status: cliAuthStatus,
            message: cliAuthMessage,
            onStart: provider === 'claude' ? handleClaudeOAuthStart : handleCodexCliAuthStart,
            onCancel: provider === 'claude' ? handleClaudeOAuthCancel : handleCodexCliAuthCancel,
            onRetry: () => {
              if (provider === 'claude') {
                setClaudeOAuthStatus('idle');
                setClaudeOAuthSession(null);
                setClaudeOAuthMessage('');
              } else {
                setCodexCliAuthStatus('idle');
                setCodexCliAuthSession(null);
                setCodexCliAuthMessage('');
              }
            },
            isPending: cliAuthIsPending,
            label: `Signed in with ${provider === 'claude' ? 'Claude' : 'ChatGPT'}`,
            subtitle: '',
          })}

          {/* Collapsible alternative methods */}
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
            <button
              onClick={() => setAltMethodsExpanded(!altMethodsExpanded)}
              css={css`
                display: flex;
                align-items: center;
                gap: ${theme.spacing[1]};
                padding: 0;
                background: none;
                border: none;
                cursor: pointer;
                font-size: ${theme.typography.fontSize.sm};
                color: ${theme.colors.text.hint};
                &:hover { color: ${theme.colors.text.secondary}; }
              `}
            >
              <CaretRight
                size={12}
                css={css`
                  transition: transform 150ms ease;
                  transform: rotate(${altMethodsExpanded ? '90deg' : '0deg'});
                `}
              />
              Alternative sign-in methods
            </button>

            {altMethodsExpanded && (
              <div css={css`
                display: flex;
                flex-direction: column;
                gap: ${theme.spacing[4]};
                padding: ${theme.spacing[4]};
                border-radius: ${theme.borderRadius.md};
                border: 1px solid ${theme.colors.border.default};
                background: ${theme.colors.background.elevated};
              `}>

                {/* Codex device-code OAuth (only for Codex provider) */}
                {provider === 'codex' && (
                  <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
                    <Typography.SmallBodyAlt>OpenAI Subscription</Typography.SmallBodyAlt>
                    <Typography.Caption color="secondary">
                      Use your ChatGPT subscription (Plus/Pro/Team) via device code
                    </Typography.Caption>

                    {codexOAuthStatus === 'idle' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleCodexOAuthStart}
                        loading={codexInitiateMutation.isPending}
                        css={css`align-self: flex-start;`}
                      >
                        Sign in with device code
                      </Button>
                    )}

                    {codexOAuthStatus === 'pending' && codexOAuthData && (
                      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
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
                              background: ${theme.colors.background.paper};
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

                    {codexOAuthStatus === 'success' && (
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

                    {(codexOAuthStatus === 'error' || codexOAuthStatus === 'expired') && (
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

                    {provider === 'codex' && codexOAuthStatus === 'idle' && (
                      <Typography.Tiny color="disabled">
                        Requires "Device code authentication" enabled in ChatGPT security settings
                      </Typography.Tiny>
                    )}

                    <div css={css`
                      height: 1px;
                      background: ${theme.colors.border.default};
                      margin: ${theme.spacing[1]} 0;
                    `} />
                  </div>
                )}

                {/* API Key input */}
                {renderCredentialInput({
                  label: 'API Key',
                  placeholder: provider === 'claude' ? 'sk-ant-api03-...' : 'sk-proj-...',
                  helpLink: provider === 'claude'
                    ? { text: 'Get an API key at console.anthropic.com', url: 'https://console.anthropic.com' }
                    : { text: 'Get an API key at platform.openai.com', url: 'https://platform.openai.com/api-keys' },
                })}
              </div>
            )}
          </div>
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
