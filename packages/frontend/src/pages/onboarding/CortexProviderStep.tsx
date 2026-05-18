/** @jsxImportSource @emotion/react */
import { css, keyframes, useTheme } from '@emotion/react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle,
  XCircle,
  Copy,
  ArrowSquareOut,
  Eye,
  EyeSlash,
  CaretRight,
  ShieldCheck,
  SignOut,
} from '@phosphor-icons/react';
import { Button, Typography, Tooltip, Select, Slider } from '../../components/ui';
import { useOnboardingStore } from '../../store';
import { OnboardingNav } from './OnboardingNav';
import { trpc } from '../../utils/trpc';
import { buildOAuthCards } from '../../utils/provider-display';

// ============================================================================
// Component
// ============================================================================

export function CortexProviderStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep, setCortexProvider } = useOnboardingStore();

  // Status query
  const { data: statusData } = trpc.cortexProvider.getStatus.useQuery();
  const { data: allProviders } = trpc.cortexProvider.listProviders.useQuery();

  const oauthCards = useMemo(() => buildOAuthCards(allProviders ?? []), [allProviders]);

  // OAuth state
  const [oauthProvider, setOauthProvider] = useState<string | null>(null);
  const [oauthState, setOauthState] = useState<'idle' | 'authenticating' | 'success' | 'error'>('idle');
  const [oauthAuthUrl, setOauthAuthUrl] = useState<string | null>(null);
  const [oauthDeviceCode, setOauthDeviceCode] = useState<string | null>(null);
  const [oauthFlowType, setOauthFlowType] = useState<string | null>(null);
  const [oauthManualCodeRecommended, setOauthManualCodeRecommended] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);

  // API key state
  const [apiKeyExpanded, setApiKeyExpanded] = useState(false);
  const [apiKeyProvider, setApiKeyProvider] = useState('');
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [apiKeyValidation, setApiKeyValidation] = useState<'idle' | 'validating' | 'success' | 'error'>('idle');
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  // Custom endpoint state
  const [customExpanded, setCustomExpanded] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customModelId, setCustomModelId] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customValidation, setCustomValidation] = useState<'idle' | 'validating' | 'success' | 'error'>('idle');

  // OAuth prompt state (for manual paste flows in Docker/headless)
  const [oauthPromptMessage, setOauthPromptMessage] = useState<string | null>(null);
  const [oauthPromptPlaceholder, setOauthPromptPlaceholder] = useState('Paste here...');
  const [oauthPromptAllowEmpty, setOauthPromptAllowEmpty] = useState(false);
  const [oauthPromptValue, setOauthPromptValue] = useState('');

  // Connected provider info
  const [connectedProvider, setConnectedProvider] = useState<string | null>(null);
  const [connectedMethod, setConnectedMethod] = useState<string | null>(null);
  const [connectedDisplayName, setConnectedDisplayName] = useState<string | null>(null);
  const [connectedRefreshable, setConnectedRefreshable] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);

  // Model selection (shown after successful auth)
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  // Context window limit (advanced)
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [selectedContextLimit, setSelectedContextLimit] = useState<number | null | 'unset'>('unset');

  // Mutations
  const initiateOAuthMutation = trpc.cortexProvider.initiateOAuth.useMutation();
  const cancelOAuthMutation = trpc.cortexProvider.cancelOAuth.useMutation();
  const validateApiKeyMutation = trpc.cortexProvider.validateApiKey.useMutation();
  const saveApiKeyMutation = trpc.cortexProvider.saveApiKey.useMutation();
  const saveCustomMutation = trpc.cortexProvider.saveCustomEndpoint.useMutation();
  const testCustomMutation = trpc.cortexProvider.testCustomEndpoint.useMutation();
  const setActiveProviderMutation = trpc.cortexProvider.setActiveProvider.useMutation();
  const oauthRespondMutation = trpc.cortexProvider.oauthRespond.useMutation();
  const removeCredentialMutation = trpc.cortexProvider.removeCredential.useMutation();
  const setContextLimitMutation = trpc.cortexProvider.setContextWindowLimit.useMutation();
  const completeFromRestoreMutation = trpc.onboarding.completeFromRestore.useMutation();

  const utils = trpc.useUtils();

  const { data: persona } = trpc.persona.get.useQuery();

  // OAuth status subscription
  trpc.cortexProvider.oauthStatus.useSubscription(undefined, {
    enabled: oauthState === 'authenticating',
    onData: (event) => {
      if (event.type === 'auth_url') {
        setOauthAuthUrl(event.url);
        setOauthFlowType(event.flowType ?? null);
        setOauthManualCodeRecommended(event.manualCodeRecommended ?? false);
        if (event.deviceCode) setOauthDeviceCode(event.deviceCode);
      } else if (event.type === 'prompt') {
        // OAuth flow needs user input (e.g., paste redirect URL in Docker)
        setOauthPromptMessage(event.message);
        setOauthPromptPlaceholder(event.placeholder ?? 'Paste here...');
        setOauthPromptAllowEmpty(event.allowEmpty ?? false);
        setOauthPromptValue('');
      } else if (event.type === 'success') {
        setOauthState('success');
        setConnectedProvider(oauthProvider);
        setConnectedMethod('oauth');
        setConnectedDisplayName(event.meta?.displayName ?? null);
        setConnectedRefreshable(event.meta?.refreshable ?? false);
        setOauthAuthUrl(null);
        setOauthDeviceCode(null);
        setOauthFlowType(null);
        setOauthManualCodeRecommended(false);
        setOauthPromptMessage(null);
        utils.cortexProvider.getStatus.invalidate();
      } else if (event.type === 'error') {
        setOauthState('error');
        setOauthError(event.message);
        setOauthPromptMessage(null);
      }
    },
  });

  // Initialize from existing status. The status query is the source of truth:
  // OAuth can complete via the HTTP callback route without the subscription
  // delivering a `success` event, so clear any in-flight OAuth UI here too.
  useEffect(() => {
    if (statusData?.connected) {
      setConnectedProvider(statusData.provider ?? null);
      setConnectedMethod(statusData.method ?? null);
      setOauthState('idle');
      setOauthProvider(null);
      setOauthAuthUrl(null);
      setOauthDeviceCode(null);
      setOauthPromptMessage(null);
    }
  }, [statusData]);

  const providerForContinue = connectedProvider ?? statusData?.provider ?? null;
  const modelForContinue = selectedModel ?? statusData?.model ?? null;
  const canContinue = Boolean(
    providerForContinue
    && modelForContinue
    && (connectedProvider !== null || (statusData?.connected ?? false)),
  );

  // Providers that support API keys
  const apiKeyProviders = (allProviders ?? []).filter(
    (p) => p.authMethods.includes('api_key')
  );
  const selectedApiProvider = apiKeyProviders.find((p) => p.id === apiKeyProvider);

  useEffect(() => {
    if (!apiKeyProvider && apiKeyProviders.length > 0) {
      setApiKeyProvider(apiKeyProviders[0]!.id);
    }
  }, [apiKeyProvider, apiKeyProviders]);

  // ── Handlers ──

  const handleOAuthStart = useCallback((providerId: string) => {
    setOauthProvider(providerId);
    setOauthState('authenticating');
    setOauthError(null);
    setOauthAuthUrl(null);
    setOauthDeviceCode(null);
    setOauthFlowType(null);
    setOauthManualCodeRecommended(false);
    setOauthPromptMessage(null);
    setOauthPromptPlaceholder('Paste here...');
    setOauthPromptAllowEmpty(false);
    setUrlCopied(false);
    setCodeCopied(false);

    initiateOAuthMutation.mutate(
      { provider: providerId },
      {
        onSuccess: () => {
          // Success is handled by the subscription
        },
        onError: (err) => {
          setOauthState('error');
          setOauthError(err.message ?? 'Authentication failed');
        },
      }
    );
  }, [initiateOAuthMutation]);

  const handleOAuthCancel = useCallback(() => {
    cancelOAuthMutation.mutate();
    setOauthState('idle');
    setOauthProvider(null);
    setOauthAuthUrl(null);
    setOauthDeviceCode(null);
    setOauthFlowType(null);
    setOauthManualCodeRecommended(false);
    setOauthPromptMessage(null);
    setOauthPromptPlaceholder('Paste here...');
    setOauthPromptAllowEmpty(false);
    setUrlCopied(false);
    setCodeCopied(false);
  }, [cancelOAuthMutation]);

  const handleSignOut = useCallback((providerId: string) => {
    removeCredentialMutation.mutate(
      { provider: providerId },
      {
        onSuccess: () => {
          if (connectedProvider === providerId) {
            setConnectedProvider(null);
            setConnectedMethod(null);
          }
          utils.cortexProvider.getStatus.invalidate();
        },
      }
    );
  }, [removeCredentialMutation, connectedProvider, utils.cortexProvider.getStatus]);

  const handleValidateApiKey = useCallback(async () => {
    if (!apiKeyValue.trim()) return;
    setApiKeyValidation('validating');
    setApiKeyError(null);

    validateApiKeyMutation.mutate(
      { provider: apiKeyProvider, apiKey: apiKeyValue },
      {
        onSuccess: (result) => {
          if (result.valid) {
            saveApiKeyMutation.mutate(
              { provider: apiKeyProvider, apiKey: apiKeyValue },
              {
                onSuccess: () => {
                  setApiKeyValidation('success');
                  setConnectedProvider(apiKeyProvider);
                  setConnectedMethod('api_key');
                  utils.cortexProvider.getStatus.invalidate();
                },
                onError: (err) => {
                  setApiKeyValidation('error');
                  setApiKeyError(err.message ?? 'Failed to save key');
                },
              }
            );
          } else {
            setApiKeyValidation('error');
            setApiKeyError('Invalid API key. Check that you copied the full key.');
          }
        },
        onError: (err) => {
          setApiKeyValidation('error');
          setApiKeyError(err.message ?? 'Validation failed');
        },
      }
    );
  }, [apiKeyProvider, apiKeyValue, validateApiKeyMutation, saveApiKeyMutation, utils.cortexProvider.getStatus]);

  const handleTestCustom = useCallback(async () => {
    if (!customBaseUrl || !customModelId) return;
    setCustomValidation('validating');

    testCustomMutation.mutate(
      {
        baseUrl: customBaseUrl,
        modelId: customModelId,
        apiKey: customApiKey || undefined,
      },
      {
        onSuccess: (result) => {
          if (result.valid) {
            saveCustomMutation.mutate(
              {
                baseUrl: customBaseUrl,
                modelId: customModelId,
                apiKey: customApiKey || undefined,
              },
              {
                onSuccess: () => {
                  setCustomValidation('success');
                  setConnectedProvider('custom');
                  setConnectedMethod('custom');
                  utils.cortexProvider.getStatus.invalidate();
                },
                onError: () => setCustomValidation('error'),
              }
            );
          } else {
            setCustomValidation('error');
          }
        },
        onError: () => setCustomValidation('error'),
      }
    );
  }, [customBaseUrl, customModelId, customApiKey, testCustomMutation, saveCustomMutation, utils.cortexProvider.getStatus]);

  const handleOAuthPromptSubmit = useCallback(() => {
    if (!oauthPromptAllowEmpty && !oauthPromptValue.trim()) return;
    oauthRespondMutation.mutate({ response: oauthPromptValue.trim() });
    setOauthPromptMessage(null);
    setOauthPromptValue('');
  }, [oauthPromptAllowEmpty, oauthPromptValue, oauthRespondMutation]);

  const handleCopyCode = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Fallback
    }
  }, []);

  const handleCopyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    } catch {
      // Fallback
    }
  }, []);

  const handleContinue = useCallback(async () => {
    setContinueError(null);

    // Ensure active provider is registered. The OAuth/API key save flow
    // already sets the curated default model. Only call setActiveProvider
    // for env var detection where no save mutation ran.
    const provider = connectedProvider ?? statusData?.provider;
    if (provider && !statusData?.model) {
      try {
        // Use the selected model from the picker, or fall back to curated default
        const model = selectedModel ?? statusData?.model;
        if (model) {
          await setActiveProviderMutation.mutateAsync({ provider, model });
          setCortexProvider(provider, model);
        }
      } catch {
        // If setActiveProvider fails (already set by a save mutation), continue anyway
      }
    }
    // If a model was explicitly selected via the picker, apply it
    if (selectedModel && connectedProvider) {
      try {
        await setActiveProviderMutation.mutateAsync({ provider: connectedProvider, model: selectedModel });
        setCortexProvider(connectedProvider, selectedModel);
      } catch {
        // Already set, continue
      }
    }

    // Save context window limit if the user explicitly changed it
    if (selectedContextLimit !== 'unset') {
      try {
        await setContextLimitMutation.mutateAsync({ limit: selectedContextLimit });
      } catch {
        // Non-critical, continue anyway
      }
    }

    // If persona is already finalized (restored from save), skip to main app
    if (persona?.isFinalized) {
      try {
        const onboardingState = await completeFromRestoreMutation.mutateAsync();
        utils.onboarding.getState.setData(undefined, onboardingState);
        markStepComplete('agent_provider');
        setCurrentStep('complete');
        navigate('/');
      } catch (err) {
        setContinueError(err instanceof Error ? err.message : 'Connect an AI provider before continuing.');
      }
      return;
    }

    markStepComplete('agent_provider');
    setCurrentStep('identity');
    navigate('/onboarding/identity');
  }, [markStepComplete, setCurrentStep, navigate, persona?.isFinalized, connectedProvider, statusData?.provider, statusData?.model, setActiveProviderMutation, setCortexProvider, selectedModel, selectedContextLimit, setContextLimitMutation, completeFromRestoreMutation, utils.onboarding.getState]);

  const handleBack = () => navigate('/onboarding/welcome');

  // ── Render ──

  // Fetch model list for the connected provider
  const { data: connectedModels } = trpc.cortexProvider.listModels.useQuery(
    { provider: connectedProvider! },
    { enabled: !!connectedProvider }
  );

  // Initialize model selection from the backend's curated default
  useEffect(() => {
    if (connectedModels && connectedModels.length > 0 && !selectedModel) {
      // Use the model the backend already set (curated default), or first in list
      const activeModel = statusData?.model;
      if (activeModel && connectedModels.some(m => m.id === activeModel)) {
        setSelectedModel(activeModel);
      } else {
        setSelectedModel(connectedModels[0]?.id ?? null);
      }
    }
  }, [connectedModels, selectedModel, statusData?.model]);

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* Header */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <Typography.Body color="secondary" serif css={css`font-style: italic;`}>
          The mind behind the curtain
        </Typography.Body>
        <Typography.Title3 as="h2" css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
          Connect your AI
        </Typography.Title3>
        <Typography.Caption color="hint">
          {statusData?.headless
            ? 'Running remotely. OAuth opens here and may ask for a final redirect URL.'
            : 'Sign in with your existing subscription. No API keys needed.'}
        </Typography.Caption>
      </div>

      {/* Layer 1: OAuth Provider Cards */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        {oauthCards.map((card) => {
          const isConnected = connectedProvider === card.id && connectedMethod === 'oauth';
          const isAuthenticating = !isConnected && oauthProvider === card.id && oauthState === 'authenticating';
          const isError = !isConnected && oauthProvider === card.id && oauthState === 'error';

          return (
            <div
              key={card.id}
              css={css`
                padding: ${theme.spacing[4]};
                border-radius: ${theme.borderRadius.md};
                border: 1px solid ${isConnected ? theme.colors.success.main + '55' : theme.colors.border.default};
                background: ${isConnected ? theme.colors.success.main + '08' : theme.colors.background.paper};
                transition: border-color ${theme.transitions.fast}, background ${theme.transitions.fast};
              `}
            >
              {/* Connected state */}
              {isConnected && (
                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
                  <div css={css`display: flex; align-items: center; justify-content: space-between;`}>
                    <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
                      <CheckCircle size={20} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
                      <div>
                        <Typography.SmallBodyAlt>{card.name}</Typography.SmallBodyAlt>
                        {connectedDisplayName ? (
                          <Typography.Caption color="hint">
                            {connectedDisplayName}{connectedRefreshable ? ' · Auto-refreshing' : ''}
                          </Typography.Caption>
                        ) : (
                          <Typography.Caption color="hint">Connected</Typography.Caption>
                        )}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleSignOut(card.id)}>
                      <SignOut size={14} css={css`margin-right: ${theme.spacing[1]};`} />
                      Sign out
                    </Button>
                  </div>

                  {/* Model picker (inline with the connected card) */}
                  {connectedModels && connectedModels.length > 0 && (
                    <div css={css`
                      display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};
                      padding-top: ${theme.spacing[2]};
                      border-top: 1px solid ${theme.colors.border.default};
                    `}>
                      <Select
                        label="Model"
                        value={selectedModel ?? ''}
                        onChange={(value) => setSelectedModel(value)}
                        options={connectedModels.map((m) => ({
                          value: m.id,
                          label: m.name || m.id,
                        }))}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Authenticating state */}
              {isAuthenticating && (
                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
                  <Typography.SmallBodyAlt>{card.name}</Typography.SmallBodyAlt>

                  {oauthAuthUrl ? (
                    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                      <Typography.Caption color="secondary">
                        Open this sign-in page:
                      </Typography.Caption>
                      <Typography.SmallBody
                        as="a"
                        href={oauthAuthUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        css={css`
                          display: inline-flex; align-items: center; gap: ${theme.spacing[1]};
                          color: ${theme.colors.text.primary}; word-break: break-all;
                          text-decoration: none; &:hover { text-decoration: underline; }
                        `}
                      >
                        {oauthAuthUrl} <ArrowSquareOut size={12} />
                      </Typography.SmallBody>
                      <button
                        onClick={() => handleCopyUrl(oauthAuthUrl)}
                        css={css`
                          display: inline-flex; align-items: center; gap: 4px; padding: ${theme.spacing[0.5]} ${theme.spacing[1]};
                          border-radius: ${theme.borderRadius.sm}; cursor: pointer; align-self: flex-start;
                          background: none; border: none;
                          color: ${urlCopied ? theme.colors.success.main : theme.colors.text.hint};
                          &:hover { color: ${urlCopied ? theme.colors.success.main : theme.colors.text.primary}; }
                        `}
                      >
                        {urlCopied ? <><CheckCircle size={12} /> <Typography.Tiny>Copied URL</Typography.Tiny></> : <><Copy size={12} /> <Typography.Tiny>Copy URL</Typography.Tiny></>}
                      </button>

                      {oauthDeviceCode && (
                        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; flex-wrap: wrap;`}>
                          <Typography.Caption color="secondary">Enter code:</Typography.Caption>
                          <Typography.SmallBodyAlt as="code" css={css`
                            letter-spacing: 0.15em;
                            background: ${theme.colors.background.elevated};
                            padding: ${theme.spacing[1]} ${theme.spacing[2]};
                            border-radius: ${theme.borderRadius.sm};
                            border: 1px solid ${theme.colors.border.default};
                          `}>
                            {oauthDeviceCode}
                          </Typography.SmallBodyAlt>
                          <button
                            onClick={() => handleCopyCode(oauthDeviceCode)}
                            css={css`
                              display: flex; align-items: center; gap: 4px; padding: ${theme.spacing[0.5]} ${theme.spacing[1]};
                              border-radius: ${theme.borderRadius.sm}; cursor: pointer;
                              background: none; border: none;
                              color: ${codeCopied ? theme.colors.success.main : theme.colors.text.hint};
                              &:hover { color: ${codeCopied ? theme.colors.success.main : theme.colors.text.primary}; }
                            `}
                          >
                            {codeCopied ? <><CheckCircle size={12} /> <Typography.Tiny>Copied</Typography.Tiny></> : <><Copy size={12} /> <Typography.Tiny>Copy</Typography.Tiny></>}
                          </button>
                        </div>
                      )}

                      {(oauthManualCodeRecommended || oauthFlowType === 'localhost_callback') && !oauthPromptMessage && (
                        <Typography.Caption color="hint">
                          If the browser lands on a localhost page that cannot connect, copy the full address from that page and paste it here when prompted.
                        </Typography.Caption>
                      )}
                    </div>
                  ) : (
                    <Typography.Caption color="secondary">
                      Starting authentication...
                    </Typography.Caption>
                  )}

                  {/* Prompt input for manual paste flows (Docker/headless) */}
                  {oauthPromptMessage && (
                    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                      <Typography.Caption color="secondary">{oauthPromptMessage}</Typography.Caption>
                      <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
                        <input
                          type="text"
                          value={oauthPromptValue}
                          onChange={(e) => setOauthPromptValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleOAuthPromptSubmit(); }}
                          placeholder={oauthPromptPlaceholder}
                          css={css`
                            flex: 1;
                            padding: ${theme.spacing[2]} ${theme.spacing[3]};
                            background: ${theme.colors.background.paper};
                            border: 1px solid ${theme.colors.border.default};
                            border-radius: ${theme.borderRadius.default};
                            color: ${theme.colors.text.primary};
                            font-size: ${theme.typography.fontSize.sm};
                            outline: none;
                            &:focus { border-color: ${theme.colors.border.focus}; }
                            &::placeholder { color: ${theme.colors.text.hint}; }
                          `}
                        />
                        <Button variant="primary" size="sm" onClick={handleOAuthPromptSubmit} disabled={!oauthPromptAllowEmpty && !oauthPromptValue.trim()}>
                          Submit
                        </Button>
                      </div>
                    </div>
                  )}

                  <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                    <BreathingDots color={theme.colors.text.hint} />
                    <Typography.Caption color="secondary">Waiting for authorization...</Typography.Caption>
                  </div>

                  <Button variant="ghost" size="sm" onClick={handleOAuthCancel} css={css`align-self: flex-start;`}>
                    Cancel
                  </Button>
                </div>
              )}

              {/* Error state */}
              {isError && (
                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
                  <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                    <XCircle size={18} weight="fill" css={css`color: ${theme.colors.error.main}; flex-shrink: 0;`} />
                    <Typography.SmallBody color={theme.colors.error.main}>
                      {oauthError || 'Authentication failed'}
                    </Typography.SmallBody>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => handleOAuthStart(card.id)} css={css`align-self: flex-start;`}>
                    Try again
                  </Button>
                </div>
              )}

              {/* Default state */}
              {!isConnected && !isAuthenticating && !isError && (
                <div css={css`display: flex; align-items: center; justify-content: space-between;`}>
                  <div>
                    <Typography.SmallBodyAlt>{card.name}</Typography.SmallBodyAlt>
                    <Typography.Caption color="hint">{card.description}</Typography.Caption>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleOAuthStart(card.id)}
                    loading={initiateOAuthMutation.isPending && oauthProvider === card.id}
                    css={css`flex-shrink: 0;`}
                  >
                    Sign In
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Env var detection */}
      {statusData?.connected && statusData.method === 'env_var' && (
        <div css={css`
          padding: ${theme.spacing[4]};
          border-radius: ${theme.borderRadius.md};
          border: 1px solid ${theme.colors.success.main}33;
          background: ${theme.colors.success.main}08;
          display: flex; align-items: center; gap: ${theme.spacing[3]};
        `}>
          <CheckCircle size={20} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
          <div>
            <Typography.SmallBodyAlt>Connected via environment variable</Typography.SmallBodyAlt>
            <Typography.Caption color="hint">Detected from your .env configuration</Typography.Caption>
          </div>
        </div>
      )}

      {/* Layer 2: API Key (collapsed) */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <button
          onClick={() => setApiKeyExpanded(!apiKeyExpanded)}
          css={css`
            display: flex; align-items: flex-start; gap: ${theme.spacing[1.5]};
            padding: 0; background: none; border: none; cursor: pointer;
            text-align: left; font-family: inherit;
            color: ${theme.colors.text.hint};
            &:hover { color: ${theme.colors.text.secondary}; }
          `}
        >
          <CaretRight size={12} css={css`
            transition: transform 150ms ease;
            transform: rotate(${apiKeyExpanded ? '90deg' : '0deg'});
            margin-top: 3px;
            flex-shrink: 0;
          `} />
          <div>
            <span css={css`font-size: ${theme.typography.fontSize.sm}; display: block;`}>
              Use an API key instead
            </span>
            <span css={css`font-size: ${theme.typography.fontSize.xs}; opacity: 0.7; display: block; margin-top: 1px;`}>
              OpenAI, Mistral, Groq, xAI, and 10+ more providers
            </span>
          </div>
        </button>

        <AnimatePresence>
          {apiKeyExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              css={css`overflow: hidden;`}
            >
              <div css={css`
                display: flex; flex-direction: column; gap: ${theme.spacing[3]};
                padding: ${theme.spacing[4]};
                border-radius: ${theme.borderRadius.md};
                border: 1px solid ${theme.colors.border.default};
                background: ${theme.colors.background.elevated};
              `}>
                {/* Provider dropdown */}
                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
                  <Select
                    label="Provider"
                    value={apiKeyProvider}
                    onChange={(value) => {
                      setApiKeyProvider(value);
                      setApiKeyValidation('idle');
                      setApiKeyError(null);
                      setApiKeyValue('');
                    }}
                    options={apiKeyProviders.map((p) => ({
                      value: p.id,
                      label: p.name,
                    }))}
                  />
                </div>

                {/* API Key input */}
                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
                  <div css={css`display: flex; align-items: center; gap: ${theme.spacing[1.5]};`}>
                    <label css={css`
                      font-size: ${theme.typography.fontSize.sm};
                      font-weight: ${theme.typography.fontWeight.medium};
                      color: ${theme.colors.text.secondary};
                    `}>
                      API Key
                    </label>
                    <Tooltip content="Stored locally, encrypted at rest. Never leaves your instance." position="top">
                      <ShieldCheck size={14} css={css`color: ${theme.colors.text.disabled}; cursor: help;`} />
                    </Tooltip>
                  </div>

                  <div css={css`display: flex; gap: ${theme.spacing[2]}; align-items: stretch;`}>
                    <div css={css`flex: 1; position: relative;`}>
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={apiKeyValue}
                        onChange={(e) => {
                          setApiKeyValue(e.target.value);
                          setApiKeyValidation('idle');
                          setApiKeyError(null);
                        }}
                        placeholder={selectedApiProvider?.keyPrefix ? `${selectedApiProvider.keyPrefix}...` : 'Enter your API key'}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && apiKeyValue.trim()) handleValidateApiKey();
                        }}
                        css={css`
                          width: 100%;
                          padding: ${theme.spacing[2]} ${theme.spacing[3]};
                          padding-right: ${theme.spacing[8]};
                          background: ${theme.colors.background.paper};
                          border: 1px solid ${apiKeyValidation === 'error' ? theme.colors.error.main : apiKeyValidation === 'success' ? theme.colors.success.main : theme.colors.border.default};
                          border-radius: ${theme.borderRadius.default};
                          color: ${theme.colors.text.primary};
                          font-size: ${theme.typography.fontSize.sm};
                          outline: none;
                          &:focus { border-color: ${apiKeyValidation === 'error' ? theme.colors.error.main : theme.colors.border.focus}; }
                          &::placeholder { color: ${theme.colors.text.hint}; }
                        `}
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        css={css`
                          position: absolute; right: ${theme.spacing[2]}; top: 50%; transform: translateY(-50%);
                          color: ${theme.colors.text.hint}; display: flex; padding: 0; background: none; border: none; cursor: pointer;
                          &:hover { color: ${theme.colors.text.primary}; }
                        `}
                      >
                        {showKey ? <EyeSlash size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <Button
                      variant={apiKeyValidation === 'success' ? 'secondary' : 'primary'}
                      size="sm"
                      onClick={handleValidateApiKey}
                      loading={apiKeyValidation === 'validating'}
                      disabled={!apiKeyValue.trim()}
                      css={css`flex-shrink: 0; min-width: 110px;`}
                    >
                      {apiKeyValidation === 'success' ? (
                        <span css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                          <CheckCircle size={14} weight="fill" /> Saved
                        </span>
                      ) : 'Validate & Save'}
                    </Button>
                  </div>

                  {apiKeyValidation === 'error' && (
                    <Typography.Caption as="span" color={theme.colors.error.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                      <XCircle size={12} weight="fill" /> {apiKeyError || 'Invalid API key'}
                    </Typography.Caption>
                  )}

                  {selectedApiProvider?.keyUrl && (
                    <Typography.Caption
                      as="a"
                      href={`https://${selectedApiProvider.keyUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      color="hint"
                      css={css`
                        display: inline-flex; align-items: center; gap: ${theme.spacing[1]};
                        text-decoration: none;
                        &:hover { color: ${theme.colors.text.secondary}; text-decoration: underline; }
                      `}
                    >
                      Get your API key at {selectedApiProvider.keyUrl} <ArrowSquareOut size={12} />
                    </Typography.Caption>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Layer 3: Custom Endpoint (collapsed) */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <button
          onClick={() => setCustomExpanded(!customExpanded)}
          css={css`
            display: flex; align-items: flex-start; gap: ${theme.spacing[1.5]};
            padding: 0; background: none; border: none; cursor: pointer;
            text-align: left; font-family: inherit;
            color: ${theme.colors.text.hint};
            &:hover { color: ${theme.colors.text.secondary}; }
          `}
        >
          <CaretRight size={12} css={css`
            transition: transform 150ms ease;
            transform: rotate(${customExpanded ? '90deg' : '0deg'});
            margin-top: 3px;
            flex-shrink: 0;
          `} />
          <div>
            <span css={css`font-size: ${theme.typography.fontSize.sm}; display: block;`}>
              Configure a custom endpoint
            </span>
            <span css={css`font-size: ${theme.typography.fontSize.xs}; opacity: 0.7; display: block; margin-top: 1px;`}>
              Self-hosted models like Ollama, vLLM, or LM Studio
            </span>
          </div>
        </button>

        <AnimatePresence>
          {customExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              css={css`overflow: hidden;`}
            >
              <div css={css`
                display: flex; flex-direction: column; gap: ${theme.spacing[3]};
                padding: ${theme.spacing[4]};
                border-radius: ${theme.borderRadius.md};
                border: 1px solid ${theme.colors.border.default};
                background: ${theme.colors.background.elevated};
              `}>
                <Typography.Caption color="secondary">
                  For self-hosted models (Ollama, vLLM, LM Studio) or custom OpenAI-compatible APIs
                </Typography.Caption>

                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
                  <label css={css`font-size: ${theme.typography.fontSize.sm}; font-weight: ${theme.typography.fontWeight.medium}; color: ${theme.colors.text.secondary};`}>
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={customBaseUrl}
                    onChange={(e) => { setCustomBaseUrl(e.target.value); setCustomValidation('idle'); }}
                    placeholder="http://localhost:11434/v1"
                    css={css`
                      padding: ${theme.spacing[2]} ${theme.spacing[3]};
                      background: ${theme.colors.background.paper};
                      border: 1px solid ${theme.colors.border.default};
                      border-radius: ${theme.borderRadius.default};
                      color: ${theme.colors.text.primary};
                      font-size: ${theme.typography.fontSize.sm};
                      outline: none;
                      &:focus { border-color: ${theme.colors.border.focus}; }
                      &::placeholder { color: ${theme.colors.text.hint}; }
                    `}
                  />
                </div>

                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
                  <label css={css`font-size: ${theme.typography.fontSize.sm}; font-weight: ${theme.typography.fontWeight.medium}; color: ${theme.colors.text.secondary};`}>
                    Model ID
                  </label>
                  <input
                    type="text"
                    value={customModelId}
                    onChange={(e) => { setCustomModelId(e.target.value); setCustomValidation('idle'); }}
                    placeholder="llama-3.3-70b"
                    css={css`
                      padding: ${theme.spacing[2]} ${theme.spacing[3]};
                      background: ${theme.colors.background.paper};
                      border: 1px solid ${theme.colors.border.default};
                      border-radius: ${theme.borderRadius.default};
                      color: ${theme.colors.text.primary};
                      font-size: ${theme.typography.fontSize.sm};
                      outline: none;
                      &:focus { border-color: ${theme.colors.border.focus}; }
                      &::placeholder { color: ${theme.colors.text.hint}; }
                    `}
                  />
                </div>

                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
                  <label css={css`font-size: ${theme.typography.fontSize.sm}; font-weight: ${theme.typography.fontWeight.medium}; color: ${theme.colors.text.secondary};`}>
                    API Key (optional)
                  </label>
                  <input
                    type="password"
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                    placeholder="Optional"
                    css={css`
                      padding: ${theme.spacing[2]} ${theme.spacing[3]};
                      background: ${theme.colors.background.paper};
                      border: 1px solid ${theme.colors.border.default};
                      border-radius: ${theme.borderRadius.default};
                      color: ${theme.colors.text.primary};
                      font-size: ${theme.typography.fontSize.sm};
                      outline: none;
                      &:focus { border-color: ${theme.colors.border.focus}; }
                      &::placeholder { color: ${theme.colors.text.hint}; }
                    `}
                  />
                </div>

                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleTestCustom}
                    loading={customValidation === 'validating'}
                    disabled={!customBaseUrl || !customModelId}
                  >
                    {customValidation === 'success' ? (
                      <span css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                        <CheckCircle size={14} weight="fill" /> Connected
                      </span>
                    ) : 'Test Connection'}
                  </Button>
                  {customValidation === 'error' && (
                    <Typography.Caption color={theme.colors.error.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                      <XCircle size={12} weight="fill" /> Connection failed
                    </Typography.Caption>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Advanced: Context window limit */}
      {connectedProvider && connectedModels && connectedModels.length > 0 && (() => {
        const activeModel = connectedModels.find(m => m.id === selectedModel);
        const modelMax = activeModel?.contextWindow ?? 200_000;
        const MIN_CW = 16_384;
        const DEFAULT_CW_LIMIT = 100_000;
        const defaultLimit = Math.min(DEFAULT_CW_LIMIT, modelMax);
        const rawLimit = selectedContextLimit === 'unset' ? defaultLimit : selectedContextLimit;
        const sliderVal = Math.max(MIN_CW, Math.min(rawLimit ?? defaultLimit, modelMax));
        const pct = Math.round((sliderVal / modelMax) * 100);

        const formatTokens = (t: number) => {
          if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`;
          return `${Math.round(t / 1000)}K`;
        };

        return (
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
            <button
              onClick={() => setAdvancedExpanded(!advancedExpanded)}
              css={css`
                display: flex; align-items: center; gap: ${theme.spacing[1.5]};
                padding: 0; background: none; border: none; cursor: pointer;
                text-align: left; font-family: inherit;
                color: ${theme.colors.text.hint};
                &:hover { color: ${theme.colors.text.secondary}; }
              `}
            >
              <CaretRight size={12} css={css`
                transition: transform 150ms ease;
                transform: rotate(${advancedExpanded ? '90deg' : '0deg'});
                flex-shrink: 0;
              `} />
              <span css={css`font-size: ${theme.typography.fontSize.sm};`}>
                Advanced
              </span>
            </button>

            <AnimatePresence>
              {advancedExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  css={css`overflow: hidden;`}
                >
                  <div css={css`
                    display: flex; flex-direction: column; gap: ${theme.spacing[3]};
                    padding: ${theme.spacing[4]};
                    border-radius: ${theme.borderRadius.md};
                    border: 1px solid ${theme.colors.border.default};
                    background: ${theme.colors.background.elevated};
                  `}>
                    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
                      <Typography.SmallBodyAlt>Context Usage</Typography.SmallBodyAlt>
                      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[4]};`}>
                        <div css={css`flex: 1;`}>
                          <Slider
                            value={sliderVal}
                            onChange={(tokens) => {
                              setSelectedContextLimit(tokens);
                            }}
                            min={MIN_CW}
                            max={modelMax}
                            step={1000}
                            leftLabel={formatTokens(MIN_CW)}
                            rightLabel={formatTokens(modelMax)}
                            showNeutral={false}
                          />
                        </div>
                        <Typography.SmallBodyAlt as="span" css={css`
                          white-space: nowrap;
                          min-width: 100px;
                        `}>
                          {`${pct}% · ${formatTokens(sliderVal)}`}
                        </Typography.SmallBodyAlt>
                      </div>
                      <Typography.Caption color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
                        Limits how much of the model's context window is used. Lower values reduce token costs. Default is {formatTokens(defaultLimit)}.
                      </Typography.Caption>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })()}

      <AnimatePresence>
        {continueError && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            css={css`
              display: flex;
              align-items: flex-start;
              gap: ${theme.spacing[2]};
              padding: ${theme.spacing[2]} ${theme.spacing[3]};
              border-radius: ${theme.borderRadius.default};
              background: ${theme.colors.error.main}1a;
            `}
          >
            <XCircle size={14} weight="fill" css={css`color: ${theme.colors.error.main}; flex-shrink: 0; margin-top: 2px;`} />
            <Typography.Caption color={theme.colors.error.main}>
              {continueError}
            </Typography.Caption>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation */}
      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
        continueDisabled={!canContinue}
        continueLoading={completeFromRestoreMutation.isPending}
        continueTooltip={!canContinue ? 'Connect an AI provider to continue' : undefined}
      />
    </div>
  );
}

// ============================================================================
// BreathingDots — organic waiting indicator (brand: breathing over blinking)
// ============================================================================

function BreathingDots({ color }: { color: string }) {
  const breathe = keyframes`
    0%, 100% { opacity: 0.3; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1); }
  `;
  return (
    <span css={css`display: inline-flex; gap: 4px; align-items: center;`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          css={css`
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background: ${color};
            animation: ${breathe} 1.8s ease-in-out infinite;
            animation-delay: ${i * 0.25}s;
          `}
        />
      ))}
    </span>
  );
}
