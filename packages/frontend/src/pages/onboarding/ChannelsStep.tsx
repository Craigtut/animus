/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useNavigate } from 'react-router-dom';
import { Globe, ChatCircle, DiscordLogo, Plugs } from '@phosphor-icons/react';
import { Button, Card, Badge, Typography } from '../../components/ui';
import { useOnboardingStore } from '../../store';
import { OnboardingNav } from './OnboardingNav';

const channels = [
  {
    id: 'web',
    name: 'Web',
    description: 'Chat with your AI right here in the browser. Always available.',
    icon: Globe,
    alwaysOn: true,
  },
  {
    id: 'sms',
    name: 'SMS',
    description: 'Text your AI from your phone. Requires a Twilio account.',
    icon: ChatCircle,
    alwaysOn: false,
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Talk to your AI in your Discord server. Requires a bot token.',
    icon: DiscordLogo,
    alwaysOn: false,
  },
  {
    id: 'api',
    name: 'API',
    description: 'Connect your AI to other services via API.',
    icon: Plugs,
    alwaysOn: true,
  },
];

export function ChannelsStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep } = useOnboardingStore();

  const handleContinue = () => {
    markStepComplete('channels');
    setCurrentStep('persona_existence');
    navigate('/onboarding/persona/existence');
  };

  const handleBack = () => navigate('/onboarding/about-you');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
        <Typography.Title2 serif>
          How will you reach each other?
        </Typography.Title2>
        <Typography.Body color="secondary">
          Your AI can communicate through multiple channels. The web interface is always
          available -- set up additional channels now or later from settings.
        </Typography.Body>
      </div>

      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        {channels.map((ch) => {
          const Icon = ch.icon;
          return (
            <Card key={ch.id} variant="outlined" padding="md">
              <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
                <Icon size={24} css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`} />
                <div css={css`flex: 1;`}>
                  <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                    <Typography.BodyAlt as="span">
                      {ch.name}
                    </Typography.BodyAlt>
                    {ch.alwaysOn && <Badge variant="success">Active</Badge>}
                    {!ch.alwaysOn && <Badge>Requires setup</Badge>}
                  </div>
                  <Typography.SmallBody color="secondary" css={css`margin-top: ${theme.spacing[0.5]};`}>
                    {ch.description}
                  </Typography.SmallBody>
                </div>
                {!ch.alwaysOn && (
                  <Button variant="ghost" size="sm">
                    Set up
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
        onSkip={handleContinue}
      />
    </div>
  );
}
