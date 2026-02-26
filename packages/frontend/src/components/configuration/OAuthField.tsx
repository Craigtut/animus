/** @jsxImportSource @emotion/react */
import { css, useTheme, keyframes } from '@emotion/react';
import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle,
  ShieldCheck,
  LinkBreak,
  ArrowSquareOut,
  XCircle,
  CircleNotch,
  PlugsConnected,
} from '@phosphor-icons/react';
import { Button, Typography, Tooltip } from '../ui';
import { trpc } from '../../utils/trpc';
import type { ConfigField } from '@animus-labs/shared';

// ============================================================================
// Types
// ============================================================================

interface OAuthFieldProps {
  field: ConfigField;
  pluginName: string;
  configValues: Record<string, unknown>;
  highlighted?: boolean | undefined;
}

type OAuthState = 'idle' | 'pending' | 'connected' | 'error';

// ============================================================================
// Animations
// ============================================================================

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`;

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
`;

// ============================================================================
// Component
// ============================================================================

export function OAuthField({ field, pluginName, configValues, highlighted }: OAuthFieldProps) {
  const theme = useTheme();

  // ── Local state ──
  const [oauthState, setOauthState] = useState<OAuthState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const providerName = field.oauth?.provider ?? 'Provider';

  // ── dependsOn check ──
  const dependenciesMet = !field.dependsOn || field.dependsOn.every((depKey) => {
    const val = configValues[depKey];
    return val !== undefined && val !== null && val !== '';
  });

  // ── tRPC queries & mutations ──
  const checkStatus = trpc.pluginOAuth.checkStatus.useQuery(
    { pluginName, configKey: field.key },
    { enabled: !!pluginName && oauthState !== 'pending' },
  );

  const initiateMutation = trpc.pluginOAuth.initiate.useMutation({
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setOauthState('pending');
      setErrorMessage(null);
      // Open the authorization URL in a new tab
      window.open(data.authorizationUrl, '_blank');
    },
    onError: (err) => {
      setOauthState('error');
      setErrorMessage(err.message ?? 'Failed to initiate OAuth flow');
    },
  });

  const disconnectMutation = trpc.pluginOAuth.disconnect.useMutation({
    onSuccess: () => {
      setOauthState('idle');
      setSessionId(null);
      checkStatus.refetch();
    },
    onError: (err) => {
      setErrorMessage(err.message ?? 'Failed to disconnect');
    },
  });

  // ── Subscription for pending state ──
  trpc.pluginOAuth.status.useSubscription(
    { sessionId: sessionId! },
    {
      enabled: sessionId !== null && oauthState === 'pending',
      onData: (data) => {
        if (data.status === 'success') {
          setOauthState('connected');
          setSessionId(null);
          checkStatus.refetch();
        } else if (data.status === 'error') {
          setOauthState('error');
          setErrorMessage(data.message ?? 'Authorization failed');
          setSessionId(null);
        }
      },
      onError: () => {
        setOauthState('error');
        setErrorMessage('Lost connection while waiting for authorization');
        setSessionId(null);
      },
    },
  );

  // ── Sync initial state from checkStatus ──
  useEffect(() => {
    if (checkStatus.data && oauthState !== 'pending') {
      setOauthState(checkStatus.data.connected ? 'connected' : 'idle');
    }
  }, [checkStatus.data, oauthState]);

  // ── Handlers ──
  const handleConnect = useCallback(() => {
    setErrorMessage(null);
    initiateMutation.mutate({ pluginName, configKey: field.key });
  }, [initiateMutation, pluginName, field.key]);

  const handleDisconnect = useCallback(() => {
    disconnectMutation.mutate({ pluginName, configKey: field.key });
  }, [disconnectMutation, pluginName, field.key]);

  const handleCancel = useCallback(() => {
    setOauthState('idle');
    setSessionId(null);
    setErrorMessage(null);
  }, []);

  const handleRetry = useCallback(() => {
    setOauthState('idle');
    setErrorMessage(null);
  }, []);

  // ── Styles ──
  const wrapperCss = css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing[1.5]};
    animation: ${highlighted ? css`${fadeIn} 300ms ease-out` : 'none'};
  `;

  const labelCss = css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing[1.5]};
    font-size: ${theme.typography.fontSize.sm};
    font-weight: ${theme.typography.fontWeight.medium};
    color: ${theme.colors.text.secondary};
  `;

  const fieldContainerCss = css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: ${theme.spacing[3]};
    border: 1px solid ${theme.colors.border.default};
    border-radius: ${theme.borderRadius.default};
    background: ${theme.colors.background.paper};
    min-height: 48px;
    transition: border-color ${theme.transitions.fast};
  `;

  // ── Render helpers ──

  const renderIdleState = () => (
    <div css={fieldContainerCss}>
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
        <PlugsConnected
          size={18}
          weight="duotone"
          css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`}
        />
        <Typography.SmallBody color="secondary">
          Not connected
        </Typography.SmallBody>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleConnect}
        disabled={!dependenciesMet || initiateMutation.isPending}
        loading={initiateMutation.isPending}
      >
        Connect to {providerName}
        <ArrowSquareOut size={14} css={css`margin-left: 2px;`} />
      </Button>
    </div>
  );

  const renderPendingState = () => (
    <div css={css`
      ${fieldContainerCss};
      border-color: ${theme.colors.info.main}33;
      background: ${theme.colors.info.main}08;
    `}>
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
        <CircleNotch
          size={18}
          weight="bold"
          css={css`
            color: ${theme.colors.info.main};
            flex-shrink: 0;
            animation: ${pulse} 1.5s ease-in-out infinite;
          `}
        />
        <Typography.SmallBody color="secondary">
          Waiting for authorization...
        </Typography.SmallBody>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCancel}
      >
        Cancel
      </Button>
    </div>
  );

  const renderConnectedState = () => (
    <div css={css`
      ${fieldContainerCss};
      border-color: ${theme.colors.success.main}33;
      background: ${theme.colors.success.main}08;
    `}>
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
        <CheckCircle
          size={18}
          weight="fill"
          css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`}
        />
        <Typography.SmallBody color={theme.colors.success.main} css={css`
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          Connected to {providerName}
        </Typography.SmallBody>
        {checkStatus.data?.expiresAt && (
          <Typography.Caption color="hint" css={css`margin-left: ${theme.spacing[1]};`}>
            Expires {new Date(checkStatus.data.expiresAt).toLocaleDateString()}
          </Typography.Caption>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleDisconnect}
        loading={disconnectMutation.isPending}
        css={css`
          color: ${theme.colors.text.hint};
          &:hover:not(:disabled) {
            color: ${theme.colors.error.main};
          }
        `}
      >
        <LinkBreak size={14} />
        Disconnect
      </Button>
    </div>
  );

  const renderErrorState = () => (
    <div css={css`
      ${fieldContainerCss};
      border-color: ${theme.colors.error.main}33;
      background: ${theme.colors.error.main}08;
    `}>
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; min-width: 0; flex: 1;`}>
        <XCircle
          size={18}
          weight="fill"
          css={css`color: ${theme.colors.error.main}; flex-shrink: 0;`}
        />
        <Typography.SmallBody color={theme.colors.error.main} css={css`
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        `}>
          {errorMessage || 'Authorization failed'}
        </Typography.SmallBody>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleRetry}
      >
        Retry
      </Button>
    </div>
  );

  // ── Main render ──
  return (
    <div css={wrapperCss}>
      {/* Label row */}
      <label css={labelCss}>
        {field.label}
        {field.required && (
          <span css={css`color: ${theme.colors.error.main}; margin-left: 2px;`}>*</span>
        )}
        <Tooltip content="Encrypted at rest and injected securely at runtime" position="top" align="right">
          <ShieldCheck
            size={14}
            weight="fill"
            css={css`color: ${theme.colors.success.main}; flex-shrink: 0; cursor: help;`}
          />
        </Tooltip>
      </label>

      {/* OAuth state rendering */}
      {oauthState === 'idle' && renderIdleState()}
      {oauthState === 'pending' && renderPendingState()}
      {oauthState === 'connected' && renderConnectedState()}
      {oauthState === 'error' && renderErrorState()}

      {/* Help text and dependency hint */}
      <div css={css`display: flex; flex-direction: column; gap: 2px;`}>
        {!dependenciesMet && (
          <Typography.Caption color="hint" css={css`
            font-style: italic;
          `}>
            Fill in the required fields above first
          </Typography.Caption>
        )}
        {field.helpText && (
          <Typography.Caption as="p" color="hint">
            {field.helpText}
          </Typography.Caption>
        )}
        {field.helpLink && (
          <a
            href={field.helpLink.url}
            target="_blank"
            rel="noopener noreferrer"
            css={css`
              display: inline-flex;
              align-items: center;
              gap: 3px;
              color: ${theme.colors.accent};
              font-size: 12px;
              text-decoration: none;
              &:hover { text-decoration: underline; }
            `}
          >
            {field.helpLink.label} <ArrowSquareOut size={11} />
          </a>
        )}
      </div>
    </div>
  );
}
