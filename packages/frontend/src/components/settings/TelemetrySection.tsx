/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChartBar, CaretRight, CaretDown } from '@phosphor-icons/react';
import { Typography, Toggle } from '../ui';
import { trpc } from '../../utils/trpc';

// ============================================================================
// Save flash hook
// ============================================================================

function useSaveFlash() {
  const [show, setShow] = useState(false);
  const flash = useCallback(() => {
    setShow(true);
    setTimeout(() => setShow(false), 2000);
  }, []);
  return { show, flash };
}

function SaveIndicator({ show }: { show: boolean }) {
  const theme = useTheme();
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          css={css`
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.success.main};
            font-weight: ${theme.typography.fontWeight.medium};
          `}
        >
          Saved
        </motion.span>
      )}
    </AnimatePresence>
  );
}

// ============================================================================
// Event descriptions
// ============================================================================

const collectedEvents = [
  { name: 'Install', description: 'One-time event on first run: app version, OS, architecture' },
  { name: 'App started', description: 'Each startup: version, OS, agent provider, counts of channels and plugins' },
  { name: 'Daily active', description: 'Once per day on first heartbeat tick: version, provider, uptime hours' },
  { name: 'Feature used', description: 'Once per feature per day: which feature was activated (goals, memory, channels, plugins, voice, sleep)' },
  { name: 'Error occurred', description: 'Up to 5 per day: error class name and numeric hash only, no message content' },
];

// ============================================================================
// TelemetryInline — compact block for the System settings section
// ============================================================================

export function TelemetryInline() {
  const theme = useTheme();
  const utils = trpc.useUtils();
  const { data: systemSettings } = trpc.settings.getSystemSettings.useQuery();
  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation({
    onSuccess: () => utils.settings.getSystemSettings.invalidate(),
  });
  const toggleSave = useSaveFlash();
  const [expanded, setExpanded] = useState(false);

  const telemetryEnabled = systemSettings?.telemetryEnabled ?? true;

  const handleToggle = (checked: boolean) => {
    updateSettingsMutation.mutate(
      { telemetryEnabled: checked },
      { onSuccess: () => toggleSave.flash() },
    );
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
      <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
        Telemetry
      </Typography.Subtitle>

      {/* Compact row: icon + description + toggle */}
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[3]};
      `}>
        <ChartBar size={18} css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`} />
        <Typography.SmallBody color="secondary" css={css`flex: 1;`}>
          Anonymous usage data to help understand how Animus is used and prioritize improvements.
        </Typography.SmallBody>
        <Toggle
          checked={telemetryEnabled}
          onChange={handleToggle}
        />
        <SaveIndicator show={toggleSave.show} />
      </div>

      {/* Expand/collapse trigger */}
      <button
        onClick={() => setExpanded((e) => !e)}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[1.5]};
          padding: 0;
          cursor: pointer;
          color: ${theme.colors.text.hint};
          user-select: none;
          &:hover { color: ${theme.colors.text.secondary}; }
        `}
      >
        {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
        <Typography.Caption color="hint">
          {expanded ? 'Hide details' : 'What is collected'}
        </Typography.Caption>
      </button>

      {/* Expandable details */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            css={css`overflow: hidden;`}
          >
            <div css={css`
              display: flex;
              flex-direction: column;
              gap: ${theme.spacing[4]};
              padding-left: ${theme.spacing[3]};
              border-left: 1px solid ${theme.colors.border.light};
              margin-left: ${theme.spacing[1]};
            `}>
              {/* Privacy guarantees */}
              <div css={css`
                padding: ${theme.spacing[3]} ${theme.spacing[4]};
                border-radius: ${theme.borderRadius.default};
                background: ${theme.colors.background.paper};
                border: 1px solid ${theme.colors.border.light};
                display: flex;
                flex-direction: column;
                gap: ${theme.spacing[2]};
              `}>
                <Typography.SmallBody css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
                  Privacy guarantees
                </Typography.SmallBody>
                {[
                  'A random anonymous UUID identifies your instance. No email, IP, or account info.',
                  'No message content, conversation data, or personal information is ever sent.',
                  'Typically 3 to 8 events per day, heavily deduplicated.',
                  'All data is sent to PostHog (self-serve analytics). No third-party sharing.',
                ].map((text, i) => (
                  <div key={i} css={css`display: flex; gap: ${theme.spacing[2]}; align-items: flex-start;`}>
                    <div css={css`
                      width: 4px;
                      min-height: 4px;
                      border-radius: 50%;
                      background: ${theme.colors.success.main};
                      flex-shrink: 0;
                      margin-top: 8px;
                    `} />
                    <Typography.Caption color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
                      {text}
                    </Typography.Caption>
                  </div>
                ))}
              </div>

              {/* Collected events */}
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                <Typography.SmallBody css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
                  Exactly what is collected
                </Typography.SmallBody>
                {collectedEvents.map((evt) => (
                  <div key={evt.name} css={css`display: flex; gap: ${theme.spacing[2]}; align-items: baseline;`}>
                    <Typography.Caption css={css`
                      font-weight: ${theme.typography.fontWeight.medium};
                      white-space: nowrap;
                      min-width: 100px;
                    `}>
                      {evt.name}
                    </Typography.Caption>
                    <Typography.Caption color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
                      {evt.description}
                    </Typography.Caption>
                  </div>
                ))}
              </div>

              {/* Env var notice */}
              <Typography.Caption color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
                You can also disable telemetry globally via environment variables: set{' '}
                <code css={css`
                  font-family: ${theme.typography.fontFamily.mono};
                  background: ${theme.colors.background.elevated};
                  padding: 1px 4px;
                  border-radius: 3px;
                `}>DO_NOT_TRACK=1</code>{' '}
                or{' '}
                <code css={css`
                  font-family: ${theme.typography.fontFamily.mono};
                  background: ${theme.colors.background.elevated};
                  padding: 1px 4px;
                  border-radius: 3px;
                `}>ANIMUS_TELEMETRY_DISABLED=1</code>{' '}
                before starting the server.
              </Typography.Caption>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
