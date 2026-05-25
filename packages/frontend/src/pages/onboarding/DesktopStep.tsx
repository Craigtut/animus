/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { Monitor, Power, SignIn } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Toggle, Typography } from '../../components/ui';
import { useAutostart } from '../../hooks/useAutostart';
import { useDesktopPowerSettings } from '../../hooks/useDesktopPowerSettings';
import { useOnboardingStore } from '../../store';
import { isTauri } from '../../utils/tauri';
import { OnboardingNav } from './OnboardingNav';

export function DesktopStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep } = useOnboardingStore();
  const autostart = useAutostart();
  const desktopPower = useDesktopPowerSettings();

  const desktopAvailable = isTauri();

  const handleContinue = () => {
    markStepComplete('desktop');
    setCurrentStep('agent_provider');
    navigate('/onboarding/agent');
  };

  const handleBack = () => navigate('/onboarding/welcome');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <Typography.Body color="secondary" serif css={css`font-style: italic;`}>
          How it stays close
        </Typography.Body>
        <Typography.Title3 as="h2" css={css`
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          Choose how Animus runs on this computer
        </Typography.Title3>
        <Typography.SmallBody color="secondary" css={css`
          margin-top: ${theme.spacing[1]};
          line-height: ${theme.typography.lineHeight.relaxed};
        `}>
          These choices are optional. You can leave them off now and change them later in System settings.
        </Typography.SmallBody>
      </div>

      {!desktopAvailable && (
        <div css={css`
          padding: ${theme.spacing[3]} ${theme.spacing[4]};
          border: 1px solid ${theme.colors.border.light};
          border-radius: ${theme.borderRadius.default};
          background: ${theme.colors.background.paper};
        `}>
          <Typography.SmallBody color="secondary">
            Desktop controls are available in the macOS and Windows app.
          </Typography.SmallBody>
        </div>
      )}

      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <RuntimeChoice
          icon={<SignIn size={22} />}
          title="Start at login"
          description="Open Animus when you sign in, hidden in the menu bar or system tray."
          checked={autostart.enabled}
          disabled={!desktopAvailable || autostart.loading || !autostart.available}
          onChange={(checked) => {
            void autostart.setEnabled(checked);
          }}
        />

        {desktopPower.available && (
          <RuntimeChoice
            icon={<Power size={22} />}
            title="Keep computer awake"
            description="Prevent idle sleep while Animus is running, so the heartbeat can keep time."
            checked={desktopPower.keepComputerAwake}
            disabled={desktopPower.loading || desktopPower.saving}
            onChange={(checked) => {
              void desktopPower.setKeepComputerAwake(checked);
            }}
          />
        )}

        {desktopPower.available && (
          <RuntimeChoice
            icon={<Monitor size={22} />}
            title="Keep display awake"
            description="Keep the screen lit too. Most people can leave this off."
            checked={desktopPower.keepDisplayAwake}
            disabled={desktopPower.loading || desktopPower.saving}
            onChange={(checked) => {
              void desktopPower.setKeepDisplayAwake(checked);
            }}
          />
        )}
      </div>

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
      />
    </div>
  );
}

function RuntimeChoice({
  icon,
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const theme = useTheme();

  return (
    <Card
      variant={checked ? 'elevated' : 'outlined'}
      padding="md"
      interactive={!disabled}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={checked}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onChange(!checked);
        }
      }}
    >
      <div css={css`
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: ${theme.spacing[3]};
        opacity: ${disabled ? 0.55 : 1};
      `}>
        <div css={css`
          width: 36px;
          height: 36px;
          border-radius: ${theme.borderRadius.full};
          display: flex;
          align-items: center;
          justify-content: center;
          color: ${checked ? theme.colors.accent : theme.colors.text.secondary};
          background: ${checked ? `${theme.colors.accent}12` : theme.colors.background.elevated};
        `}>
          {icon}
        </div>
        <div css={css`min-width: 0;`}>
          <Typography.SmallBodyAlt as="div" css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
            {title}
          </Typography.SmallBodyAlt>
          <Typography.Caption color="secondary" css={css`
            display: block;
            margin-top: ${theme.spacing[0.5]};
            line-height: ${theme.typography.lineHeight.relaxed};
          `}>
            {description}
          </Typography.Caption>
        </div>
        <div onClick={(event) => event.stopPropagation()}>
          <Toggle
            checked={checked}
            disabled={disabled}
            onChange={onChange}
          />
        </div>
      </div>
    </Card>
  );
}
