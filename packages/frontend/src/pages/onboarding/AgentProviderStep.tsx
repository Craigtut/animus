/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeSlash, CheckCircle, XCircle } from '@phosphor-icons/react';
import { Button, Input, Card } from '../../components/ui';
import { useOnboardingStore } from '../../store';

type Provider = 'claude' | 'codex';

export function AgentProviderStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep } = useOnboardingStore();

  const [provider, setProvider] = useState<Provider>('claude');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [validated, setValidated] = useState<'idle' | 'validating' | 'success' | 'error'>('idle');

  const handleValidate = async () => {
    setValidated('validating');
    // TODO: call trpc.provider.validateKey when available
    await new Promise((r) => setTimeout(r, 1000));
    if (apiKey.length > 10) {
      setValidated('success');
    } else {
      setValidated('error');
    }
  };

  const handleContinue = () => {
    markStepComplete('agent_provider');
    setCurrentStep('identity');
    navigate('/onboarding/identity');
  };

  const handleBack = () => navigate('/onboarding/welcome');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div>
        <h2
          css={css`
            font-size: ${theme.typography.fontSize['2xl']};
            font-weight: ${theme.typography.fontWeight.light};
            margin-bottom: ${theme.spacing[2]};
          `}
        >
          The mind behind the curtain
        </h2>
        <p css={css`color: ${theme.colors.text.secondary};`}>
          Choose which AI will power your Animus. You can change this later in settings.
        </p>
      </div>

      {/* Provider cards */}
      <div css={css`display: grid; grid-template-columns: 1fr 1fr; gap: ${theme.spacing[4]};
        @media (max-width: ${theme.breakpoints.sm}) { grid-template-columns: 1fr; }`}>
        {(['claude', 'codex'] as const).map((p) => (
          <Card
            key={p}
            variant={provider === p ? 'elevated' : 'outlined'}
            interactive
            padding="md"
            onClick={() => { setProvider(p); setValidated('idle'); setApiKey(''); }}
          >
            <h3
              css={css`
                font-size: ${theme.typography.fontSize.lg};
                font-weight: ${theme.typography.fontWeight.semibold};
                margin-bottom: ${theme.spacing[1]};
              `}
            >
              {p === 'claude' ? 'Claude' : 'Codex'}
            </h3>
            <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary};`}>
              {p === 'claude'
                ? 'The default choice. Full-featured and the most capable.'
                : 'An alternative with strong agentic abilities.'}
            </p>
          </Card>
        ))}
      </div>

      {/* API key input */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <Input
          label="API Key"
          type={showKey ? 'text' : 'password'}
          value={apiKey}
          onChange={(e) => { setApiKey((e.target as HTMLInputElement).value); setValidated('idle'); }}
          placeholder={provider === 'claude' ? 'sk-ant-api03-...' : 'sk-proj-...'}
          helperText={
            provider === 'claude'
              ? 'Create an API key at console.anthropic.com'
              : 'Create an API key at platform.openai.com/api-keys'
          }
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
            disabled={!apiKey}
          >
            Validate
          </Button>
          {validated === 'success' && (
            <span css={css`display: flex; align-items: center; gap: ${theme.spacing[1]}; color: ${theme.colors.success.main}; font-size: ${theme.typography.fontSize.sm};`}>
              <CheckCircle size={16} weight="fill" /> Verified
            </span>
          )}
          {validated === 'error' && (
            <span css={css`display: flex; align-items: center; gap: ${theme.spacing[1]}; color: ${theme.colors.error.main}; font-size: ${theme.typography.fontSize.sm};`}>
              <XCircle size={16} weight="fill" /> Invalid key
            </span>
          )}
        </div>

        <p css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.hint};`}>
          Your API key is stored locally on your server, encrypted at rest. It never leaves your instance.
        </p>
      </div>

      {/* Navigation */}
      <div css={css`display: flex; justify-content: space-between; margin-top: ${theme.spacing[4]};`}>
        <Button variant="ghost" onClick={handleBack}>Back</Button>
        <Button onClick={handleContinue} disabled={validated !== 'success'}>Continue</Button>
      </div>
    </div>
  );
}
