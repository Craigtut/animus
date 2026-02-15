/** @jsxImportSource @emotion/react */
import { css, useTheme, keyframes } from '@emotion/react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Heartbeat as HeartbeatIcon,
  Robot,
  ChatCircle,
  Target,
  GearSix,
  Globe,
  ChatText,
  DiscordLogo,
  Code,
  Eye,
  EyeSlash,
  Warning,
  CheckCircle,
  XCircle,
  ShieldCheck,
  Copy,
  ArrowSquareOut,
  CircleNotch,
  Trash,
  List,
  X,
  PuzzlePiece,
  Plus,
  GearFine,
  FolderOpen,
  GitBranch,
  Package,
  ArrowClockwise,
  Plugs,
  FloppyDisk,
} from '@phosphor-icons/react';
import { Card, SelectionCard, Button, Input, Modal, Badge, Toggle, Slider, Typography, Tooltip } from '../components/ui';
import { trpc } from '../utils/trpc';
import type { Theme } from '../styles/theme';
import { SavesSection } from '../components/settings/SavesSection';

// ============================================================================
// Types
// ============================================================================

type SettingsSection = 'heartbeat' | 'provider' | 'channels' | 'plugins' | 'goals' | 'saves' | 'system';

interface SidebarItem {
  id: SettingsSection;
  label: string;
  icon: React.ElementType;
}

const sections: SidebarItem[] = [
  { id: 'heartbeat', label: 'Heartbeat', icon: HeartbeatIcon },
  { id: 'provider', label: 'Agent Provider', icon: Robot },
  { id: 'channels', label: 'Channels', icon: ChatCircle },
  { id: 'plugins', label: 'Plugins', icon: PuzzlePiece },
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'saves', label: 'Saves', icon: FloppyDisk },
  { id: 'system', label: 'System', icon: GearSix },
];

// ============================================================================
// Inline Save Indicator
// ============================================================================

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

function useSaveFlash() {
  const [show, setShow] = useState(false);
  const flash = useCallback(() => {
    setShow(true);
    setTimeout(() => setShow(false), 2000);
  }, []);
  return { show, flash };
}

// ============================================================================
// Section: Heartbeat
// ============================================================================

function HeartbeatSection() {
  const theme = useTheme();

  const { data: hbState } = trpc.heartbeat.getState.useQuery(undefined, {
    refetchInterval: 10000,
  });
  const { data: systemSettings } = trpc.settings.getSystemSettings.useQuery();

  const startMutation = trpc.heartbeat.start.useMutation();
  const stopMutation = trpc.heartbeat.stop.useMutation();
  const updateIntervalMutation = trpc.heartbeat.updateInterval.useMutation();
  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation();

  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const intervalSave = useSaveFlash();
  const warmthSave = useSaveFlash();
  const budgetSave = useSaveFlash();

  const isRunning = hbState?.isRunning ?? false;
  const tickNumber = hbState?.tickNumber ?? 0;
  const currentStage = hbState?.currentStage ?? 'idle';
  const sessionState = hbState?.sessionState ?? 'cold';
  const lastTickAt = hbState?.lastTickAt ?? null;

  // Local state for immediate slider feedback (avoids waiting for API round-trip)
  const [localIntervalMs, setLocalIntervalMs] = useState<number | null>(null);
  const [localWarmthMs, setLocalWarmthMs] = useState<number | null>(null);
  const [localBudget, setLocalBudget] = useState<number | null>(null);

  const intervalMs = localIntervalMs ?? systemSettings?.heartbeatIntervalMs ?? 300000;
  const warmthMs = localWarmthMs ?? systemSettings?.sessionWarmthMs ?? 900000;
  const contextBudget = localBudget ?? systemSettings?.sessionContextBudget ?? 0.7;

  // Sync local state when server data arrives (and local isn't overriding)
  useEffect(() => {
    if (systemSettings && localIntervalMs === null) setLocalIntervalMs(null);
  }, [systemSettings?.heartbeatIntervalMs]);
  useEffect(() => {
    if (systemSettings && localWarmthMs === null) setLocalWarmthMs(null);
  }, [systemSettings?.sessionWarmthMs]);
  useEffect(() => {
    if (systemSettings && localBudget === null) setLocalBudget(null);
  }, [systemSettings?.sessionContextBudget]);

  // Debounced API persistence
  const intervalTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const warmthTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const budgetTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const formatInterval = (ms: number) => {
    const mins = Math.round(ms / 60000);
    return `Every ${mins} minute${mins !== 1 ? 's' : ''}`;
  };

  const formatAgo = (ts: string | null) => {
    if (!ts) return 'Never';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins === 1) return '1 minute ago';
    return `${mins} minutes ago`;
  };

  const handleIntervalChange = (mins: number) => {
    const ms = mins * 60000;
    setLocalIntervalMs(ms);
    clearTimeout(intervalTimerRef.current);
    intervalTimerRef.current = setTimeout(() => {
      updateIntervalMutation.mutate({ intervalMs: ms }, { onSuccess: () => intervalSave.flash() });
      updateSettingsMutation.mutate({ heartbeatIntervalMs: ms });
    }, 300);
  };

  const handleWarmthChange = (mins: number) => {
    const ms = mins * 60000;
    setLocalWarmthMs(ms);
    clearTimeout(warmthTimerRef.current);
    warmthTimerRef.current = setTimeout(() => {
      updateSettingsMutation.mutate({ sessionWarmthMs: ms }, { onSuccess: () => warmthSave.flash() });
    }, 300);
  };

  const handleBudgetChange = (val: number) => {
    setLocalBudget(val);
    clearTimeout(budgetTimerRef.current);
    budgetTimerRef.current = setTimeout(() => {
      updateSettingsMutation.mutate({ sessionContextBudget: val }, { onSuccess: () => budgetSave.flash() });
    }, 300);
  };

  const handlePause = () => {
    stopMutation.mutate();
    setShowPauseConfirm(false);
  };

  const handleResume = () => {
    startMutation.mutate();
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[8]};`}>
      {/* Heartbeat Interval */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
          <Typography.SmallBodyAlt as="label" color="secondary">
            How often does your Animus think?
          </Typography.SmallBodyAlt>
          <SaveIndicator show={intervalSave.show} />
        </div>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[4]};`}>
          <div css={css`flex: 1;`}>
            <Slider
              value={intervalMs / 60000}
              onChange={handleIntervalChange}
              min={1}
              max={30}
              step={1}
              leftLabel="1 min"
              rightLabel="30 min"
              showNeutral={false}
            />
          </div>
          <Typography.SmallBodyAlt as="span" css={css`
            white-space: nowrap;
            min-width: 110px;
          `}>
            {formatInterval(intervalMs)}
          </Typography.SmallBodyAlt>
        </div>
        <Typography.Caption as="p" color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
          Shorter intervals mean more frequent thoughts and faster emotional shifts. Longer intervals are more contemplative (and cheaper).
        </Typography.Caption>
      </div>

      {/* Heartbeat Status */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Status
        </Typography.Subtitle>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            <div css={css`
              width: 8px; height: 8px; border-radius: 50%;
              background: ${isRunning ? theme.colors.success.main : theme.colors.warning.main};
            `} />
            <Typography.SmallBodyAlt as="span">
              {isRunning ? 'Running' : 'Paused'}
            </Typography.SmallBodyAlt>
          </div>
          <Typography.SmallBody as="div" color="secondary">
            Tick #{tickNumber.toLocaleString()}
          </Typography.SmallBody>
          <Typography.SmallBody as="div" color="secondary">
            Last tick: {formatAgo(lastTickAt)}
          </Typography.SmallBody>
          {isRunning && currentStage !== 'idle' && (
            <Typography.SmallBody as="div" color="secondary">
              Currently: {currentStage === 'gather' ? 'Gathering context' : currentStage === 'mind' ? 'Thinking' : currentStage === 'execute' ? 'Executing' : currentStage}
            </Typography.SmallBody>
          )}
        </div>

        {!isRunning && (
          <div css={css`
            padding: ${theme.spacing[3]} ${theme.spacing[4]};
            background: ${theme.colors.warning.main}1a;
            border-radius: ${theme.borderRadius.default};
          `}>
            <Typography.SmallBody color={theme.colors.warning.dark}>
              Heartbeat is paused. Your Animus is not thinking.
            </Typography.SmallBody>
          </div>
        )}

        <div>
          {isRunning ? (
            <Button variant="secondary" size="sm" onClick={() => setShowPauseConfirm(true)}>
              Pause heartbeat
            </Button>
          ) : (
            <Button size="sm" onClick={handleResume} loading={startMutation.isPending}>
              Resume heartbeat
            </Button>
          )}
        </div>

        <Modal open={showPauseConfirm} onClose={() => setShowPauseConfirm(false)}>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              Pause heartbeat?
            </Typography.Subtitle>
            <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
              Pausing the heartbeat stops all internal processes. Your Animus will stop thinking, feeling, and acting until resumed.
            </Typography.SmallBody>
            <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
              <Button variant="ghost" size="sm" onClick={() => setShowPauseConfirm(false)}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handlePause} loading={stopMutation.isPending}>
                Pause
              </Button>
            </div>
          </div>
        </Modal>
      </div>

      {/* Session Info */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Session
        </Typography.Subtitle>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <Typography.SmallBody as="span" color="secondary">State:</Typography.SmallBody>
          <Badge variant={sessionState === 'active' ? 'success' : sessionState === 'warm' ? 'warning' : 'default'}>
            {sessionState.charAt(0).toUpperCase() + sessionState.slice(1)}
          </Badge>
        </div>

        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
            <Typography.SmallBody as="label" color="secondary">
              Warmth window: {Math.round(warmthMs / 60000)} min
            </Typography.SmallBody>
            <SaveIndicator show={warmthSave.show} />
          </div>
          <Slider
            value={warmthMs / 60000}
            onChange={handleWarmthChange}
            min={5}
            max={60}
            step={5}
            leftLabel="5 min"
            rightLabel="60 min"
            showNeutral={false}
          />
        </div>

        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
            <Typography.SmallBody as="label" color="secondary">
              Context budget: {Math.round(contextBudget * 100)}%
            </Typography.SmallBody>
            <SaveIndicator show={budgetSave.show} />
          </div>
          <Slider
            value={contextBudget}
            onChange={handleBudgetChange}
            min={0.3}
            max={1}
            step={0.05}
            leftLabel="30%"
            rightLabel="100%"
            showNeutral={false}
          />
        </div>
      </div>

      {/* Sleep & Energy */}
      <SleepEnergySettings />
    </div>
  );
}

// ============================================================================
// Sleep & Energy Settings (rendered inside HeartbeatSection)
// ============================================================================

function SleepEnergySettings() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: systemSettings } = trpc.settings.getSystemSettings.useQuery();
  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation({
    onSuccess: () => utils.settings.getSystemSettings.invalidate(),
  });

  const enabledSave = useSaveFlash();
  const sleepStartSave = useSaveFlash();
  const sleepEndSave = useSaveFlash();
  const sleepIntervalSave = useSaveFlash();

  const energyEnabled = systemSettings?.energySystemEnabled ?? true;
  const sleepStartHour = systemSettings?.sleepStartHour ?? 22;
  const sleepEndHour = systemSettings?.sleepEndHour ?? 7;
  const sleepTickIntervalMs = systemSettings?.sleepTickIntervalMs ?? 1800000;

  const [localSleepInterval, setLocalSleepInterval] = useState<number | null>(null);
  const intervalTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const displayInterval = localSleepInterval ?? sleepTickIntervalMs;

  const formatHour = (h: number): string => {
    const suffix = h >= 12 ? 'PM' : 'AM';
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${display}:00 ${suffix}`;
  };

  const formatSleepInterval = (ms: number): string => {
    const mins = Math.round(ms / 60000);
    if (mins >= 60) {
      const hrs = mins / 60;
      return `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)} hour${hrs !== 1 ? 's' : ''}`;
    }
    return `${mins} min`;
  };

  const handleToggle = (checked: boolean) => {
    updateSettingsMutation.mutate({ energySystemEnabled: checked }, { onSuccess: () => enabledSave.flash() });
  };

  const handleSleepStartChange = (hour: number) => {
    updateSettingsMutation.mutate({ sleepStartHour: hour }, { onSuccess: () => sleepStartSave.flash() });
  };

  const handleSleepEndChange = (hour: number) => {
    updateSettingsMutation.mutate({ sleepEndHour: hour }, { onSuccess: () => sleepEndSave.flash() });
  };

  const handleSleepIntervalChange = (mins: number) => {
    const ms = mins * 60000;
    setLocalSleepInterval(ms);
    clearTimeout(intervalTimerRef.current);
    intervalTimerRef.current = setTimeout(() => {
      updateSettingsMutation.mutate({ sleepTickIntervalMs: ms }, { onSuccess: () => sleepIntervalSave.flash() });
    }, 300);
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
      <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
        Sleep & Energy
      </Typography.Subtitle>

      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
        <Toggle
          checked={energyEnabled}
          onChange={handleToggle}
          label="Enable sleep & energy system"
        />
        <SaveIndicator show={enabledSave.show} />
      </div>

      <Typography.Caption as="p" color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
        Adds a circadian rhythm to your Animus. Energy rises and falls throughout the day, and sleep emerges naturally when energy drops.
      </Typography.Caption>

      <AnimatePresence initial={false}>
        {energyEnabled && (
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
              padding-top: ${theme.spacing[3]};
            `}>
              {/* Sleep Start Hour */}
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
                  <Typography.SmallBody as="label" color="secondary">
                    Sleep starts at
                  </Typography.SmallBody>
                  <SaveIndicator show={sleepStartSave.show} />
                </div>
                <select
                  value={sleepStartHour}
                  onChange={(e) => handleSleepStartChange(parseInt(e.target.value, 10))}
                  css={css`
                    padding: ${theme.spacing[2]} ${theme.spacing[3]};
                    border-radius: ${theme.borderRadius.default};
                    border: 1px solid ${theme.colors.border.default};
                    background: ${theme.colors.background.paper};
                    color: ${theme.colors.text.primary};
                    font-size: ${theme.typography.fontSize.sm};
                    font-family: ${theme.typography.fontFamily.sans};
                    cursor: pointer;
                    max-width: 160px;

                    &:focus {
                      outline: none;
                      border-color: ${theme.colors.border.focus};
                    }
                  `}
                >
                  {hours.map((h) => (
                    <option key={h} value={h}>{formatHour(h)}</option>
                  ))}
                </select>
              </div>

              {/* Sleep End Hour */}
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
                  <Typography.SmallBody as="label" color="secondary">
                    Wake up at
                  </Typography.SmallBody>
                  <SaveIndicator show={sleepEndSave.show} />
                </div>
                <select
                  value={sleepEndHour}
                  onChange={(e) => handleSleepEndChange(parseInt(e.target.value, 10))}
                  css={css`
                    padding: ${theme.spacing[2]} ${theme.spacing[3]};
                    border-radius: ${theme.borderRadius.default};
                    border: 1px solid ${theme.colors.border.default};
                    background: ${theme.colors.background.paper};
                    color: ${theme.colors.text.primary};
                    font-size: ${theme.typography.fontSize.sm};
                    font-family: ${theme.typography.fontFamily.sans};
                    cursor: pointer;
                    max-width: 160px;

                    &:focus {
                      outline: none;
                      border-color: ${theme.colors.border.focus};
                    }
                  `}
                >
                  {hours.map((h) => (
                    <option key={h} value={h}>{formatHour(h)}</option>
                  ))}
                </select>
              </div>

              {/* Sleep Tick Interval */}
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
                  <Typography.SmallBody as="label" color="secondary">
                    Sleep tick interval: {formatSleepInterval(displayInterval)}
                  </Typography.SmallBody>
                  <SaveIndicator show={sleepIntervalSave.show} />
                </div>
                <Slider
                  value={displayInterval / 60000}
                  onChange={handleSleepIntervalChange}
                  min={15}
                  max={120}
                  step={15}
                  leftLabel="15 min"
                  rightLabel="2 hours"
                  showNeutral={false}
                />
                <Typography.Caption as="p" color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
                  How often your Animus thinks while sleeping. Longer intervals mean less processing during sleep.
                </Typography.Caption>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Section: Agent Provider
// ============================================================================

function ProviderSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: systemSettings } = trpc.settings.getSystemSettings.useQuery();
  const { data: claudeKey } = trpc.provider.hasKey.useQuery({ provider: 'claude' });
  const { data: codexKey } = trpc.provider.hasKey.useQuery({ provider: 'codex' });
  const { data: detectData } = trpc.provider.detect.useQuery();

  const saveKeyMutation = trpc.provider.saveKey.useMutation({
    onSuccess: () => {
      utils.provider.hasKey.invalidate();
      utils.provider.detect.invalidate();
    },
  });
  const validateMutation = trpc.provider.validateKey.useMutation();
  const removeKeyMutation = trpc.provider.removeKey.useMutation({
    onSuccess: () => {
      utils.provider.hasKey.invalidate();
      utils.provider.detect.invalidate();
    },
  });
  const useCliMutation = trpc.provider.useCli.useMutation({
    onSuccess: () => {
      utils.provider.hasKey.invalidate();
      utils.provider.detect.invalidate();
    },
  });
  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation({
    onSuccess: () => utils.settings.getSystemSettings.invalidate(),
  });

  // Codex OAuth mutations
  const codexInitiateMutation = trpc.codexAuth.initiate.useMutation();
  const codexCancelMutation = trpc.codexAuth.cancel.useMutation();

  const activeProvider = systemSettings?.defaultAgentProvider ?? 'claude';
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [credentialInput, setCredentialInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [switchConfirm, setSwitchConfirm] = useState<string | null>(null);
  const [validateResult, setValidateResult] = useState<{ valid: boolean; message: string } | null>(null);

  // Codex OAuth state
  const [codexOAuthSession, setCodexOAuthSession] = useState<string | null>(null);
  const [codexOAuthData, setCodexOAuthData] = useState<{
    userCode: string;
    verificationUrl: string;
    expiresIn: number;
  } | null>(null);
  const [codexOAuthStatus, setCodexOAuthStatus] = useState<'idle' | 'pending' | 'success' | 'error' | 'expired'>('idle');
  const [codexOAuthMessage, setCodexOAuthMessage] = useState('');
  const [codexCountdown, setCodexCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopCountdown();
  }, [stopCountdown]);

  // Codex OAuth status subscription
  trpc.codexAuth.status.useSubscription(
    { sessionId: codexOAuthSession! },
    {
      enabled: codexOAuthSession !== null && codexOAuthStatus === 'pending',
      onData: (data) => {
        if (data.status === 'success') {
          setCodexOAuthStatus('success');
          stopCountdown();
          utils.provider.hasKey.invalidate();
          utils.provider.detect.invalidate();
        } else if (data.status === 'error') {
          setCodexOAuthStatus('error');
          setCodexOAuthMessage(data.message ?? 'Authorization failed');
          stopCountdown();
        } else if (data.status === 'expired') {
          setCodexOAuthStatus('expired');
          setCodexOAuthMessage('Authorization code expired');
          stopCountdown();
        } else if (data.status === 'cancelled') {
          setCodexOAuthStatus('idle');
          stopCountdown();
        }
      },
    }
  );

  // Derive CLI detection
  const claudeCliAvailable = detectData?.find((d) => d.provider === 'claude')?.methods.some((m) => m.method === 'cli' && m.available) ?? false;
  const codexCliAvailable = detectData?.find((d) => d.provider === 'codex')?.methods.some((m) => m.method === 'cli' && m.available) ?? false;

  // Infer credential type from input prefix
  const inferredType = (() => {
    if (!credentialInput || credentialInput.length < 5) return null;
    if (credentialInput.startsWith('sk-ant-oat01-')) return 'OAuth Token';
    if (credentialInput.startsWith('sk-ant-api03-')) return 'API Key';
    if (credentialInput.startsWith('sk-ant-')) return 'API Key';
    if (credentialInput.startsWith('sk-')) return 'API Key';
    return null;
  })();

  // Format credential type for badge display
  const getCredentialBadge = (keyData: typeof claudeKey) => {
    if (!keyData?.hasKey) return { label: 'Not configured', variant: 'default' as const };
    switch (keyData.credentialType) {
      case 'api_key': return { label: 'API Key', variant: 'success' as const };
      case 'oauth_token': return { label: 'OAuth Token', variant: 'success' as const };
      case 'codex_oauth': return { label: 'ChatGPT OAuth', variant: 'success' as const };
      case 'cli_detected': return { label: 'CLI', variant: 'success' as const };
      default: return { label: 'Connected', variant: 'success' as const };
    }
  };

  const providers = [
    {
      id: 'claude' as const,
      name: 'Claude',
      description: 'By Anthropic. Full-featured agent with native tool use and streaming.',
      keyData: claudeKey,
      cliAvailable: claudeCliAvailable,
    },
    {
      id: 'codex' as const,
      name: 'Codex',
      description: 'By OpenAI. Code-focused agent with function calling.',
      keyData: codexKey,
      cliAvailable: codexCliAvailable,
    },
  ];

  const handleSwitch = (provider: string) => {
    if (provider === activeProvider) return;
    setSwitchConfirm(provider);
  };

  const confirmSwitch = () => {
    if (!switchConfirm) return;
    updateSettingsMutation.mutate({ defaultAgentProvider: switchConfirm as any });
    setSwitchConfirm(null);
  };

  const handleValidateAndSave = (provider: 'claude' | 'codex') => {
    if (!credentialInput.trim()) return;
    validateMutation.mutate(
      { provider, key: credentialInput },
      {
        onSuccess: (result) => {
          setValidateResult(result);
          if (result.valid) {
            saveKeyMutation.mutate(
              { provider, key: credentialInput, credentialType: result.credentialType as 'api_key' | 'oauth_token' | undefined },
              {
                onSuccess: () => {
                  setCredentialInput('');
                  setShowKey(false);
                },
              },
            );
          }
        },
      },
    );
  };

  const handleRemove = (provider: 'claude' | 'codex') => {
    removeKeyMutation.mutate({ provider });
  };

  const handleUseCli = (provider: 'claude' | 'codex') => {
    useCliMutation.mutate({ provider });
  };

  const handleCodexOAuthStart = () => {
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
    setCodexOAuthStatus('idle');
    setCodexOAuthSession(null);
    setCodexOAuthData(null);
    stopCountdown();
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
      {providers.map((p) => {
        const badge = getCredentialBadge(p.keyData);
        const hasKey = p.keyData?.hasKey ?? false;

        return (
          <Card
            key={p.id}
            variant={activeProvider === p.id ? 'elevated' : 'outlined'}
            padding="md"
          >
            <div
              css={css`cursor: pointer;`}
              onClick={() => {
                setExpandedProvider(expandedProvider === p.id ? null : p.id);
                setCredentialInput('');
                setValidateResult(null);
                setShowKey(false);
              }}
            >
              <div css={css`display: flex; align-items: center; justify-content: space-between; margin-bottom: ${theme.spacing[1]};`}>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                  <Typography.Subtitle as="span">
                    {p.name}
                  </Typography.Subtitle>
                  {activeProvider === p.id && (
                    <Badge variant="success">Currently active</Badge>
                  )}
                </div>
                <Badge variant={badge.variant}>
                  {badge.label}
                </Badge>
              </div>
              <Typography.SmallBody color="secondary">
                {p.description}
              </Typography.SmallBody>
            </div>

            <AnimatePresence>
              {expandedProvider === p.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  css={css`overflow: hidden;`}
                >
                  <div css={css`
                    margin-top: ${theme.spacing[4]};
                    padding-top: ${theme.spacing[4]};
                    border-top: 1px solid ${theme.colors.border.light};
                    display: flex;
                    flex-direction: column;
                    gap: ${theme.spacing[3]};
                  `}>
                    {/* CLI detection */}
                    {p.cliAvailable && (
                      <div css={css`
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: ${theme.spacing[3]};
                        background: ${theme.colors.background.elevated};
                        border-radius: ${theme.borderRadius.sm};
                        gap: ${theme.spacing[2]};
                      `}>
                        <Typography.SmallBody as="div" color="secondary">
                          {p.name} CLI detected
                        </Typography.SmallBody>
                        {p.keyData?.credentialType === 'cli_detected' ? (
                          <Typography.Caption as="span" color={theme.colors.success.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                            <CheckCircle size={14} weight="fill" /> Active
                          </Typography.Caption>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleUseCli(p.id); }} loading={useCliMutation.isPending}>
                            Use CLI
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Codex OAuth section */}
                    {p.id === 'codex' && (
                      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                        {codexOAuthStatus === 'idle' && (
                          <div css={css`
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            padding: ${theme.spacing[3]};
                            border: 1px solid ${theme.colors.border.light};
                            border-radius: ${theme.borderRadius.sm};
                            gap: ${theme.spacing[2]};
                          `}>
                            <div>
                              <Typography.SmallBody as="div">
                                ChatGPT Sign In
                              </Typography.SmallBody>
                              <Typography.Caption as="div" color="hint">
                                Use your ChatGPT subscription
                              </Typography.Caption>
                            </div>
                            <Button size="sm" onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleCodexOAuthStart(); }} loading={codexInitiateMutation.isPending}>
                              Sign in
                            </Button>
                          </div>
                        )}

                        {codexOAuthStatus === 'pending' && codexOAuthData && (
                          <div css={css`
                            padding: ${theme.spacing[3]};
                            border: 1px solid ${theme.colors.border.default};
                            border-radius: ${theme.borderRadius.sm};
                            display: flex;
                            flex-direction: column;
                            gap: ${theme.spacing[3]};
                          `}>
                            <Typography.SmallBody as="div" color="secondary">
                              Open{' '}
                              <a
                                href={codexOAuthData.verificationUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                css={css`color: ${theme.colors.text.primary}; font-weight: ${theme.typography.fontWeight.medium}; text-decoration: none; &:hover { text-decoration: underline; }`}
                                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                              >
                                {codexOAuthData.verificationUrl} <ArrowSquareOut size={12} css={css`vertical-align: middle;`} />
                              </a>{' '}
                              and enter:
                            </Typography.SmallBody>
                            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                              <Typography.Subtitle as="code" css={css`
                                font-weight: ${theme.typography.fontWeight.semibold};
                                letter-spacing: 0.12em;
                                background: ${theme.colors.background.elevated};
                                padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
                                border-radius: ${theme.borderRadius.sm};
                                border: 1px solid ${theme.colors.border.default};
                              `}>
                                {codexOAuthData.userCode}
                              </Typography.Subtitle>
                              <button
                                onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleCopyCode(codexOAuthData.userCode); }}
                                css={css`
                                  display: flex; align-items: center; gap: ${theme.spacing[0.5]};
                                  font-size: ${theme.typography.fontSize.xs};
                                  color: ${codeCopied ? theme.colors.success.main : theme.colors.text.hint};
                                  cursor: pointer; padding: ${theme.spacing[1]};
                                  &:hover { color: ${codeCopied ? theme.colors.success.main : theme.colors.text.primary}; }
                                `}
                              >
                                {codeCopied ? <CheckCircle size={12} /> : <Copy size={12} />}
                                {codeCopied ? 'Copied' : 'Copy'}
                              </button>
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
                              <Typography.Caption color="hint">
                                Waiting...
                              </Typography.Caption>
                              {codexCountdown > 0 && (
                                <Typography.Caption color="disabled" css={css`margin-left: auto;`}>
                                  {formatCountdown(codexCountdown)}
                                </Typography.Caption>
                              )}
                            </div>
                            <Button variant="ghost" size="sm" onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleCodexOAuthCancel(); }}>
                              Cancel
                            </Button>
                          </div>
                        )}

                        {codexOAuthStatus === 'success' && (
                          <Typography.SmallBody as="div" color={theme.colors.success.main} css={css`
                            display: flex; align-items: center; gap: ${theme.spacing[2]};
                            padding: ${theme.spacing[2]} ${theme.spacing[3]};
                            background: ${theme.colors.success.main}0d;
                            border-radius: ${theme.borderRadius.sm};
                          `}>
                            <CheckCircle size={16} weight="fill" /> Signed in with ChatGPT
                          </Typography.SmallBody>
                        )}

                        {(codexOAuthStatus === 'error' || codexOAuthStatus === 'expired') && (
                          <div css={css`
                            display: flex; align-items: center; justify-content: space-between;
                            padding: ${theme.spacing[2]} ${theme.spacing[3]};
                            background: ${theme.colors.error.main}0d;
                            border-radius: ${theme.borderRadius.sm};
                          `}>
                            <Typography.SmallBody as="span" color={theme.colors.error.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                              <XCircle size={16} weight="fill" /> {codexOAuthMessage || 'Failed'}
                            </Typography.SmallBody>
                            <Button variant="ghost" size="sm" onClick={(e: React.MouseEvent) => { e.stopPropagation(); setCodexOAuthStatus('idle'); setCodexOAuthSession(null); setCodexOAuthData(null); }}>
                              Retry
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Credential input */}
                    <div css={css`display: flex; gap: ${theme.spacing[2]}; align-items: flex-end;`}>
                      <div css={css`flex: 1;`}>
                        <Input
                          label={p.id === 'claude' ? 'API Key or OAuth Token' : 'API Key'}
                          type={showKey ? 'text' : 'password'}
                          value={credentialInput}
                          onChange={(e) => { setCredentialInput((e.target as HTMLInputElement).value); setValidateResult(null); }}
                          placeholder={hasKey ? '********' : (p.id === 'claude' ? 'sk-ant-api03-... or sk-ant-oat01-...' : 'sk-proj-...')}
                          rightElement={
                            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[1.5]};`}>
                              {inferredType && credentialInput.length > 8 && (
                                <Typography.Caption color="hint" css={css`
                                  background: ${theme.colors.background.elevated};
                                  padding: 1px ${theme.spacing[1]};
                                  border-radius: ${theme.borderRadius.sm};
                                  white-space: nowrap;
                                `}>
                                  {inferredType}
                                </Typography.Caption>
                              )}
                              <Tooltip content="Encrypted at rest and injected securely at runtime" position="top" align="right">
                                <ShieldCheck size={16} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
                              </Tooltip>
                              <button
                                onClick={(e) => { e.stopPropagation(); setShowKey(!showKey); }}
                                css={css`
                                  cursor: pointer; padding: 0; color: ${theme.colors.text.hint};
                                  &:hover { color: ${theme.colors.text.primary}; }
                                `}
                              >
                                {showKey ? <EyeSlash size={16} /> : <Eye size={16} />}
                              </button>
                            </div>
                          }
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleValidateAndSave(p.id); }}
                        loading={validateMutation.isPending || saveKeyMutation.isPending}
                        disabled={!credentialInput.trim()}
                      >
                        Validate & Save
                      </Button>
                    </div>
                    {validateResult && (
                      <Typography.Caption as="div" color={validateResult.valid ? theme.colors.success.main : theme.colors.error.main}>
                        {validateResult.message}
                      </Typography.Caption>
                    )}

                    {/* Action buttons */}
                    <div css={css`display: flex; gap: ${theme.spacing[2]}; flex-wrap: wrap;`}>
                      {activeProvider !== p.id && hasKey && (
                        <Button variant="secondary" size="sm" onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleSwitch(p.id); }}>
                          Switch to {p.name}
                        </Button>
                      )}
                      {hasKey && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleRemove(p.id); }}
                          loading={removeKeyMutation.isPending}
                        >
                          <Trash size={14} css={css`margin-right: ${theme.spacing[1]};`} />
                          Remove
                        </Button>
                      )}
                    </div>

                    {/* Security footnote */}
                    <Typography.Caption as="div" color="disabled" css={css`
                      display: flex; align-items: center; gap: ${theme.spacing[1.5]};
                    `}>
                      <ShieldCheck size={12} css={css`flex-shrink: 0;`} />
                      <span>Encrypted at rest. Never leaves your instance.</span>
                    </Typography.Caption>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        );
      })}

      <Modal open={switchConfirm !== null} onClose={() => setSwitchConfirm(null)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            Switch to {switchConfirm}?
          </Typography.Subtitle>
          <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
            Your Animus will use {switchConfirm} for all future thinking. The current mind session will end and restart with the new provider.
          </Typography.SmallBody>
          <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
            <Button variant="ghost" size="sm" onClick={() => setSwitchConfirm(null)}>Cancel</Button>
            <Button size="sm" onClick={confirmSwitch} loading={updateSettingsMutation.isPending}>
              Switch
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================================
// Section: Channels
// ============================================================================

// Status → Badge variant mapping for channels
const channelStatusBadge: Record<string, { variant: 'default' | 'success' | 'warning' | 'error'; label: string }> = {
  disabled: { variant: 'default', label: 'Disabled' },
  unconfigured: { variant: 'warning', label: 'Needs Configuration' },
  starting: { variant: 'warning', label: 'Starting' },
  connected: { variant: 'success', label: 'Connected' },
  error: { variant: 'error', label: 'Error' },
  failed: { variant: 'error', label: 'Failed' },
};

// Icon mapping for common channel types
const channelIconMap: Record<string, React.ElementType> = {
  web: Globe,
  sms: ChatText,
  discord: DiscordLogo,
  openai_api: Code,
  api: Code,
};

function ChannelsSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  // Queries
  const { data: packages, isLoading } = trpc.channels.listPackages.useQuery();

  // Mutations
  const installMutation = trpc.channels.install.useMutation({
    onSuccess: () => {
      utils.channels.listPackages.invalidate();
      setShowInstallModal(false);
      setInstallPath('');
    },
  });
  const uninstallMutation = trpc.channels.uninstall.useMutation({
    onSuccess: () => utils.channels.listPackages.invalidate(),
  });
  const enableMutation = trpc.channels.enable.useMutation({
    onSuccess: () => utils.channels.listPackages.invalidate(),
  });
  const disableMutation = trpc.channels.disable.useMutation({
    onSuccess: () => utils.channels.listPackages.invalidate(),
  });
  const restartMutation = trpc.channels.restart.useMutation({
    onSuccess: () => utils.channels.listPackages.invalidate(),
  });

  // Local state
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installPath, setInstallPath] = useState('');
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [configChannel, setConfigChannel] = useState<string | null>(null);
  const [uninstallConfirm, setUninstallConfirm] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Real-time status subscription
  trpc.channels.onStatusChange.useSubscription(undefined, {
    onData: () => {
      utils.channels.listPackages.invalidate();
    },
  });

  const handleToggleEnabled = (name: string, currentlyEnabled: boolean) => {
    setMutationError(null);
    if (currentlyEnabled) {
      disableMutation.mutate({ name }, { onError: (err) => setMutationError(err.message) });
    } else {
      enableMutation.mutate({ name }, { onError: (err) => setMutationError(err.message) });
    }
  };

  const handleRestart = (name: string) => {
    setMutationError(null);
    restartMutation.mutate({ name }, { onError: (err) => setMutationError(err.message) });
  };

  const handleUninstall = (name: string) => {
    setMutationError(null);
    uninstallMutation.mutate(
      { name },
      {
        onSuccess: () => setUninstallConfirm(null),
        onError: (err) => {
          setMutationError(err.message);
          setUninstallConfirm(null);
        },
      }
    );
  };

  const handleInstall = () => {
    setMutationError(null);
    installMutation.mutate(
      { path: installPath },
      { onError: (err) => setMutationError(err.message) }
    );
  };

  if (isLoading) {
    return <Typography.Body color="hint" css={css`padding: ${theme.spacing[8]};`}>Loading channels...</Typography.Body>;
  }

  const channelList = packages ?? [];

  // Web channel shown first as built-in
  const webChannel = { name: 'web', displayName: 'Web', description: 'Built-in browser chat interface', status: 'connected' as const, isBuiltIn: true };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* Header */}
      <div css={css`display: flex; align-items: center; justify-content: space-between;`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
          <Typography.Subtitle as="h2" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            Channels
          </Typography.Subtitle>
          {channelList.length > 0 && (
            <Badge variant="default">{channelList.length + 1}</Badge>
          )}
        </div>
        <Button size="sm" onClick={() => { setShowInstallModal(true); setInstallPath(''); }}>
          <Plus size={14} css={css`margin-right: ${theme.spacing[1]};`} />
          Add Channel
        </Button>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {mutationError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            css={css`
              padding: ${theme.spacing[3]} ${theme.spacing[4]};
              background: ${theme.colors.error.main}1a;
              border-radius: ${theme.borderRadius.default};
              display: flex;
              align-items: center;
              justify-content: space-between;
            `}
          >
            <Typography.SmallBody color={theme.colors.error.main}>
              {mutationError}
            </Typography.SmallBody>
            <button
              onClick={() => setMutationError(null)}
              css={css`cursor: pointer; padding: ${theme.spacing[1]}; color: ${theme.colors.error.main}; &:hover { opacity: 0.7; }`}
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Channel list */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        {/* Built-in Web Channel */}
        <Card variant="outlined" padding="md">
          <div css={css`display: flex; align-items: center; justify-content: space-between;`}>
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
              <Globe size={20} />
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[0.5]};`}>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                  <Typography.BodyAlt as="span">{webChannel.displayName}</Typography.BodyAlt>
                  <Badge variant="success">Always on</Badge>
                </div>
                <Typography.Caption color="secondary">{webChannel.description}</Typography.Caption>
              </div>
            </div>
          </div>
        </Card>

        {/* Installed Channel Packages */}
        {channelList.map((channel) => {
          const isExpanded = expandedChannel === channel.name;
          const statusInfo = channelStatusBadge[channel.status] ?? { variant: 'default' as const, label: channel.status };
          const IconComponent = channelIconMap[channel.channelType] ?? Plugs;
          const hasError = channel.status === 'error' || channel.status === 'failed';

          return (
            <Card key={channel.name} variant="outlined" padding="md">
              <div
                css={css`display: flex; align-items: flex-start; justify-content: space-between; cursor: pointer;`}
                onClick={() => setExpandedChannel(isExpanded ? null : channel.name)}
              >
                <div css={css`display: flex; align-items: flex-start; gap: ${theme.spacing[3]}; flex: 1; min-width: 0;`}>
                  <IconComponent size={20} css={css`flex-shrink: 0; margin-top: 2px;`} />
                  <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[0.5]}; flex: 1; min-width: 0;`}>
                    <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; flex-wrap: wrap;`}>
                      <Typography.BodyAlt as="span">{channel.displayName}</Typography.BodyAlt>
                      <Typography.Caption as="span" color="hint">v{channel.version}</Typography.Caption>
                      <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                    </div>
                    {channel.description && (
                      <Typography.SmallBody color="secondary" css={css`
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: ${isExpanded ? 'normal' : 'nowrap'};
                      `}>
                        {channel.description}
                      </Typography.SmallBody>
                    )}
                    {/* Error message inline */}
                    {hasError && channel.lastError && (
                      <div css={css`
                        display: flex;
                        align-items: center;
                        gap: ${theme.spacing[2]};
                        margin-top: ${theme.spacing[1]};
                        padding: ${theme.spacing[1.5]} ${theme.spacing[2]};
                        background: ${theme.colors.error.main}0d;
                        border-radius: ${theme.borderRadius.sm};
                      `}>
                        <Warning size={14} css={css`color: ${theme.colors.error.main}; flex-shrink: 0;`} />
                        <Typography.Caption color={theme.colors.error.main} css={css`flex: 1; word-break: break-word;`}>
                          {channel.lastError}
                        </Typography.Caption>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRestart(channel.name); }}
                          css={css`
                            display: inline-flex;
                            align-items: center;
                            gap: ${theme.spacing[1]};
                            padding: ${theme.spacing[0.5]} ${theme.spacing[2]};
                            font-size: ${theme.typography.fontSize.xs};
                            color: ${theme.colors.error.main};
                            border: 1px solid ${theme.colors.error.main}33;
                            border-radius: ${theme.borderRadius.sm};
                            cursor: pointer;
                            background: transparent;
                            white-space: nowrap;
                            &:hover { background: ${theme.colors.error.main}0d; }
                          `}
                        >
                          <ArrowClockwise size={12} />
                          Retry
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; flex-shrink: 0; margin-left: ${theme.spacing[3]};`} onClick={(e) => e.stopPropagation()}>
                  <Toggle
                    checked={channel.enabled}
                    onChange={() => handleToggleEnabled(channel.name, channel.enabled)}
                  />
                </div>
              </div>

              {/* Expanded detail */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    css={css`overflow: hidden;`}
                  >
                    <div css={css`
                      margin-top: ${theme.spacing[4]};
                      padding-top: ${theme.spacing[4]};
                      border-top: 1px solid ${theme.colors.border.light};
                      display: flex;
                      flex-direction: column;
                      gap: ${theme.spacing[3]};
                    `}>
                      {/* Metadata */}
                      <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[3]};`}>
                        {channel.author && (
                          <Typography.Caption as="span" color="hint">
                            Author: {channel.author.name}
                            {channel.author.url && (
                              <a
                                href={channel.author.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                css={css`
                                  margin-left: ${theme.spacing[1]};
                                  color: ${theme.colors.text.secondary};
                                  &:hover { color: ${theme.colors.text.primary}; }
                                `}
                                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                              >
                                <ArrowSquareOut size={10} css={css`vertical-align: middle;`} />
                              </a>
                            )}
                          </Typography.Caption>
                        )}
                        <Typography.Caption as="span" color="hint">
                          Installed: {new Date(channel.installedAt).toLocaleDateString()}
                        </Typography.Caption>
                      </div>

                      {/* Capabilities */}
                      {channel.capabilities.length > 0 && (
                        <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[1.5]};`}>
                          {channel.capabilities.map((cap) => (
                            <Typography.SmallBody
                              key={cap}
                              as="span"
                              css={css`
                                padding: ${theme.spacing[0.5]} ${theme.spacing[2]};
                                background: ${theme.colors.background.elevated};
                                border-radius: ${theme.borderRadius.sm};
                                font-size: ${theme.typography.fontSize.xs};
                              `}
                            >
                              {cap}
                            </Typography.SmallBody>
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      <div css={css`display: flex; gap: ${theme.spacing[2]}; flex-wrap: wrap;`}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); setConfigChannel(channel.name); }}
                        >
                          <GearFine size={14} css={css`margin-right: ${theme.spacing[1]};`} />
                          Configure
                        </Button>
                        {channel.enabled && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleRestart(channel.name); }}
                            loading={restartMutation.isPending}
                          >
                            <ArrowClockwise size={14} css={css`margin-right: ${theme.spacing[1]};`} />
                            Restart
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); setUninstallConfirm(channel.name); }}
                        >
                          <Trash size={14} css={css`margin-right: ${theme.spacing[1]};`} />
                          Uninstall
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          );
        })}

        {channelList.length === 0 && (
          <div css={css`
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: ${theme.spacing[8]} ${theme.spacing[4]};
            gap: ${theme.spacing[3]};
          `}>
            <Plugs size={32} css={css`color: ${theme.colors.text.disabled};`} />
            <Typography.SmallBody color="hint">No channel packages installed</Typography.SmallBody>
          </div>
        )}
      </div>

      {/* Install Modal */}
      <Modal open={showInstallModal} onClose={() => setShowInstallModal(false)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            Add Channel Package
          </Typography.Subtitle>
          <Input
            label="Absolute path to channel package directory"
            value={installPath}
            onChange={(e) => setInstallPath((e.target as HTMLInputElement).value)}
            placeholder="/path/to/channel-package"
          />
          {installMutation.isError && (
            <div css={css`
              padding: ${theme.spacing[2]} ${theme.spacing[4]};
              background: ${theme.colors.error.main}1a;
              border-radius: ${theme.borderRadius.default};
            `}>
              <Typography.SmallBody color={theme.colors.error.main}>
                {installMutation.error?.message ?? 'Installation failed'}
              </Typography.SmallBody>
            </div>
          )}
          <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
            <Button variant="ghost" size="sm" onClick={() => setShowInstallModal(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleInstall}
              disabled={!installPath.trim()}
              loading={installMutation.isPending}
            >
              Install
            </Button>
          </div>
        </div>
      </Modal>

      {/* Uninstall confirmation modal */}
      <Modal open={uninstallConfirm !== null} onClose={() => setUninstallConfirm(null)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            <Warning size={20} css={css`color: ${theme.colors.error.main};`} />
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              Uninstall {uninstallConfirm}?
            </Typography.Subtitle>
          </div>
          <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
            This will stop the channel and remove it completely. Any contacts using this channel will no longer be reachable through it.
          </Typography.SmallBody>
          <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
            <Button variant="ghost" size="sm" onClick={() => setUninstallConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => uninstallConfirm && handleUninstall(uninstallConfirm)}
              loading={uninstallMutation.isPending}
            >
              Uninstall
            </Button>
          </div>
        </div>
      </Modal>

      {/* Channel Config Modal */}
      {configChannel && (
        <ChannelConfigModal
          channelName={configChannel}
          onClose={() => setConfigChannel(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Channel Config Modal
// ============================================================================

function ChannelConfigModal({
  channelName,
  onClose,
}: {
  channelName: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: configSchema, isLoading: schemaLoading } = trpc.channels.getConfigSchema.useQuery({ name: channelName });
  const { data: currentConfig, isLoading: configLoading } = trpc.channels.getConfig.useQuery({ name: channelName });
  const configureMutation = trpc.channels.configure.useMutation({
    onSuccess: () => {
      utils.channels.getConfig.invalidate({ name: channelName });
      utils.channels.listPackages.invalidate();
      onClose();
    },
  });

  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);

  const fields = configSchema?.fields ?? [];

  // Initialize form values from current config
  useEffect(() => {
    if (initialized || configLoading || schemaLoading) return;
    if (currentConfig !== undefined) {
      const cfg = currentConfig ?? {};
      // Set defaults for fields not in config
      const values: Record<string, unknown> = { ...cfg };
      for (const field of fields) {
        if (values[field.key] === undefined && field.default !== undefined) {
          values[field.key] = field.default;
        }
        // Convert comma-separated strings to arrays for text-list fields
        if (field.type === 'text-list' && typeof values[field.key] === 'string') {
          values[field.key] = (values[field.key] as string).split(',').map((s) => s.trim()).filter(Boolean);
        }
      }
      setConfigValues(values);
      setInitialized(true);
    }
  }, [currentConfig, configLoading, schemaLoading, fields, initialized]);

  // Client-side validation (Bug #20)
  function validateConfig(): boolean {
    const errors: Record<string, string> = {};

    for (const field of fields) {
      const value = configValues[field.key];

      // Required check
      if (field.required) {
        const isEmpty = value === undefined || value === null || value === '' ||
          (Array.isArray(value) && value.length === 0);
        if (isEmpty) {
          errors[field.key] = `${field.label} is required`;
          continue;
        }
      }

      // Skip further validation if empty and not required
      if (value === undefined || value === null || value === '') continue;

      // Regex validation
      if (field.validation && typeof value === 'string') {
        try {
          if (!new RegExp(field.validation).test(value)) {
            errors[field.key] = `Invalid format for ${field.label}`;
          }
        } catch { /* invalid regex, skip */ }
      }

      // URL validation
      if (field.type === 'url' && typeof value === 'string') {
        try {
          new URL(value);
        } catch {
          errors[field.key] = 'Must be a valid URL';
        }
      }

      // Number validation with min/max
      if (field.type === 'number' && value !== undefined && value !== '') {
        const num = Number(value);
        if (isNaN(num)) {
          errors[field.key] = 'Must be a number';
        } else {
          if (field.min !== undefined && num < field.min) {
            errors[field.key] = `Must be at least ${field.min}`;
          }
          if (field.max !== undefined && num > field.max) {
            errors[field.key] = `Must be at most ${field.max}`;
          }
        }
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }

  const handleSave = () => {
    if (!validateConfig()) return;
    configureMutation.mutate({ name: channelName, config: configValues });
  };

  const isLoading = schemaLoading || configLoading;

  return (
    <Modal open onClose={onClose} maxWidth="520px">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}
      >
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Configure: {channelName}
        </Typography.Subtitle>

        {isLoading ? (
          <Typography.SmallBody color="hint">Loading configuration...</Typography.SmallBody>
        ) : fields.length === 0 ? (
          <Typography.SmallBody color="secondary">
            This channel has no configurable settings.
          </Typography.SmallBody>
        ) : (
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
            {fields.map((field) => {
              const value = configValues[field.key];
              const fieldError = validationErrors[field.key];

              if (field.type === 'toggle') {
                return (
                  <div key={field.key} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
                    <Toggle
                      checked={!!value}
                      onChange={(checked) => setConfigValues({ ...configValues, [field.key]: checked })}
                      label={field.label}
                    />
                    {field.helpText && (
                      <Typography.Caption as="p" color="hint" css={css`margin-left: ${theme.spacing[12]};`}>
                        {field.helpText}
                      </Typography.Caption>
                    )}
                    {fieldError && (
                      <span css={css`color: ${theme.colors.error.main}; font-size: 12px; margin-top: 4px; display: block;`}>
                        {fieldError}
                      </span>
                    )}
                  </div>
                );
              }

              if (field.type === 'select' && field.options) {
                return (
                  <div key={field.key} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
                    <label css={css`
                      font-size: ${theme.typography.fontSize.sm};
                      font-weight: ${theme.typography.fontWeight.medium};
                      color: ${theme.colors.text.secondary};
                    `}>
                      {field.label}{field.required && <span css={css`color: ${theme.colors.error.main}; margin-left: 2px;`}>*</span>}
                    </label>
                    <select
                      value={value != null ? String(value) : ''}
                      onChange={(e) => setConfigValues({ ...configValues, [field.key]: e.target.value })}
                      css={css`
                        width: 100%;
                        padding: ${theme.spacing[3]};
                        background: ${theme.colors.background.paper};
                        border: 1px solid ${fieldError ? theme.colors.error.main : theme.colors.border.default};
                        border-radius: ${theme.borderRadius.default};
                        color: ${theme.colors.text.primary};
                        font-size: ${theme.typography.fontSize.base};
                        outline: none;
                        cursor: pointer;
                        &:focus { border-color: ${fieldError ? theme.colors.error.main : theme.colors.border.focus}; }
                      `}
                    >
                      <option value="">Select...</option>
                      {field.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {field.helpText && (
                      <Typography.Caption as="p" color="hint">{field.helpText}</Typography.Caption>
                    )}
                    {fieldError && (
                      <span css={css`color: ${theme.colors.error.main}; font-size: 12px; margin-top: 4px; display: block;`}>
                        {fieldError}
                      </span>
                    )}
                  </div>
                );
              }

              if (field.type === 'secret') {
                return (
                  <div key={field.key} css={css`display: flex; flex-direction: column;`}>
                    <Input
                      label={`${field.label}${field.required ? ' *' : ''}`}
                      type={showSecrets[field.key] ? 'text' : 'password'}
                      value={value != null ? String(value) : ''}
                      onChange={(e) => setConfigValues({ ...configValues, [field.key]: (e.target as HTMLInputElement).value })}
                      placeholder={field.placeholder}
                      helperText={field.helpText}
                      error={fieldError}
                      rightElement={
                        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[1.5]};`}>
                          <Tooltip content="Encrypted at rest and injected securely at runtime" position="top" align="right">
                            <ShieldCheck size={16} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
                          </Tooltip>
                          <button
                            type="button"
                            onClick={() => setShowSecrets({ ...showSecrets, [field.key]: !showSecrets[field.key] })}
                            css={css`cursor: pointer; padding: 0; color: ${theme.colors.text.hint}; &:hover { color: ${theme.colors.text.primary}; }`}
                          >
                            {showSecrets[field.key] ? <EyeSlash size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      }
                    />
                  </div>
                );
              }

              // text-list: tag-style input (Bug #18)
              if (field.type === 'text-list') {
                const tags = (Array.isArray(value) ? value : []) as string[];
                return (
                  <div key={field.key} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
                    <label css={css`
                      font-size: ${theme.typography.fontSize.sm};
                      font-weight: ${theme.typography.fontWeight.medium};
                      color: ${theme.colors.text.secondary};
                    `}>
                      {field.label}{field.required && <span css={css`color: ${theme.colors.error.main}; margin-left: 2px;`}>*</span>}
                    </label>
                    <div>
                      {tags.length > 0 && (
                        <div css={css`
                          display: flex;
                          flex-wrap: wrap;
                          gap: 6px;
                          margin-bottom: 8px;
                        `}>
                          {tags.map((tag, i) => (
                            <span key={i} css={css`
                              display: inline-flex;
                              align-items: center;
                              gap: 4px;
                              padding: 2px 8px;
                              background: ${theme.colors.background.elevated};
                              border: 1px solid ${theme.colors.border.default};
                              border-radius: 4px;
                              font-size: 13px;
                              color: ${theme.colors.text.secondary};
                            `}>
                              {tag}
                              <button
                                type="button"
                                onClick={() => {
                                  setConfigValues((prev) => ({
                                    ...prev,
                                    [field.key]: tags.filter((_, idx) => idx !== i),
                                  }));
                                }}
                                css={css`
                                  background: none;
                                  border: none;
                                  cursor: pointer;
                                  padding: 0 2px;
                                  color: ${theme.colors.text.hint};
                                  font-size: 14px;
                                  line-height: 1;
                                  &:hover { color: ${theme.colors.text.primary}; }
                                `}
                              >
                                &times;
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <input
                        type="text"
                        placeholder={field.placeholder || 'Type and press Enter to add'}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            const val = e.currentTarget.value.trim();
                            if (val) {
                              setConfigValues((prev) => ({
                                ...prev,
                                [field.key]: [...tags, val],
                              }));
                              e.currentTarget.value = '';
                            }
                          }
                        }}
                        css={css`
                          width: 100%;
                          padding: ${theme.spacing[3]};
                          background: ${theme.colors.background.paper};
                          border: 1px solid ${fieldError ? theme.colors.error.main : theme.colors.border.default};
                          border-radius: ${theme.borderRadius.default};
                          color: ${theme.colors.text.primary};
                          font-size: ${theme.typography.fontSize.base};
                          outline: none;
                          &:focus { border-color: ${fieldError ? theme.colors.error.main : theme.colors.border.focus}; }
                          &::placeholder { color: ${theme.colors.text.hint}; }
                        `}
                      />
                    </div>
                    {field.helpText && (
                      <Typography.Caption as="p" color="hint">{field.helpText}</Typography.Caption>
                    )}
                    {fieldError && (
                      <span css={css`color: ${theme.colors.error.main}; font-size: 12px; margin-top: 4px; display: block;`}>
                        {fieldError}
                      </span>
                    )}
                  </div>
                );
              }

              // text, url, number
              return (
                <Input
                  key={field.key}
                  label={`${field.label}${field.required ? ' *' : ''}`}
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={value != null ? String(value) : ''}
                  onChange={(e) => {
                    const raw = (e.target as HTMLInputElement).value;
                    const parsed = field.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
                    setConfigValues({ ...configValues, [field.key]: parsed });
                  }}
                  placeholder={field.placeholder}
                  helperText={field.helpText}
                  error={fieldError}
                />
              );
            })}
          </div>
        )}

        {configureMutation.isError && (
          <div css={css`
            padding: ${theme.spacing[2]} ${theme.spacing[4]};
            background: ${theme.colors.error.main}1a;
            border-radius: ${theme.borderRadius.default};
          `}>
            <Typography.SmallBody color={theme.colors.error.main}>
              {configureMutation.error?.message ?? 'Configuration failed'}
            </Typography.SmallBody>
          </div>
        )}

        <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
          <Button variant="ghost" size="sm" onClick={onClose} type="button">Cancel</Button>
          <Button size="sm" type="submit" loading={configureMutation.isPending} disabled={fields.length === 0}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================================
// Section: Goals
// ============================================================================

function GoalsSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: settings } = trpc.settings.getSystemSettings.useQuery();
  const updateMutation = trpc.settings.updateSystemSettings.useMutation({
    onSuccess: () => utils.settings.getSystemSettings.invalidate(),
  });
  const goalSave = useSaveFlash();

  const currentMode = settings?.goalApprovalMode ?? 'always_approve';

  const modes = [
    {
      id: 'always_approve' as const,
      label: 'Ask me first',
      description: 'Your Animus will propose goals conversationally and wait for your approval before pursuing them.',
    },
    {
      id: 'auto_approve' as const,
      label: "Go ahead, I'll review",
      description: 'Your Animus will start pursuing goals immediately and let you know. You can cancel anytime.',
    },
    {
      id: 'full_autonomy' as const,
      label: 'Full autonomy',
      description: 'Your Animus will pursue goals independently. You can discover and manage goals in the Mind space.',
    },
  ];

  const handleSelect = (mode: typeof currentMode) => {
    updateMutation.mutate({ goalApprovalMode: mode }, { onSuccess: () => goalSave.flash() });
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
        <Typography.SmallBodyAlt as="label" color="secondary">
          How should your Animus handle new goals?
        </Typography.SmallBodyAlt>
        <SaveIndicator show={goalSave.show} />
      </div>

      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        {modes.map((mode) => (
          <SelectionCard
            key={mode.id}
            selected={currentMode === mode.id}
            padding="md"
            onClick={() => handleSelect(mode.id)}
          >
            <div>
              <Typography.BodyAlt as="span">{mode.label}</Typography.BodyAlt>
              <Typography.SmallBody color="secondary" css={css`margin-top: ${theme.spacing[1]};`}>
                {mode.description}
              </Typography.SmallBody>
            </div>
          </SelectionCard>
        ))}
      </div>

      <Typography.SmallBody color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
        Goals with average salience below 0.05 over 30 days are automatically cleaned up.
      </Typography.SmallBody>
    </div>
  );
}

// ============================================================================
// Section: Plugins
// ============================================================================

// Component label map for human-friendly display
const componentLabelMap: Record<string, { singular: string; plural: string }> = {
  skills: { singular: 'skill', plural: 'skills' },
  tools: { singular: 'tool', plural: 'tools' },
  contextSources: { singular: 'context source', plural: 'context sources' },
  hooks: { singular: 'hook', plural: 'hooks' },
  decisionTypes: { singular: 'decision type', plural: 'decision types' },
  triggers: { singular: 'trigger', plural: 'triggers' },
  agents: { singular: 'agent', plural: 'agents' },
};

// Source badge configuration
const sourceBadgeConfig: Record<string, { variant: 'default' | 'info' | 'success' | 'warning'; label: string }> = {
  'built-in': { variant: 'default', label: 'built-in' },
  local: { variant: 'info', label: 'local' },
  git: { variant: 'success', label: 'git' },
  npm: { variant: 'warning', label: 'npm' },
};

// Status → Badge variant mapping for plugins (mirrors channelStatusBadge)
const pluginStatusBadge: Record<string, { variant: 'default' | 'success' | 'warning'; label: string }> = {
  disabled: { variant: 'default', label: 'Disabled' },
  unconfigured: { variant: 'warning', label: 'Needs Configuration' },
  active: { variant: 'success', label: 'Active' },
};

function PluginsSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  // Queries
  const { data: plugins, isLoading } = trpc.plugins.list.useQuery();

  // Mutations
  const installMutation = trpc.plugins.install.useMutation({
    onSuccess: () => {
      utils.plugins.list.invalidate();
      setShowInstallModal(false);
      setInstallPath('');
      setInstallValidation(null);
    },
  });
  const uninstallMutation = trpc.plugins.uninstall.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });
  const enableMutation = trpc.plugins.enable.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });
  const disableMutation = trpc.plugins.disable.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });
  const setConfigMutation = trpc.plugins.setConfig.useMutation({
    onSuccess: () => {
      utils.plugins.list.invalidate();
      setConfigPlugin(null);
    },
  });

  // Local state
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installTab, setInstallTab] = useState<'local' | 'git' | 'npm'>('local');
  const [installPath, setInstallPath] = useState('');
  const [installValidation, setInstallValidation] = useState<{
    valid: boolean;
    manifest?: any;
    error?: string;
  } | null>(null);
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [configPlugin, setConfigPlugin] = useState<string | null>(null);
  const [uninstallConfirm, setUninstallConfirm] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Validate path query (lazy)
  const validateQuery = trpc.plugins.validatePath.useQuery(
    { path: installPath },
    { enabled: false }
  );

  const handleValidatePath = async () => {
    const result = await validateQuery.refetch();
    if (result.data) {
      setInstallValidation(result.data);
    }
  };

  const handleInstall = () => {
    setMutationError(null);
    installMutation.mutate(
      { source: installTab, path: installPath },
      {
        onError: (err) => setMutationError(err.message),
      }
    );
  };

  const handleToggleEnabled = (name: string, currentlyEnabled: boolean) => {
    setMutationError(null);
    if (currentlyEnabled) {
      disableMutation.mutate({ name }, { onError: (err) => setMutationError(err.message) });
    } else {
      enableMutation.mutate({ name }, { onError: (err) => setMutationError(err.message) });
    }
  };

  const handleUninstall = (name: string) => {
    setMutationError(null);
    uninstallMutation.mutate(
      { name },
      {
        onSuccess: () => setUninstallConfirm(null),
        onError: (err) => {
          setMutationError(err.message);
          setUninstallConfirm(null);
        },
      }
    );
  };

  if (isLoading) {
    return <Typography.Body color="hint" css={css`padding: ${theme.spacing[8]};`}>Loading plugins...</Typography.Body>;
  }

  const pluginList = plugins ?? [];

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* Header */}
      <div css={css`display: flex; align-items: center; justify-content: space-between;`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
          <Typography.Subtitle as="h2" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            Plugins
          </Typography.Subtitle>
          {pluginList.length > 0 && (
            <Badge variant="default">{pluginList.length}</Badge>
          )}
        </div>
        <Button size="sm" onClick={() => { setShowInstallModal(true); setInstallPath(''); setInstallValidation(null); setInstallTab('local'); }}>
          <Plus size={14} css={css`margin-right: ${theme.spacing[1]};`} />
          Add Plugin
        </Button>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {mutationError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            css={css`
              padding: ${theme.spacing[3]} ${theme.spacing[4]};
              background: ${theme.colors.error.main}1a;
              border-radius: ${theme.borderRadius.default};
              display: flex;
              align-items: center;
              justify-content: space-between;
            `}
          >
            <Typography.SmallBody color={theme.colors.error.main}>
              {mutationError}
            </Typography.SmallBody>
            <button
              onClick={() => setMutationError(null)}
              css={css`cursor: pointer; padding: ${theme.spacing[1]}; color: ${theme.colors.error.main}; &:hover { opacity: 0.7; }`}
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Plugin list */}
      {pluginList.length === 0 ? (
        <div css={css`
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: ${theme.spacing[12]} ${theme.spacing[4]};
          gap: ${theme.spacing[4]};
        `}>
          <PuzzlePiece size={40} css={css`color: ${theme.colors.text.disabled};`} />
          <Typography.Body color="hint">No plugins installed</Typography.Body>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { setShowInstallModal(true); setInstallPath(''); setInstallValidation(null); setInstallTab('local'); }}
          >
            Add Plugin
          </Button>
        </div>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {pluginList.map((plugin) => {
            const isExpanded = expandedPlugin === plugin.name;
            const source = sourceBadgeConfig[plugin.source] ?? { variant: 'default' as const, label: plugin.source };
            const statusInfo = pluginStatusBadge[plugin.status] ?? { variant: 'default' as const, label: plugin.status };
            const componentBadges = Object.entries(plugin.components)
              .filter(([, count]) => (count as number) > 0)
              .map(([key, count]) => {
                const labels = componentLabelMap[key];
                return labels
                  ? `${count} ${(count as number) === 1 ? labels.singular : labels.plural}`
                  : `${count} ${key}`;
              });

            return (
              <Card key={plugin.name} variant="outlined" padding="md">
                <div
                  css={css`display: flex; align-items: flex-start; justify-content: space-between; cursor: pointer;`}
                  onClick={() => setExpandedPlugin(isExpanded ? null : plugin.name)}
                >
                  <div css={css`display: flex; gap: ${theme.spacing[3]}; flex: 1; min-width: 0;`}>
                    {plugin.iconSvg && (
                      <div
                        css={css`
                          width: 24px;
                          height: 24px;
                          flex-shrink: 0;
                          color: ${theme.colors.text.secondary};
                          display: flex;
                          align-items: center;
                          justify-content: center;
                          & svg { width: 100%; height: 100%; }
                        `}
                        dangerouslySetInnerHTML={{ __html: plugin.iconSvg }}
                      />
                    )}
                    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]}; flex: 1; min-width: 0;`}>
                    <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; flex-wrap: wrap;`}>
                      <Typography.BodyAlt as="span">{plugin.displayName}</Typography.BodyAlt>
                      <Typography.Caption as="span" color="hint">v{plugin.version}</Typography.Caption>
                      <Badge variant={source.variant}>{source.label}</Badge>
                      <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                    </div>
                    {plugin.description && (
                      <Typography.SmallBody color="secondary" css={css`
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: ${isExpanded ? 'normal' : 'nowrap'};
                      `}>
                        {plugin.description}
                      </Typography.SmallBody>
                    )}
                    {componentBadges.length > 0 && (
                      <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[1.5]}; margin-top: ${theme.spacing[0.5]};`}>
                        {componentBadges.map((label) => (
                          <Typography.Caption
                            key={label}
                            as="span"
                            color="hint"
                            css={css`
                              padding: 1px ${theme.spacing[2]};
                              border: 1px solid ${theme.colors.border.default};
                              border-radius: ${theme.borderRadius.full};
                              white-space: nowrap;
                            `}
                          >
                            {label}
                          </Typography.Caption>
                        ))}
                      </div>
                    )}
                    </div>
                  </div>

                  <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; flex-shrink: 0; margin-left: ${theme.spacing[3]};`} onClick={(e) => e.stopPropagation()}>
                    <Toggle
                      checked={plugin.enabled}
                      onChange={() => handleToggleEnabled(plugin.name, plugin.enabled)}
                    />
                  </div>
                </div>

                {/* Expanded detail */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      css={css`overflow: hidden;`}
                    >
                      <PluginDetail
                        pluginName={plugin.name}
                        source={plugin.source}
                        hasConfig={plugin.hasConfig}
                        onConfigure={() => setConfigPlugin(plugin.name)}
                        onUninstall={() => setUninstallConfirm(plugin.name)}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            );
          })}
        </div>
      )}

      {/* Install Modal */}
      <Modal open={showInstallModal} onClose={() => setShowInstallModal(false)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            Add Plugin
          </Typography.Subtitle>

          {/* Tabs */}
          <div css={css`display: flex; gap: ${theme.spacing[1]}; border-bottom: 1px solid ${theme.colors.border.light}; padding-bottom: 0;`}>
            {([
              { id: 'local' as const, label: 'Local Path', icon: FolderOpen },
              { id: 'git' as const, label: 'Git URL', icon: GitBranch },
              { id: 'npm' as const, label: 'npm Package', icon: Package },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setInstallTab(tab.id);
                  setInstallValidation(null);
                  setInstallPath('');
                }}
                css={css`
                  display: flex;
                  align-items: center;
                  gap: ${theme.spacing[1.5]};
                  padding: ${theme.spacing[2]} ${theme.spacing[3]};
                  font-size: ${theme.typography.fontSize.sm};
                  font-weight: ${installTab === tab.id ? theme.typography.fontWeight.medium : theme.typography.fontWeight.normal};
                  color: ${installTab === tab.id ? theme.colors.text.primary : theme.colors.text.secondary};
                  cursor: pointer;
                  border-bottom: 2px solid ${installTab === tab.id ? theme.colors.accent : 'transparent'};
                  margin-bottom: -1px;
                  transition: all ${theme.transitions.micro};

                  &:hover {
                    color: ${theme.colors.text.primary};
                  }
                `}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Local path form */}
          {installTab === 'local' && (
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
              <Input
                label="Absolute path to plugin directory"
                value={installPath}
                onChange={(e) => { setInstallPath((e.target as HTMLInputElement).value); setInstallValidation(null); }}
                placeholder="/path/to/my-plugin"
              />
              <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleValidatePath}
                  disabled={!installPath.trim()}
                  loading={validateQuery.isFetching}
                >
                  Validate
                </Button>
              </div>

              {/* Validation result */}
              <AnimatePresence>
                {installValidation && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    css={css`
                      padding: ${theme.spacing[3]};
                      border-radius: ${theme.borderRadius.default};
                      background: ${installValidation.valid ? theme.colors.success.main : theme.colors.error.main}0d;
                      border: 1px solid ${installValidation.valid ? theme.colors.success.main : theme.colors.error.main}33;
                    `}
                  >
                    {installValidation.valid ? (
                      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                          <CheckCircle size={16} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
                          <Typography.SmallBodyAlt as="span" color={theme.colors.success.main}>
                            Valid plugin manifest
                          </Typography.SmallBodyAlt>
                        </div>
                        {installValidation.manifest && (
                          <div css={css`padding-left: ${theme.spacing[6]};`}>
                            <Typography.SmallBody as="div">
                              {installValidation.manifest.name} <Typography.Caption as="span" color="hint">v{installValidation.manifest.version}</Typography.Caption>
                            </Typography.SmallBody>
                            {installValidation.manifest.description && (
                              <Typography.Caption as="div" color="secondary" css={css`margin-top: ${theme.spacing[0.5]};`}>
                                {installValidation.manifest.description}
                              </Typography.Caption>
                            )}
                            {installValidation.manifest.author && (
                              <Typography.Caption as="div" color="hint" css={css`margin-top: ${theme.spacing[0.5]};`}>
                                by {typeof installValidation.manifest.author === 'string'
                                  ? installValidation.manifest.author
                                  : installValidation.manifest.author.name}
                              </Typography.Caption>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div css={css`display: flex; align-items: flex-start; gap: ${theme.spacing[2]};`}>
                        <XCircle size={16} weight="fill" css={css`color: ${theme.colors.error.main}; flex-shrink: 0; margin-top: 2px;`} />
                        <Typography.SmallBody color={theme.colors.error.main}>
                          {installValidation.error}
                        </Typography.SmallBody>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
                <Button variant="ghost" size="sm" onClick={() => setShowInstallModal(false)}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={handleInstall}
                  disabled={!installValidation?.valid}
                  loading={installMutation.isPending}
                >
                  Install
                </Button>
              </div>
            </div>
          )}

          {/* Git URL form */}
          {installTab === 'git' && (
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
              <Input
                label="Git repository URL"
                value={installPath}
                onChange={(e) => setInstallPath((e.target as HTMLInputElement).value)}
                placeholder="https://github.com/user/animus-plugin.git"
              />
              <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
                <Button variant="ghost" size="sm" onClick={() => setShowInstallModal(false)}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={handleInstall}
                  disabled={!installPath.trim()}
                  loading={installMutation.isPending}
                >
                  Install
                </Button>
              </div>
            </div>
          )}

          {/* npm package form */}
          {installTab === 'npm' && (
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
              <Input
                label="npm package name"
                value={installPath}
                onChange={(e) => setInstallPath((e.target as HTMLInputElement).value)}
                placeholder="@animus/plugin-example"
              />
              <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
                <Button variant="ghost" size="sm" onClick={() => setShowInstallModal(false)}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={handleInstall}
                  disabled={!installPath.trim()}
                  loading={installMutation.isPending}
                >
                  Install
                </Button>
              </div>
            </div>
          )}

          {/* Install error */}
          {installMutation.isError && (
            <div css={css`
              padding: ${theme.spacing[2]} ${theme.spacing[4]};
              background: ${theme.colors.error.main}1a;
              border-radius: ${theme.borderRadius.default};
            `}>
              <Typography.SmallBody color={theme.colors.error.main}>
                {installMutation.error?.message ?? 'Installation failed'}
              </Typography.SmallBody>
            </div>
          )}
        </div>
      </Modal>

      {/* Uninstall confirmation modal */}
      <Modal open={uninstallConfirm !== null} onClose={() => setUninstallConfirm(null)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            <Warning size={20} css={css`color: ${theme.colors.error.main};`} />
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              Uninstall {uninstallConfirm}?
            </Typography.Subtitle>
          </div>
          <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
            This will remove the plugin and all its components. Any skills, tools, or hooks it provides will no longer be available.
          </Typography.SmallBody>
          <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
            <Button variant="ghost" size="sm" onClick={() => setUninstallConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => uninstallConfirm && handleUninstall(uninstallConfirm)}
              loading={uninstallMutation.isPending}
            >
              Uninstall
            </Button>
          </div>
        </div>
      </Modal>

      {/* Configure Plugin Modal */}
      {configPlugin && (
        <PluginConfigModal
          pluginName={configPlugin}
          onClose={() => setConfigPlugin(null)}
          onSave={(config) => {
            setConfigMutation.mutate({ name: configPlugin, config });
          }}
          isSaving={setConfigMutation.isPending}
        />
      )}
    </div>
  );
}

// ============================================================================
// Plugin Detail (expanded view within plugin card)
// ============================================================================

function PluginDetail({
  pluginName,
  source,
  hasConfig,
  onConfigure,
  onUninstall,
}: {
  pluginName: string;
  source: string;
  hasConfig: boolean;
  onConfigure: () => void;
  onUninstall: () => void;
}) {
  const theme = useTheme();
  const { data: detail, isLoading } = trpc.plugins.get.useQuery({ name: pluginName });

  if (isLoading) {
    return (
      <div css={css`
        margin-top: ${theme.spacing[4]};
        padding-top: ${theme.spacing[4]};
        border-top: 1px solid ${theme.colors.border.light};
      `}>
        <Typography.SmallBody color="hint">Loading details...</Typography.SmallBody>
      </div>
    );
  }

  if (!detail) return null;

  const componentSections = [
    { label: 'Skills', items: detail.components.skills },
    { label: 'Tools (MCP)', items: detail.components.tools },
    { label: 'Context Sources', items: detail.components.contextSources },
    { label: 'Hooks', items: detail.components.hooks },
    { label: 'Decision Types', items: detail.components.decisionTypes },
    { label: 'Triggers', items: detail.components.triggers },
    { label: 'Agents', items: detail.components.agents },
  ].filter((s) => s.items.length > 0);

  return (
    <div css={css`
      margin-top: ${theme.spacing[4]};
      padding-top: ${theme.spacing[4]};
      border-top: 1px solid ${theme.colors.border.light};
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing[4]};
    `}>
      {/* Author & license */}
      {(detail.author || detail.license) && (
        <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[3]};`}>
          {detail.author && (
            <Typography.Caption as="span" color="hint">
              Author: {detail.author.name}
              {detail.author.url && (
                <a
                  href={detail.author.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  css={css`
                    margin-left: ${theme.spacing[1]};
                    color: ${theme.colors.text.secondary};
                    &:hover { color: ${theme.colors.text.primary}; }
                  `}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                  <ArrowSquareOut size={10} css={css`vertical-align: middle;`} />
                </a>
              )}
            </Typography.Caption>
          )}
          {detail.license && (
            <Typography.Caption as="span" color="hint">
              License: {detail.license}
            </Typography.Caption>
          )}
        </div>
      )}

      {/* Component lists */}
      {componentSections.length > 0 && (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {componentSections.map((section) => (
            <div key={section.label} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
              <Typography.Caption as="span" color="hint" css={css`
                font-weight: ${theme.typography.fontWeight.medium};
                text-transform: uppercase;
                letter-spacing: 0.06em;
              `}>
                {section.label}
              </Typography.Caption>
              <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[1.5]};`}>
                {section.items.map((item) => (
                  <Typography.SmallBody
                    key={item}
                    as="span"
                    css={css`
                      padding: ${theme.spacing[0.5]} ${theme.spacing[2]};
                      background: ${theme.colors.background.elevated};
                      border-radius: ${theme.borderRadius.sm};
                      font-size: ${theme.typography.fontSize.xs};
                    `}
                  >
                    {item}
                  </Typography.SmallBody>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div css={css`display: flex; gap: ${theme.spacing[2]}; flex-wrap: wrap;`}>
        {hasConfig && (
          <Button
            variant="secondary"
            size="sm"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onConfigure(); }}
          >
            <GearFine size={14} css={css`margin-right: ${theme.spacing[1]};`} />
            Configure
          </Button>
        )}
        {source !== 'built-in' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onUninstall(); }}
          >
            <Trash size={14} css={css`margin-right: ${theme.spacing[1]};`} />
            Uninstall
          </Button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Plugin Config Modal
// ============================================================================

function PluginConfigModal({
  pluginName,
  onClose,
  onSave,
  isSaving,
}: {
  pluginName: string;
  onClose: () => void;
  onSave: (config: Record<string, unknown>) => void;
  isSaving: boolean;
}) {
  const theme = useTheme();
  const { data: configData, isLoading: configLoading } = trpc.plugins.getConfig.useQuery({ name: pluginName });
  const { data: detail } = trpc.plugins.get.useQuery({ name: pluginName });

  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [rawJson, setRawJson] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Schema comes from the getConfig response
  const schema = configData?.schema;
  const hasSchema = schema && schema.fields.length > 0;

  // Initialize values from current config
  useEffect(() => {
    if (initialized) return;
    if (configData !== undefined) {
      const cfg = configData?.values ?? {};
      if (hasSchema) {
        setConfigValues(cfg as Record<string, unknown>);
      } else {
        setRawJson(JSON.stringify(cfg, null, 2));
      }
      setInitialized(true);
    }
  }, [configData, hasSchema, initialized]);

  const handleSave = () => {
    if (hasSchema) {
      onSave(configValues);
    } else {
      try {
        const parsed = JSON.parse(rawJson || '{}');
        setJsonError('');
        onSave(parsed);
      } catch {
        setJsonError('Invalid JSON');
      }
    }
  };

  const displayName = detail?.displayName ?? pluginName;

  // Map config field type to HTML input type
  const inputTypeForField = (fieldType: string) => {
    switch (fieldType) {
      case 'secret': return 'password';
      case 'url': return 'url';
      case 'number': return 'number';
      default: return 'text';
    }
  };

  return (
    <Modal open onClose={onClose}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Configure: {displayName}
        </Typography.Subtitle>

        {configLoading ? (
          <Typography.SmallBody color="hint">Loading configuration...</Typography.SmallBody>
        ) : hasSchema ? (
          // Schema-based form using typed fields
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
            {schema.fields.map((field: any) => {
              const value = configValues[field.key];
              const isMasked = field.type === 'secret' && value === '••••••••';

              if (field.type === 'toggle') {
                return (
                  <div key={field.key} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
                    <Toggle
                      checked={!!value}
                      onChange={(checked) => setConfigValues({ ...configValues, [field.key]: checked })}
                      label={field.label}
                    />
                    {field.helpText && (
                      <Typography.Caption as="p" color="hint">{field.helpText}</Typography.Caption>
                    )}
                  </div>
                );
              }

              if (field.type === 'secret') {
                return (
                  <div key={field.key}>
                    <Input
                      label={field.label}
                      type={showSecrets[field.key] ? 'text' : 'password'}
                      value={isMasked ? '' : (value != null ? String(value) : '')}
                      onChange={(e) => setConfigValues({ ...configValues, [field.key]: (e.target as HTMLInputElement).value })}
                      helperText={field.helpText}
                      placeholder={isMasked ? '••••••••  (saved, enter new value to change)' : (field.placeholder ?? (field.default != null ? String(field.default) : undefined))}
                      rightElement={
                        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[1.5]};`}>
                          <Tooltip content="Encrypted at rest and injected securely at runtime" position="top" align="right">
                            <ShieldCheck size={16} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
                          </Tooltip>
                          <button
                            type="button"
                            onClick={() => setShowSecrets({ ...showSecrets, [field.key]: !showSecrets[field.key] })}
                            css={css`cursor: pointer; padding: 0; color: ${theme.colors.text.hint}; &:hover { color: ${theme.colors.text.primary}; }`}
                          >
                            {showSecrets[field.key] ? <EyeSlash size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      }
                    />
                  </div>
                );
              }

              return (
                <div key={field.key}>
                  <Input
                    label={field.label}
                    type={inputTypeForField(field.type)}
                    value={value != null ? String(value) : ''}
                    onChange={(e) => setConfigValues({ ...configValues, [field.key]: (e.target as HTMLInputElement).value })}
                    helperText={field.helpText}
                    placeholder={field.placeholder ?? (field.default != null ? String(field.default) : undefined)}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          // Raw JSON editor
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
            <Typography.SmallBody color="secondary">
              This plugin does not define a config schema. Edit the raw JSON below.
            </Typography.SmallBody>
            <textarea
              value={rawJson}
              onChange={(e) => { setRawJson(e.target.value); setJsonError(''); }}
              rows={10}
              css={css`
                font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
                font-size: ${theme.typography.fontSize.sm};
                padding: ${theme.spacing[3]};
                border-radius: ${theme.borderRadius.default};
                border: 1px solid ${jsonError ? theme.colors.error.main : theme.colors.border.default};
                background: ${theme.colors.background.paper};
                color: ${theme.colors.text.primary};
                resize: vertical;
                width: 100%;
                box-sizing: border-box;

                &:focus {
                  outline: none;
                  border-color: ${jsonError ? theme.colors.error.main : theme.colors.border.focus};
                }
              `}
            />
            {jsonError && (
              <Typography.Caption color={theme.colors.error.main}>{jsonError}</Typography.Caption>
            )}
          </div>
        )}

        <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} loading={isSaving}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Section: System
// ============================================================================

function SystemSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: settings } = trpc.settings.getSystemSettings.useQuery();
  const { data: me } = trpc.auth.me.useQuery();
  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation({
    onSuccess: () => utils.settings.getSystemSettings.invalidate(),
  });

  const softResetMutation = trpc.data.softReset.useMutation();
  const fullResetMutation = trpc.data.fullReset.useMutation();
  const clearConvMutation = trpc.data.clearConversations.useMutation();
  const exportQuery = trpc.data.export.useQuery(undefined, { enabled: false });

  const [confirmAction, setConfirmAction] = useState<'soft' | 'full' | 'clear' | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const handleConfirmAction = () => {
    const onSuccess = () => setConfirmAction(null);
    if (confirmAction === 'soft') softResetMutation.mutate(undefined, { onSuccess });
    if (confirmAction === 'full') fullResetMutation.mutate(undefined, { onSuccess });
    if (confirmAction === 'clear') clearConvMutation.mutate(undefined, { onSuccess });
  };

  const handleExport = async () => {
    const result = await exportQuery.refetch();
    if (result.data) {
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `animus-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const confirmMessages = {
    soft: {
      title: 'Soft reset',
      description: 'This will clear all thoughts, emotions, goals, tasks, and decisions. Your Animus will lose its current inner state but retain memories and conversations. The heartbeat will be paused.',
    },
    full: {
      title: 'Full reset',
      description: 'This will clear all AI state including memories, conversations, goals, and tasks. Your Animus will be effectively reborn with the same personality but no accumulated knowledge. This cannot be undone.',
    },
    clear: {
      title: 'Clear conversations',
      description: 'This will delete all message history and media across all contacts and channels. This cannot be undone.',
    },
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[8]};`}>
      {/* Data Management */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Data Management
        </Typography.Subtitle>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          <div>
            <button
              onClick={() => setConfirmAction('soft')}
              css={css`
                font-size: ${theme.typography.fontSize.sm};
                color: ${theme.colors.error.main};
                cursor: pointer;
                padding: 0;
                text-decoration: underline;
                text-underline-offset: 3px;
                &:hover { opacity: 0.8; }
              `}
            >
              Soft reset
            </button>
            <Typography.Caption as="p" color="hint" css={css`margin-top: ${theme.spacing[0.5]};`}>
              Clear thoughts, emotions, goals, and tasks. Preserve memories and conversations.
            </Typography.Caption>
          </div>
          <div>
            <button
              onClick={() => setConfirmAction('full')}
              css={css`
                font-size: ${theme.typography.fontSize.sm};
                color: ${theme.colors.error.main};
                cursor: pointer;
                padding: 0;
                text-decoration: underline;
                text-underline-offset: 3px;
                &:hover { opacity: 0.8; }
              `}
            >
              Full reset
            </button>
            <Typography.Caption as="p" color="hint" css={css`margin-top: ${theme.spacing[0.5]};`}>
              Clear all AI state including memories and conversations.
            </Typography.Caption>
          </div>
          <div>
            <button
              onClick={() => setConfirmAction('clear')}
              css={css`
                font-size: ${theme.typography.fontSize.sm};
                color: ${theme.colors.error.main};
                cursor: pointer;
                padding: 0;
                text-decoration: underline;
                text-underline-offset: 3px;
                &:hover { opacity: 0.8; }
              `}
            >
              Clear conversations
            </button>
            <Typography.Caption as="p" color="hint" css={css`margin-top: ${theme.spacing[0.5]};`}>
              Delete all message history and media across all contacts and channels.
            </Typography.Caption>
          </div>
          <div>
            <button
              onClick={handleExport}
              css={css`
                font-size: ${theme.typography.fontSize.sm};
                color: ${theme.colors.text.primary};
                cursor: pointer;
                padding: 0;
                text-decoration: underline;
                text-underline-offset: 3px;
                &:hover { opacity: 0.8; }
              `}
            >
              Export data
            </button>
            <Typography.Caption as="p" color="hint" css={css`margin-top: ${theme.spacing[0.5]};`}>
              Download all databases as a backup file.
            </Typography.Caption>
          </div>
        </div>
      </div>

      {/* Account */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Account
        </Typography.Subtitle>
        <Typography.SmallBody as="div" color="secondary">
          {me?.email ?? 'Loading...'}
        </Typography.SmallBody>
        {!showPasswordForm ? (
          <button
            onClick={() => setShowPasswordForm(true)}
            css={css`
              font-size: ${theme.typography.fontSize.sm};
              color: ${theme.colors.text.primary};
              cursor: pointer;
              padding: 0;
              text-decoration: underline;
              text-underline-offset: 3px;
              text-align: left;
              &:hover { opacity: 0.8; }
            `}
          >
            Change password
          </button>
        ) : (
          <PasswordChangeForm onClose={() => setShowPasswordForm(false)} />
        )}
      </div>

      {/* Reset confirmation modal */}
      <Modal open={confirmAction !== null} onClose={() => setConfirmAction(null)}>
        {confirmAction && (
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
              <Warning size={20} css={css`color: ${theme.colors.error.main};`} />
              <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
                {confirmMessages[confirmAction].title}
              </Typography.Subtitle>
            </div>
            <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
              {confirmMessages[confirmAction].description}
            </Typography.SmallBody>
            <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
              <Button variant="ghost" size="sm" onClick={() => setConfirmAction(null)}>Cancel</Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmAction}
                loading={softResetMutation.isPending || fullResetMutation.isPending || clearConvMutation.isPending}
              >
                Confirm
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Success/error banners */}
      <AnimatePresence>
        {(softResetMutation.isSuccess || fullResetMutation.isSuccess || clearConvMutation.isSuccess) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            css={css`
              padding: ${theme.spacing[3]} ${theme.spacing[4]};
              background: ${theme.colors.success.main}1a;
              border-radius: ${theme.borderRadius.default};
            `}
          >
            <Typography.SmallBody color={theme.colors.success.main}>
              Operation completed successfully.
            </Typography.SmallBody>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Password Change Form (inline)
// ============================================================================

function PasswordChangeForm({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  // Note: password change is a UI stub for now -- the backend auth router
  // doesn't expose a change-password mutation yet. We'll show the form
  // structure and call the appropriate route when it's available.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    // TODO: Wire to auth.changePassword mutation when available
    setError('Password change not yet implemented in backend');
  };

  return (
    <div css={css`
      display: flex; flex-direction: column; gap: ${theme.spacing[3]};
      padding: ${theme.spacing[4]};
      border: 1px solid ${theme.colors.border.default};
      border-radius: ${theme.borderRadius.md};
    `}>
      <Input
        type="password"
        label="Current password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword((e.target as HTMLInputElement).value)}
      />
      <Input
        type="password"
        label="New password"
        value={newPassword}
        onChange={(e) => setNewPassword((e.target as HTMLInputElement).value)}
      />
      <Input
        type="password"
        label="Confirm new password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
        error={error || undefined}
      />
      <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
        <Button size="sm" onClick={handleSubmit}>Save password</Button>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

// ============================================================================
// Settings Page (main export)
// ============================================================================

export function SettingsPage() {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  // Determine active section from URL
  const activeSection: SettingsSection = useMemo(() => {
    const path = location.pathname.replace('/settings/', '').replace('/settings', '');
    const match = sections.find((s) => s.id === path);
    return match ? match.id : 'heartbeat';
  }, [location.pathname]);

  // Redirect bare /settings to /settings/heartbeat
  useEffect(() => {
    if (location.pathname === '/settings' || location.pathname === '/settings/') {
      navigate('/settings/heartbeat', { replace: true });
    }
  }, [location.pathname, navigate]);

  const handleSectionChange = (section: SettingsSection) => {
    navigate(`/settings/${section}`);
  };

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mobileMenuOpen]);

  const renderSection = () => {
    switch (activeSection) {
      case 'heartbeat': return <HeartbeatSection />;
      case 'provider': return <ProviderSection />;
      case 'channels': return <ChannelsSection />;
      case 'plugins': return <PluginsSection />;
      case 'goals': return <GoalsSection />;
      case 'saves': return <SavesSection />;
      case 'system': return <SystemSection />;
      default: return <HeartbeatSection />;
    }
  };

  return (
    <div css={css`
      display: flex;
      min-height: 100vh;
      padding-top: ${theme.spacing[6]};

      @media (max-width: ${theme.breakpoints.md}) {
        flex-direction: column;
        padding-top: 0;
      }
    `}>
      {/* Desktop Sidebar — reserves flex space; inner content is fixed full-height */}
      <nav css={css`
        width: 220px;
        flex-shrink: 0;

        @media (max-width: ${theme.breakpoints.lg}) {
          width: 180px;
        }

        @media (max-width: ${theme.breakpoints.md}) {
          display: none;
        }
      `}>
        <div css={css`
          position: fixed;
          top: 0;
          bottom: 0;
          width: 220px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: ${theme.spacing[2]};
          border-right: 1px solid ${theme.colors.border.light};
          padding: ${theme.spacing[4]} ${theme.spacing[6]};

          @media (max-width: ${theme.breakpoints.lg}) {
            width: 180px;
          }
        `}>
          {sections.map((section) => {
            const isActive = section.id === activeSection;
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => handleSectionChange(section.id)}
                css={css`
                  display: flex;
                  align-items: center;
                  gap: ${theme.spacing[2]};
                  padding: ${theme.spacing[1.5]} ${theme.spacing[2]};
                  border-radius: ${theme.borderRadius.sm};
                  cursor: pointer;
                  transition: all ${theme.transitions.micro};
                  position: relative;
                  font-size: ${theme.typography.fontSize.sm};
                  font-weight: ${isActive ? theme.typography.fontWeight.semibold : theme.typography.fontWeight.normal};
                  color: ${isActive ? theme.colors.text.primary : theme.colors.text.secondary};

                  &:hover {
                    color: ${theme.colors.text.primary};
                    opacity: 0.75;
                  }
                `}
              >
                {isActive && (
                  <motion.div
                    layoutId="settings-sidebar-dot"
                    css={css`
                      position: absolute;
                      left: -${theme.spacing[2]};
                      width: 4px;
                      height: 4px;
                      border-radius: 50%;
                      background: ${theme.colors.accent};
                    `}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                )}
                <Icon
                  size={14}
                  css={css`
                    opacity: ${isActive ? 1 : 0.55};
                    flex-shrink: 0;
                  `}
                />
                {section.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile hamburger menu */}
      <div
        ref={menuRef}
        css={css`
          display: none;

          @media (max-width: ${theme.breakpoints.md}) {
            display: block;
            position: fixed;
            top: ${theme.spacing[3]};
            left: ${theme.spacing[3]};
            z-index: ${theme.zIndex.fixed};
          }
        `}
      >
        <button
          onClick={() => setMobileMenuOpen((o) => !o)}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          css={css`
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            border-radius: ${theme.borderRadius.full};
            background: ${theme.mode === 'light'
              ? 'rgba(250, 249, 244, 0.85)'
              : 'rgba(28, 26, 24, 0.85)'};
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid ${theme.colors.border.light};
            color: ${theme.colors.text.primary};
            cursor: pointer;
          `}
        >
          {mobileMenuOpen ? <X size={18} /> : <List size={18} />}
        </button>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              css={css`
                position: absolute;
                top: calc(100% + ${theme.spacing[2]});
                left: 0;
                display: flex;
                flex-direction: column;
                gap: ${theme.spacing[1]};
                padding: ${theme.spacing[2]};
                border-radius: ${theme.borderRadius.md};
                background: ${theme.mode === 'light'
                  ? 'rgba(250, 249, 244, 0.95)'
                  : 'rgba(28, 26, 24, 0.95)'};
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid ${theme.colors.border.light};
                min-width: 180px;
              `}
            >
              {sections.map((section) => {
                const isActive = section.id === activeSection;
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    onClick={() => {
                      handleSectionChange(section.id);
                      setMobileMenuOpen(false);
                    }}
                    css={css`
                      display: flex;
                      align-items: center;
                      gap: ${theme.spacing[2]};
                      padding: ${theme.spacing[2]} ${theme.spacing[3]};
                      border-radius: ${theme.borderRadius.sm};
                      font-size: ${theme.typography.fontSize.sm};
                      font-weight: ${isActive ? theme.typography.fontWeight.semibold : theme.typography.fontWeight.normal};
                      color: ${isActive ? theme.colors.text.primary : theme.colors.text.secondary};
                      cursor: pointer;
                      transition: all ${theme.transitions.micro};

                      &:hover {
                        color: ${theme.colors.text.primary};
                        background: ${theme.colors.background.elevated};
                      }
                    `}
                  >
                    <Icon size={14} css={css`opacity: ${isActive ? 1 : 0.55}; flex-shrink: 0;`} />
                    {section.label}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <main css={css`
        flex: 1;
        max-width: 640px;
        margin: 0 auto;
        padding: 0 ${theme.spacing[6]} ${theme.spacing[16]};

        @media (max-width: ${theme.breakpoints.md}) {
          max-width: 100%;
          padding: ${theme.spacing[4]} ${theme.spacing[4]} ${theme.spacing[16]};
        }
      `}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {renderSection()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Right spacer to balance sidebar — keeps content truly centered */}
      <div css={css`
        width: 220px;
        flex-shrink: 0;

        @media (max-width: ${theme.breakpoints.lg}) {
          width: 180px;
        }

        @media (max-width: ${theme.breakpoints.md}) {
          display: none;
        }
      `} />
    </div>
  );
}
