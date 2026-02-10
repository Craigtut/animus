/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useNavigate } from 'react-router-dom';
import { Globe, ChatCircle, DiscordLogo, Plugs } from '@phosphor-icons/react';
import { Button, Card, Badge } from '../../components/ui';
import { useOnboardingStore } from '../../store';

const channels = [
  {
    id: 'web',
    name: 'Web',
    description: 'Chat with Animus right here in the browser. Always available.',
    icon: Globe,
    alwaysOn: true,
  },
  {
    id: 'sms',
    name: 'SMS',
    description: 'Text Animus from your phone. Requires a Twilio account.',
    icon: ChatCircle,
    alwaysOn: false,
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Talk to Animus in your Discord server. Requires a bot token.',
    icon: DiscordLogo,
    alwaysOn: false,
  },
  {
    id: 'api',
    name: 'API',
    description: 'Connect Animus to other services via API.',
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
      <div>
        <h2
          css={css`
            font-size: ${theme.typography.fontSize['2xl']};
            font-weight: ${theme.typography.fontWeight.light};
            margin-bottom: ${theme.spacing[2]};
          `}
        >
          How will you reach each other?
        </h2>
        <p css={css`color: ${theme.colors.text.secondary};`}>
          Animus can communicate through multiple channels. The web interface is always
          available -- set up additional channels now or later from settings.
        </p>
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
                    <span css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
                      {ch.name}
                    </span>
                    {ch.alwaysOn && <Badge variant="success">Active</Badge>}
                    {!ch.alwaysOn && <Badge>Requires setup</Badge>}
                  </div>
                  <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary}; margin-top: ${theme.spacing[0.5]};`}>
                    {ch.description}
                  </p>
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

      <div css={css`display: flex; justify-content: space-between; margin-top: ${theme.spacing[4]};`}>
        <Button variant="ghost" onClick={handleBack}>Back</Button>
        <div css={css`display: flex; gap: ${theme.spacing[3]};`}>
          <Button variant="ghost" onClick={handleContinue}>Skip</Button>
          <Button onClick={handleContinue}>Continue</Button>
        </div>
      </div>
    </div>
  );
}
