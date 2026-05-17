/** @jsxImportSource @emotion/react */
import { css, useTheme, keyframes } from '@emotion/react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Heartbeat as HeartbeatIcon,
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
  ArrowSquareOut,
  Trash,
  List,
  X,
  PuzzlePiece,
  Plus,
  GearFine,
  FolderOpen,
  ArrowClockwise,
  Plugs,
  FloppyDisk,
  CaretRight,
  CaretDown,
  Wrench,
  SignOut,
  Key,
  Brain,
  ChartBar,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { Card, SelectionCard, Button, Input, Select, Modal, Badge, Toggle, Slider, Typography, Tooltip } from '../components/ui';
import { trpc } from '../utils/trpc';
import { isTauri } from '../utils/tauri';
import { useAutostart } from '../hooks/useAutostart';
import { useAutoUpdate } from '../hooks/useAutoUpdate';
import type { Theme } from '../styles/theme';
import { SavesSection } from '../components/settings/SavesSection';
import { ToolsSection } from '../components/settings/ToolsSection';
import { PackageConsentDialog } from '../components/settings/PackageConsentDialog';
import { Upload, ArrowCounterClockwise, ArrowsClockwise } from '@phosphor-icons/react';
import { AnpkDropZone } from '../components/settings/AnpkDropZone';
import { buildOAuthCards } from '../utils/provider-display';
import { AboutInline } from '../components/settings/AboutSection';
import { TelemetryInline } from '../components/settings/TelemetrySection';
import { PasswordsSection } from '../components/settings/PasswordsSection';
import { UsagePage } from './UsagePage';
import { toast } from '../store/toast-store';
import { useHeartbeatStore } from '../store/heartbeat-store';
import DOMPurify from 'dompurify';

// ============================================================================
// Types
// ============================================================================

type SettingsSection = 'heartbeat' | 'cortex_provider' | 'usage' | 'channels' | 'plugins' | 'passwords' | 'tools' | 'goals' | 'saves' | 'system';

interface SidebarItem {
  id: SettingsSection;
  label: string;
  icon: PhosphorIcon;
}

const sections: SidebarItem[] = [
  { id: 'heartbeat', label: 'Heartbeat', icon: HeartbeatIcon },
  { id: 'cortex_provider', label: 'AI Provider', icon: Brain },
  { id: 'usage', label: 'Usage', icon: ChartBar },
  { id: 'channels', label: 'Channels', icon: ChatCircle },
  { id: 'plugins', label: 'Plugins', icon: PuzzlePiece },
  { id: 'passwords', label: 'Passwords', icon: Key },
  { id: 'tools', label: 'Tools', icon: Wrench },
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

  const utils = trpc.useUtils();

  const { data: hbState } = trpc.heartbeat.getState.useQuery(undefined, {
    refetchInterval: 10000,
  });
  const { data: systemSettings } = trpc.settings.getSystemSettings.useQuery();

  const startMutation = trpc.heartbeat.start.useMutation({
    onSuccess: () => utils.heartbeat.getState.invalidate(),
  });
  const stopMutation = trpc.heartbeat.stop.useMutation({
    onSuccess: () => utils.heartbeat.getState.invalidate(),
  });
  const updateIntervalMutation = trpc.heartbeat.updateInterval.useMutation();
  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation();

  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const intervalSave = useSaveFlash();

  const isRunning = hbState?.isRunning ?? false;

  // Clear resuming state once the heartbeat is confirmed running
  useEffect(() => {
    if (isRunning && isResuming) setIsResuming(false);
  }, [isRunning, isResuming]);
  const tickNumber = hbState?.tickNumber ?? 0;
  const currentStage = hbState?.currentStage ?? 'idle';
  const lastTickAt = hbState?.lastTickAt ?? null;

  // Local state for immediate slider feedback (avoids waiting for API round-trip)
  const [localIntervalMs, setLocalIntervalMs] = useState<number | null>(null);
  const intervalMs = localIntervalMs ?? systemSettings?.heartbeatIntervalMs ?? 300000;

  // Sync local state when server data arrives (and local isn't overriding)
  useEffect(() => {
    if (systemSettings && localIntervalMs === null) setLocalIntervalMs(null);
  }, [systemSettings?.heartbeatIntervalMs]);
  // Debounced API persistence
  const intervalTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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

  const formatCountdown = (ts: string | null) => {
    if (!ts) return null;
    const diff = new Date(ts).getTime() - Date.now();
    if (diff <= 0) return 'Any moment';
    const secs = Math.ceil(diff / 1000);
    const mins = Math.floor(secs / 60);
    const remainSecs = secs % 60;
    if (mins === 0) return `${remainSecs}s`;
    return `${mins}m ${remainSecs.toString().padStart(2, '0')}s`;
  };

  // Re-render every second for the countdown
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isRunning || !hbState?.nextTickAt) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [isRunning, hbState?.nextTickAt]);

  const handleIntervalChange = (mins: number) => {
    const ms = mins * 60000;
    setLocalIntervalMs(ms);
    clearTimeout(intervalTimerRef.current);
    intervalTimerRef.current = setTimeout(() => {
      updateIntervalMutation.mutate({ intervalMs: ms }, { onSuccess: () => intervalSave.flash() });
      updateSettingsMutation.mutate({ heartbeatIntervalMs: ms });
    }, 300);
  };

  const handlePause = () => {
    stopMutation.mutate();
    setShowPauseConfirm(false);
  };

  const handleResume = () => {
    setIsResuming(true);
    startMutation.mutate(undefined, {
      onError: () => setIsResuming(false),
    });
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
              background: ${isRunning ? theme.colors.success.main : isResuming ? theme.colors.info.main : theme.colors.warning.main};
              ${isResuming && !isRunning ? `animation: pulse 1.5s ease-in-out infinite;` : ''}
              @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.4; }
              }
            `} />
            <Typography.SmallBodyAlt as="span">
              {isRunning ? 'Running' : isResuming ? 'Starting...' : 'Paused'}
            </Typography.SmallBodyAlt>
          </div>
          <Typography.SmallBody as="div" color="secondary">
            Tick #{tickNumber.toLocaleString()}
          </Typography.SmallBody>
          <Typography.SmallBody as="div" color="secondary">
            Last tick: {formatAgo(lastTickAt)}
          </Typography.SmallBody>
          {isRunning && currentStage === 'idle' && hbState?.nextTickAt && (
            <Typography.SmallBody as="div" color="secondary">
              Next tick: {formatCountdown(hbState.nextTickAt)}
            </Typography.SmallBody>
          )}
          {isRunning && currentStage !== 'idle' && (
            <Typography.SmallBody as="div" color="secondary">
              Currently: {currentStage === 'gather' ? 'Gathering context' : currentStage === 'mind' ? 'Thinking' : currentStage === 'execute' ? 'Executing' : currentStage}
            </Typography.SmallBody>
          )}
        </div>

        {!isRunning && (
          <div css={css`
            padding: ${theme.spacing[3]} ${theme.spacing[4]};
            background: ${isResuming ? theme.colors.info.main : theme.colors.warning.main}1a;
            border-radius: ${theme.borderRadius.default};
          `}>
            <Typography.SmallBody color={isResuming ? theme.colors.info.dark : theme.colors.warning.dark}>
              {isResuming
                ? 'Starting heartbeat. Waiting for first tick...'
                : 'Heartbeat is paused. Your Animus is not thinking.'}
            </Typography.SmallBody>
          </div>
        )}

        <div>
          {isRunning ? (
            <Button variant="secondary" size="sm" onClick={() => setShowPauseConfirm(true)}>
              Pause heartbeat
            </Button>
          ) : (
            <Button size="sm" onClick={handleResume} loading={isResuming || startMutation.isPending} disabled={isResuming}>
              {isResuming ? 'Starting...' : 'Resume heartbeat'}
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
                <Select
                  value={String(sleepStartHour)}
                  onChange={(v) => handleSleepStartChange(parseInt(v, 10))}
                  maxWidth="160px"
                  options={hours.map((h) => ({ value: String(h), label: formatHour(h) }))}
                />
              </div>

              {/* Sleep End Hour */}
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
                  <Typography.SmallBody as="label" color="secondary">
                    Wake up at
                  </Typography.SmallBody>
                  <SaveIndicator show={sleepEndSave.show} />
                </div>
                <Select
                  value={String(sleepEndHour)}
                  onChange={(v) => handleSleepEndChange(parseInt(v, 10))}
                  maxWidth="160px"
                  options={hours.map((h) => ({ value: String(h), label: formatHour(h) }))}
                />
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
// Section: AI Provider (Cortex)
// ============================================================================

// ── Helpers for Cortex Provider Section ──

/** Format a time-until-expiry string from a Unix timestamp (ms). */
/** Three breathing dots animation for OAuth waiting states. */
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

function CortexProviderSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: statusData, isLoading: statusLoading } = trpc.cortexProvider.getStatus.useQuery();
  const { data: allProviders } = trpc.cortexProvider.listConfiguredProviders.useQuery();

  const removeCredentialMutation = trpc.cortexProvider.removeCredential.useMutation({
    onSuccess: () => {
      utils.cortexProvider.getStatus.invalidate();
      utils.cortexProvider.listConfiguredProviders.invalidate();
    },
  });

  const setThinkingMutation = trpc.cortexProvider.setThinkingLevel.useMutation({
    onSuccess: () => utils.cortexProvider.getStatus.invalidate(),
  });

  const setActiveMutation = trpc.cortexProvider.setActiveProvider.useMutation({
    onSuccess: () => {
      utils.cortexProvider.getStatus.invalidate();
      utils.cortexProvider.listConfiguredProviders.invalidate();
    },
  });

  // OAuth flow mutations (for Reconnect)
  const initiateOAuthMutation = trpc.cortexProvider.initiateOAuth.useMutation();
  const cancelOAuthMutation = trpc.cortexProvider.cancelOAuth.useMutation();

  const thinkingSave = useSaveFlash();
  const modelSave = useSaveFlash();
  const utilityModelSave = useSaveFlash();
  const contextLimitSave = useSaveFlash();

  // Context window limit slider state
  const setContextLimitMutation = trpc.cortexProvider.setContextWindowLimit.useMutation({
    onSuccess: () => {
      contextLimitSave.flash();
      utils.cortexProvider.getStatus.invalidate();
    },
  });
  const [localContextLimit, setLocalContextLimit] = useState<number | null | 'unset'>('unset');
  const contextLimitTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Utility model
  const { data: systemSettings } = trpc.settings.getSystemSettings.useQuery();
  const setUtilityModelMutation = trpc.cortexProvider.setUtilityModel.useMutation({
    onSuccess: () => utils.settings.getSystemSettings.invalidate(),
  });

  // Model list for the active provider
  const activeProvider = statusData?.provider ?? null;
  const { data: models } = trpc.cortexProvider.listModels.useQuery(
    { provider: activeProvider! },
    { enabled: !!activeProvider }
  );

  // The model Cortex programmatically recommends as the utility model for
  // the active provider (used to label the "Recommended" option).
  const { data: recommendedUtility } = trpc.cortexProvider.getRecommendedUtilityModel.useQuery(
    { provider: activeProvider! },
    { enabled: !!activeProvider }
  );


  const [switchModalOpen, setSwitchModalOpen] = useState(false);

  // Reconnect OAuth state
  const [reconnectState, setReconnectState] = useState<'idle' | 'authenticating'>('idle');
  const [reconnectError, setReconnectError] = useState<string | null>(null);

  // Subscribe to OAuth status when reconnecting
  trpc.cortexProvider.oauthStatus.useSubscription(undefined, {
    enabled: reconnectState === 'authenticating',
    onData: (event) => {
      if (event.type === 'success') {
        setReconnectState('idle');
        setReconnectError(null);
        utils.cortexProvider.getStatus.invalidate();
        utils.cortexProvider.listConfiguredProviders.invalidate();
        // Dismiss any auth errors from the store
        const errors = useHeartbeatStore.getState().systemErrors;
        errors
          .filter((e) => e.category === 'authentication')
          .forEach((e) => useHeartbeatStore.getState().dismissSystemError(e.id));
      } else if (event.type === 'error') {
        setReconnectState('idle');
        setReconnectError(event.message);
      }
    },
  });

  // System errors from the heartbeat store (auth failures)
  // Use a stable selector to avoid infinite re-renders from filter creating new arrays
  const systemErrors = useHeartbeatStore((s) => s.systemErrors);
  const authErrors = useMemo(
    () => systemErrors.filter((e) => e.category === 'authentication'),
    [systemErrors]
  );
  const hasAuthFailure = authErrors.length > 0;
  const latestAuthError = authErrors[authErrors.length - 1] ?? null;

  const isConnected = statusData?.connected ?? false;
  const providerName = allProviders?.find(p => p.id === activeProvider)?.name ?? activeProvider ?? '';

  // Determine which card state to show:
  // - If we have auth errors AND we were previously connected, show disconnected state
  // - If connected normally, show connected state
  // - If not connected (no provider configured), show not-connected state
  const showDisconnected = hasAuthFailure && activeProvider;
  const showConnected = isConnected && !showDisconnected;
  const showNotConnected = !isConnected && !showDisconnected;

  const meta = statusData?.meta as Record<string, unknown> | null;
  const method = statusData?.method;

  const handleModelChange = (modelId: string) => {
    if (!activeProvider) return;
    // Reset context limit slider so it reflects the new model's server value
    setLocalContextLimit('unset');
    clearTimeout(contextLimitTimerRef.current);
    setActiveMutation.mutate(
      { provider: activeProvider, model: modelId },
      {
        onSuccess: () => {
          modelSave.flash();
          // When primary model (and thus provider) changes, reset utility model to recommended
          setUtilityModelMutation.mutate({ model: 'default' });
        },
      }
    );
  };

  const handleUtilityModelChange = (value: string) => {
    setUtilityModelMutation.mutate(
      { model: value },
      { onSuccess: () => utilityModelSave.flash() }
    );
  };

  const handleThinkingChange = (level: string) => {
    setThinkingMutation.mutate(
      { level: level as 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'max' },
      { onSuccess: () => thinkingSave.flash() }
    );
  };

  const activeModelData = models?.find(m => m.id === statusData?.model);
  const modelContextWindow = activeModelData?.contextWindow ?? 200_000;
  const MINIMUM_CONTEXT_WINDOW = 16_384;
  const DEFAULT_CONTEXT_WINDOW_LIMIT = 100_000;

  // Resolve the effective slider value:
  //   local override > server value > default (min(100K, model max))
  // Always clamp to [MINIMUM_CONTEXT_WINDOW, modelContextWindow] so the slider
  // stays in range when switching from a larger to a smaller model.
  const serverContextLimit = statusData?.contextWindowLimit as number | null | undefined;
  const defaultLimit = Math.min(DEFAULT_CONTEXT_WINDOW_LIMIT, modelContextWindow);
  const rawContextLimit =
    localContextLimit !== 'unset' ? localContextLimit
    : serverContextLimit != null ? serverContextLimit
    : defaultLimit;
  const sliderValue = Math.max(MINIMUM_CONTEXT_WINDOW, Math.min(rawContextLimit ?? defaultLimit, modelContextWindow));
  const contextPercentage = Math.round((sliderValue / modelContextWindow) * 100);

  const handleContextLimitChange = (tokens: number) => {
    // Store the exact token value; the backend/cortex handle clamping
    setLocalContextLimit(tokens);
    clearTimeout(contextLimitTimerRef.current);
    contextLimitTimerRef.current = setTimeout(() => {
      setContextLimitMutation.mutate({ limit: tokens });
    }, 300);
  };

  const formatContextTokens = (tokens: number) => {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    return `${Math.round(tokens / 1000)}K`;
  };

  const handleReconnect = useCallback(() => {
    if (!activeProvider) return;
    setReconnectError(null);
    setReconnectState('authenticating');
    initiateOAuthMutation.mutate(
      { provider: activeProvider },
      {
        onError: (err) => {
          setReconnectState('idle');
          setReconnectError(err.message || 'Sign-in failed.');
        },
      }
    );
  }, [activeProvider, initiateOAuthMutation]);

  const handleCancelReconnect = useCallback(() => {
    cancelOAuthMutation.mutate();
    setReconnectState('idle');
  }, [cancelOAuthMutation]);

  const handleSwitchModalClose = useCallback(() => {
    setSwitchModalOpen(false);
    // Refresh status after modal closes (user may have connected a new provider)
    utils.cortexProvider.getStatus.invalidate();
    utils.cortexProvider.listConfiguredProviders.invalidate();
  }, [utils.cortexProvider.getStatus, utils.cortexProvider.listConfiguredProviders]);

  if (statusLoading) {
    return (
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <Typography.Title3 as="h2">AI Provider</Typography.Title3>
        <Typography.Caption color="hint">Loading...</Typography.Caption>
      </div>
    );
  }

  const connectionLabel = method === 'oauth'
    ? (meta?.['displayName'] ? String(meta['displayName']) : 'Signed in')
    : method === 'api_key' ? 'API key'
    : method === 'env_var' ? 'Environment variable'
    : method === 'custom' ? (meta?.['baseUrl'] ? String(meta['baseUrl']) : 'Custom endpoint')
    : '';

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <Typography.Title3 as="h2">AI Provider</Typography.Title3>

      {/* ── Disconnected / Auth Failure State ── */}
      {showDisconnected && (
        <Card css={css`
          padding: ${theme.spacing[5]};
          border: 1px solid ${theme.colors.warning.main}33;
          background: ${theme.colors.warning.main}08;
          &::before { background: linear-gradient(180deg, ${theme.colors.warning.main}18 0%, transparent 100%); }
        `}>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
              <Warning size={20} weight="fill" css={css`color: ${theme.colors.warning.main}; flex-shrink: 0;`} />
              <div>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                  <Typography.SmallBodyAlt>{providerName}</Typography.SmallBodyAlt>
                  <Badge variant="warning">Disconnected</Badge>
                </div>
                <Typography.Caption color="hint" css={css`margin-top: ${theme.spacing[0.5]};`}>
                  {latestAuthError?.message
                    ? latestAuthError.message.length > 120
                      ? `${latestAuthError.message.slice(0, 120)}...`
                      : latestAuthError.message
                    : method === 'api_key'
                      ? 'API key is invalid or has been revoked.'
                      : 'Authentication expired or revoked.'}
                </Typography.Caption>
              </div>
            </div>

            {reconnectState === 'authenticating' ? (
              <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
                <BreathingDots color={theme.colors.warning.main} />
                <Typography.Caption color="secondary">Waiting for authorization...</Typography.Caption>
                <Button variant="ghost" size="sm" onClick={handleCancelReconnect}>Cancel</Button>
              </div>
            ) : (
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                {reconnectError && (
                  <Typography.Caption css={css`color: ${theme.colors.error.main};`}>
                    {reconnectError}
                  </Typography.Caption>
                )}
                <div css={css`display: flex; gap: ${theme.spacing[2]}; flex-wrap: wrap;`}>
                  {method === 'oauth' && (
                    <Button variant="primary" size="sm" onClick={handleReconnect} loading={initiateOAuthMutation.isPending}>
                      <ArrowsClockwise size={14} css={css`margin-right: ${theme.spacing[1]};`} />
                      Reconnect
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => setSwitchModalOpen(true)}>Switch Provider</Button>
                </div>
              </div>
            )}

            {latestAuthError?.suggestedAction && (
              <Typography.Tiny color="hint">{latestAuthError.suggestedAction}</Typography.Tiny>
            )}
          </div>
        </Card>
      )}

      {/* ── Connected State ── */}
      {showConnected && (
        <>
          {/* Connection status */}
          <Card css={css`padding: ${theme.spacing[4]} ${theme.spacing[5]};`}>
            <div css={css`display: flex; align-items: center; justify-content: space-between; min-height: 32px;`}>
              <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                <div css={css`
                  width: 8px; height: 8px; border-radius: ${theme.borderRadius.full};
                  background: ${theme.colors.success.main};
                  box-shadow: 0 0 6px ${theme.colors.success.main}66;
                  flex-shrink: 0;
                `} />
                <Typography.SmallBodyAlt>{providerName}</Typography.SmallBodyAlt>
                {connectionLabel && (
                  <>
                    <span css={css`color: ${theme.colors.text.disabled}; font-size: ${theme.typography.fontSize.xs};`}>/</span>
                    <Typography.Caption color="hint">{connectionLabel}</Typography.Caption>
                  </>
                )}
              </div>
              <div css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                <Button variant="secondary" size="sm" onClick={() => setSwitchModalOpen(true)}>
                  Switch Provider
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCredentialMutation.mutate({ provider: activeProvider! })}
                  loading={removeCredentialMutation.isPending}
                  css={css`color: ${theme.colors.text.hint}; &:hover { color: ${theme.colors.error.main}; }`}
                >
                  <SignOut size={14} />
                </Button>
              </div>
            </div>
          </Card>

          {/* Model configuration */}
          {models && models.length > 0 && (
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                  <Typography.SmallBodyAlt>Model</Typography.SmallBodyAlt>
                  <SaveIndicator show={modelSave.show} />
                </div>
                <Select
                  value={statusData?.model ?? ''}
                  onChange={(value) => handleModelChange(value)}
                  options={models.map((m) => ({
                    value: m.id,
                    label: `${m.name} (${Math.round(m.contextWindow / 1000)}K context)`,
                  }))}
                />
              </div>

              {/* Thinking level */}
              {(() => {
                const activeModelForThinking = models?.find(m => m.id === statusData?.model);
                if (!activeModelForThinking?.supportsThinking) return null;

                const allLevels: Array<{ value: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'max'; label: string }> = [
                  { value: 'off', label: 'Off' },
                  { value: 'minimal', label: 'Minimal' },
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                  { value: 'max', label: 'Max' },
                ];
                const supported = activeModelForThinking.supportedThinkingLevels;
                const thinkingOptions = supported?.length
                  ? allLevels.filter(l => supported.includes(l.value))
                  : allLevels;

                return (
                  <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
                    <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                      <Typography.SmallBodyAlt>Thinking Level</Typography.SmallBodyAlt>
                      <SaveIndicator show={thinkingSave.show} />
                    </div>
                    <Select
                      value={statusData?.thinkingLevel ?? 'high'}
                      onChange={(value) => handleThinkingChange(value)}
                      maxWidth="200px"
                      options={thinkingOptions}
                    />
                    <Typography.Caption color="hint">
                      Controls how much the model reasons before responding. Higher levels use more tokens.
                    </Typography.Caption>
                  </div>
                );
              })()}

              {/* Context window limit */}
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                  <Typography.SmallBodyAlt>Context Usage</Typography.SmallBodyAlt>
                  <SaveIndicator show={contextLimitSave.show} />
                </div>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[4]};`}>
                  <div css={css`flex: 1;`}>
                    <Slider
                      value={sliderValue}
                      onChange={handleContextLimitChange}
                      min={MINIMUM_CONTEXT_WINDOW}
                      max={modelContextWindow}
                      step={1000}
                      leftLabel={formatContextTokens(MINIMUM_CONTEXT_WINDOW)}
                      rightLabel={formatContextTokens(modelContextWindow)}
                      showNeutral={false}
                    />
                  </div>
                  <Typography.SmallBodyAlt as="span" css={css`white-space: nowrap; min-width: 110px;`}>
                    {`${contextPercentage}% · ${formatContextTokens(sliderValue)}`}
                  </Typography.SmallBodyAlt>
                </div>
                <Typography.Caption as="p" color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
                  Limits how much of the model's context window is used. Lower values trigger compaction sooner, reducing token costs. Default is {formatContextTokens(defaultLimit)}.
                </Typography.Caption>
              </div>

              {/* Utility model */}
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                  <Typography.SmallBodyAlt>Utility Model</Typography.SmallBodyAlt>
                  <SaveIndicator show={utilityModelSave.show} />
                </div>
                <Select
                  value={systemSettings?.utilityModel ?? 'default'}
                  onChange={(value) => handleUtilityModelChange(value)}
                  options={[
                    {
                      value: 'default',
                      label: recommendedUtility?.modelName
                        ? `Recommended (${recommendedUtility.modelName})`
                        : 'Recommended',
                    },
                    ...[...models]
                      .sort((a, b) => (a.pricing?.input ?? Infinity) - (b.pricing?.input ?? Infinity))
                      .map((m) => ({
                        value: m.id,
                        label: `${m.name}${m.pricing ? ` ($${m.pricing.input.toFixed(2)}/$${m.pricing.output.toFixed(2)} per 1M)` : ''}`,
                      })),
                  ]}
                />
                <Typography.Caption color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
                  A smaller model used for internal operations like web page summarization and safety checks. Recommended automatically picks the best fast model for your provider. Does not affect the quality of the agent's main responses.
                </Typography.Caption>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Not Connected State ── */}
      {showNotConnected && (
        <Card css={css`padding: ${theme.spacing[8]} ${theme.spacing[5]};`}>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]}; align-items: center; text-align: center;`}>
            <Typography.Body color="secondary">No AI provider configured</Typography.Body>
            <Typography.Caption color="hint">
              Connect a provider to start using Animus.
            </Typography.Caption>
            <Button variant="primary" size="sm" onClick={() => setSwitchModalOpen(true)}>
              Set Up Provider
            </Button>
          </div>
        </Card>
      )}

      {/* ── Switch Provider Modal ── */}
      <Modal open={switchModalOpen} onClose={handleSwitchModalClose} maxWidth="560px">
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
          <div css={css`display: flex; align-items: center; justify-content: space-between;`}>
            <Typography.Title3 as="h2" css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
              Switch Provider
            </Typography.Title3>
            <button
              onClick={handleSwitchModalClose}
              css={css`
                display: flex; align-items: center; justify-content: center;
                width: 28px; height: 28px; border-radius: ${theme.borderRadius.sm};
                background: none; border: none; cursor: pointer;
                color: ${theme.colors.text.hint};
                &:hover { color: ${theme.colors.text.primary}; background: ${theme.colors.background.elevated}; }
              `}
            >
              <X size={16} />
            </button>
          </div>
          <SwitchProviderModalContent onClose={handleSwitchModalClose} />
        </div>
      </Modal>
    </div>
  );
}

/**
 * Inner content for the Switch Provider modal.
 * Reuses the same three-layer progressive disclosure from onboarding,
 * adapted for modal use (no onboarding navigation, auto-closes on success).
 */
function SwitchProviderModalContent({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: statusData } = trpc.cortexProvider.getStatus.useQuery();
  const { data: allProviders } = trpc.cortexProvider.listProviders.useQuery();

  const oauthCards = useMemo(() => buildOAuthCards(allProviders ?? []), [allProviders]);

  // OAuth state
  const [oauthProvider, setOauthProvider] = useState<string | null>(null);
  const [oauthState, setOauthState] = useState<'idle' | 'authenticating' | 'success' | 'error'>('idle');
  const [oauthAuthUrl, setOauthAuthUrl] = useState<string | null>(null);
  const [oauthDeviceCode, setOauthDeviceCode] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

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

  // Mutations
  const initiateOAuthMutation = trpc.cortexProvider.initiateOAuth.useMutation();
  const cancelOAuthMutation = trpc.cortexProvider.cancelOAuth.useMutation();
  const validateApiKeyMutation = trpc.cortexProvider.validateApiKey.useMutation();
  const saveApiKeyMutation = trpc.cortexProvider.saveApiKey.useMutation();
  const saveCustomMutation = trpc.cortexProvider.saveCustomEndpoint.useMutation();
  const testCustomMutation = trpc.cortexProvider.testCustomEndpoint.useMutation();

  // OAuth subscription
  trpc.cortexProvider.oauthStatus.useSubscription(undefined, {
    enabled: oauthState === 'authenticating',
    onData: (event) => {
      if (event.type === 'auth_url') {
        setOauthAuthUrl(event.url);
        if (event.deviceCode) setOauthDeviceCode(event.deviceCode);
      } else if (event.type === 'success') {
        setOauthState('success');
        utils.cortexProvider.getStatus.invalidate();
        utils.cortexProvider.listConfiguredProviders.invalidate();
        setTimeout(() => onClose(), 600);
      } else if (event.type === 'error') {
        setOauthState('error');
        setOauthError(event.message);
      }
    },
  });

  const apiKeyProviders = (allProviders ?? []).filter(
    (p) => p.authMethods.includes('api_key')
  );
  const selectedApiProvider = apiKeyProviders.find((p) => p.id === apiKeyProvider);

  useEffect(() => {
    if (!apiKeyProvider && apiKeyProviders.length > 0) {
      setApiKeyProvider(apiKeyProviders[0]!.id);
    }
  }, [apiKeyProvider, apiKeyProviders]);

  const handleOAuthStart = useCallback((providerId: string) => {
    setOauthProvider(providerId);
    setOauthState('authenticating');
    setOauthError(null);
    setOauthAuthUrl(null);
    setOauthDeviceCode(null);
    initiateOAuthMutation.mutate(
      { provider: providerId },
      {
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
  }, [cancelOAuthMutation]);

  const handleValidateApiKey = useCallback(() => {
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
                  utils.cortexProvider.getStatus.invalidate();
                  utils.cortexProvider.listConfiguredProviders.invalidate();
                  setTimeout(() => onClose(), 600);
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
  }, [apiKeyProvider, apiKeyValue, validateApiKeyMutation, saveApiKeyMutation, utils, onClose]);

  const handleTestCustom = useCallback(() => {
    if (!customBaseUrl || !customModelId) return;
    setCustomValidation('validating');
    testCustomMutation.mutate(
      { baseUrl: customBaseUrl, modelId: customModelId, apiKey: customApiKey || undefined },
      {
        onSuccess: (result) => {
          if (result.valid) {
            saveCustomMutation.mutate(
              { baseUrl: customBaseUrl, modelId: customModelId, apiKey: customApiKey || undefined },
              {
                onSuccess: () => {
                  setCustomValidation('success');
                  utils.cortexProvider.getStatus.invalidate();
                  utils.cortexProvider.listConfiguredProviders.invalidate();
                  setTimeout(() => onClose(), 600);
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
  }, [customBaseUrl, customModelId, customApiKey, testCustomMutation, saveCustomMutation, utils, onClose]);

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
      <Typography.Caption color="secondary">
        Connect to a different AI provider. Your existing configuration will be replaced.
      </Typography.Caption>

      {/* OAuth Provider Cards */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
        {oauthCards.map((card) => {
          const isAuthenticating = oauthProvider === card.id && oauthState === 'authenticating';
          const isError = oauthProvider === card.id && oauthState === 'error';
          const isCurrent = statusData?.provider === card.id && statusData.connected;

          return (
            <div
              key={card.id}
              css={css`
                padding: ${theme.spacing[3]};
                border-radius: ${theme.borderRadius.md};
                border: 1px solid ${isCurrent ? theme.colors.success.main + '55' : theme.colors.border.default};
                background: ${isCurrent ? theme.colors.success.main + '08' : theme.colors.background.paper};
                transition: border-color ${theme.transitions.fast}, background ${theme.transitions.fast};
              `}
            >
              {isAuthenticating ? (
                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                  <Typography.SmallBodyAlt>{card.name}</Typography.SmallBodyAlt>
                  {oauthAuthUrl && oauthDeviceCode ? (
                    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
                      <Typography.Caption color="secondary">Open the browser and enter code:</Typography.Caption>
                      <Typography.SmallBodyAlt as="code" css={css`letter-spacing: 0.15em;`}>
                        {oauthDeviceCode}
                      </Typography.SmallBodyAlt>
                    </div>
                  ) : (
                    <Typography.Caption color="secondary">
                      {oauthAuthUrl ? 'Complete sign-in in your browser.' : 'Starting authentication...'}
                    </Typography.Caption>
                  )}
                  <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                    <BreathingDots color={theme.colors.text.hint} />
                    <Typography.Tiny color="hint">Waiting for authorization...</Typography.Tiny>
                    <Button variant="ghost" size="sm" onClick={handleOAuthCancel}>Cancel</Button>
                  </div>
                </div>
              ) : isError ? (
                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                  <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                    <XCircle size={16} weight="fill" css={css`color: ${theme.colors.error.main}; flex-shrink: 0;`} />
                    <Typography.SmallBody css={css`color: ${theme.colors.error.main};`}>
                      {oauthError || 'Authentication failed'}
                    </Typography.SmallBody>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => handleOAuthStart(card.id)} css={css`align-self: flex-start;`}>
                    Try again
                  </Button>
                </div>
              ) : (
                <div css={css`display: flex; align-items: center; justify-content: space-between;`}>
                  <div>
                    <Typography.SmallBodyAlt>{card.name}</Typography.SmallBodyAlt>
                    <Typography.Tiny color="hint">{card.description}</Typography.Tiny>
                  </div>
                  {isCurrent ? (
                    <Badge variant="success">Current</Badge>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => handleOAuthStart(card.id)}>
                      Sign In
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* API Key Layer */}
      <div>
        <button
          onClick={() => setApiKeyExpanded(!apiKeyExpanded)}
          css={css`
            display: flex; align-items: center; gap: ${theme.spacing[1]};
            padding: 0; background: none; border: none; cursor: pointer;
            font-size: ${theme.typography.fontSize.sm}; font-family: inherit;
            color: ${theme.colors.text.hint};
            &:hover { color: ${theme.colors.text.secondary}; }
          `}
        >
          <CaretRight size={12} css={css`
            transition: transform 150ms ease;
            transform: rotate(${apiKeyExpanded ? '90deg' : '0deg'});
          `} />
          Use an API key instead
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
                padding: ${theme.spacing[3]};
                margin-top: ${theme.spacing[2]};
                border-radius: ${theme.borderRadius.md};
                border: 1px solid ${theme.colors.border.default};
                background: ${theme.colors.background.elevated};
              `}>
                <select
                  value={apiKeyProvider}
                  onChange={(e) => {
                    setApiKeyProvider(e.target.value);
                    setApiKeyValidation('idle');
                    setApiKeyError(null);
                    setApiKeyValue('');
                  }}
                  css={css`
                    padding: ${theme.spacing[2]} ${theme.spacing[3]};
                    background: ${theme.colors.background.paper};
                    border: 1px solid ${theme.colors.border.default};
                    border-radius: ${theme.borderRadius.default};
                    color: ${theme.colors.text.primary};
                    font-size: ${theme.typography.fontSize.sm};
                    font-family: inherit; cursor: pointer; outline: none;
                    &:focus { border-color: ${theme.colors.border.focus}; }
                  `}
                >
                  {apiKeyProviders.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
                  <div css={css`flex: 1; position: relative;`}>
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKeyValue}
                      onChange={(e) => { setApiKeyValue(e.target.value); setApiKeyValidation('idle'); setApiKeyError(null); }}
                      placeholder={selectedApiProvider?.keyPrefix ? `${selectedApiProvider.keyPrefix}...` : 'Enter API key'}
                      onKeyDown={(e) => { if (e.key === 'Enter' && apiKeyValue.trim()) handleValidateApiKey(); }}
                      css={css`
                        width: 100%; padding: ${theme.spacing[2]} ${theme.spacing[3]};
                        padding-right: ${theme.spacing[8]};
                        background: ${theme.colors.background.paper};
                        border: 1px solid ${apiKeyValidation === 'error' ? theme.colors.error.main : theme.colors.border.default};
                        border-radius: ${theme.borderRadius.default};
                        color: ${theme.colors.text.primary}; font-size: ${theme.typography.fontSize.sm};
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
                    css={css`flex-shrink: 0; min-width: 100px;`}
                  >
                    {apiKeyValidation === 'success' ? (
                      <span css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                        <CheckCircle size={14} weight="fill" /> Saved
                      </span>
                    ) : 'Validate'}
                  </Button>
                </div>
                {apiKeyValidation === 'error' && (
                  <Typography.Caption css={css`color: ${theme.colors.error.main}; display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                    <XCircle size={12} weight="fill" /> {apiKeyError || 'Invalid API key'}
                  </Typography.Caption>
                )}
                {selectedApiProvider?.keyUrl && (
                  <Typography.Tiny
                    as="a"
                    href={`https://${selectedApiProvider.keyUrl}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    color="hint"
                    css={css`
                      display: inline-flex; align-items: center; gap: ${theme.spacing[1]};
                      text-decoration: none;
                      &:hover { text-decoration: underline; color: ${theme.colors.text.secondary}; }
                    `}
                  >
                    Get your key at {selectedApiProvider.keyUrl} <ArrowSquareOut size={10} />
                  </Typography.Tiny>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Custom Endpoint Layer */}
      <div>
        <button
          onClick={() => setCustomExpanded(!customExpanded)}
          css={css`
            display: flex; align-items: center; gap: ${theme.spacing[1]};
            padding: 0; background: none; border: none; cursor: pointer;
            font-size: ${theme.typography.fontSize.sm}; font-family: inherit;
            color: ${theme.colors.text.hint};
            &:hover { color: ${theme.colors.text.secondary}; }
          `}
        >
          <CaretRight size={12} css={css`
            transition: transform 150ms ease;
            transform: rotate(${customExpanded ? '90deg' : '0deg'});
          `} />
          Configure a custom endpoint
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
                padding: ${theme.spacing[3]};
                margin-top: ${theme.spacing[2]};
                border-radius: ${theme.borderRadius.md};
                border: 1px solid ${theme.colors.border.default};
                background: ${theme.colors.background.elevated};
              `}>
                <Typography.Tiny color="hint">
                  For self-hosted models (Ollama, vLLM, LM Studio) or custom OpenAI-compatible APIs
                </Typography.Tiny>
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
                    color: ${theme.colors.text.primary}; font-size: ${theme.typography.fontSize.sm};
                    outline: none;
                    &:focus { border-color: ${theme.colors.border.focus}; }
                    &::placeholder { color: ${theme.colors.text.hint}; }
                  `}
                />
                <Typography.Tiny color="disabled">
                  Running in Docker? Use http://host.docker.internal:PORT instead of localhost.
                </Typography.Tiny>
                <input
                  type="text"
                  value={customModelId}
                  onChange={(e) => { setCustomModelId(e.target.value); setCustomValidation('idle'); }}
                  placeholder="Model ID (e.g. llama-3.3-70b)"
                  css={css`
                    padding: ${theme.spacing[2]} ${theme.spacing[3]};
                    background: ${theme.colors.background.paper};
                    border: 1px solid ${theme.colors.border.default};
                    border-radius: ${theme.borderRadius.default};
                    color: ${theme.colors.text.primary}; font-size: ${theme.typography.fontSize.sm};
                    outline: none;
                    &:focus { border-color: ${theme.colors.border.focus}; }
                    &::placeholder { color: ${theme.colors.text.hint}; }
                  `}
                />
                <input
                  type="password"
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                  placeholder="API Key (optional)"
                  css={css`
                    padding: ${theme.spacing[2]} ${theme.spacing[3]};
                    background: ${theme.colors.background.paper};
                    border: 1px solid ${theme.colors.border.default};
                    border-radius: ${theme.borderRadius.default};
                    color: ${theme.colors.text.primary}; font-size: ${theme.typography.fontSize.sm};
                    outline: none;
                    &:focus { border-color: ${theme.colors.border.focus}; }
                    &::placeholder { color: ${theme.colors.text.hint}; }
                  `}
                />
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
                    <Typography.Tiny css={css`color: ${theme.colors.error.main}; display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                      <XCircle size={12} weight="fill" /> Connection failed
                    </Typography.Tiny>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
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
const channelIconMap: Record<string, PhosphorIcon> = {
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

  // Package install mutations
  const verifyPackageMutation = trpc.channels.verifyPackage.useMutation();
  const installFromPackageMutation = trpc.channels.installFromPackage.useMutation({
    onSuccess: () => {
      utils.channels.listPackages.invalidate();
      setShowInstallModal(false);
      setShowConsentDialog(false);
      setChannelPackageVerification(null);
      setSelectedPackagePath(null);
      toast.success('Channel installed successfully');
    },
  });
  const rollbackMutation = trpc.channels.rollback.useMutation({
    onSuccess: () => utils.channels.listPackages.invalidate(),
  });
  // Channel update mutations
  const channelUpdateVerifyMutation = trpc.channels.verifyPackage.useMutation();
  const channelUpdateFromPackageMutation = trpc.channels.updateFromPackage.useMutation({
    onSuccess: () => {
      utils.channels.listPackages.invalidate();
      setChannelUpdateTarget(null);
      setShowChannelUpdateConsentDialog(false);
      setChannelUpdateVerification(null);
      setChannelUpdatePackagePath(null);
      toast.success('Channel updated successfully');
    },
  });

  // Local state
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installTab, setInstallTab] = useState<'package' | 'path'>('package');
  const [installPath, setInstallPath] = useState('');
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [uninstallConfirm, setUninstallConfirm] = useState<string | null>(null);
  const navigateToConfig = useNavigate();

  // Package consent dialog state
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const [channelPackageVerification, setChannelPackageVerification] = useState<(ReturnType<typeof verifyPackageMutation.mutateAsync> extends Promise<infer T> ? T : never) | null>(null);
  const [selectedPackagePath, setSelectedPackagePath] = useState<string | null>(null);
  const [rollbackConfirm, setRollbackConfirm] = useState<string | null>(null);

  // Channel update state
  const [channelUpdateTarget, setChannelUpdateTarget] = useState<string | null>(null);
  const [showChannelUpdateConsentDialog, setShowChannelUpdateConsentDialog] = useState(false);
  const [channelUpdateVerification, setChannelUpdateVerification] = useState<(ReturnType<typeof channelUpdateVerifyMutation.mutateAsync> extends Promise<infer T> ? T : never) | null>(null);
  const [channelUpdatePackagePath, setChannelUpdatePackagePath] = useState<string | null>(null);

  // Real-time status subscription
  trpc.channels.onStatusChange.useSubscription(undefined, {
    onData: () => {
      utils.channels.listPackages.invalidate();
    },
  });

  const handleToggleEnabled = (name: string, currentlyEnabled: boolean) => {
    const action = currentlyEnabled ? 'disable' : 'enable';
    const mutation = currentlyEnabled ? disableMutation : enableMutation;
    mutation.mutate({ name }, {
      onError: (err) => toast.error(`Failed to ${action} channel "${name}"`, { detail: err.message }),
    });
  };

  const handleRestart = (name: string) => {
    restartMutation.mutate({ name }, {
      onError: (err) => toast.error(`Failed to restart channel "${name}"`, { detail: err.message }),
    });
  };

  const handleUninstall = (name: string) => {
    uninstallMutation.mutate(
      { name },
      {
        onSuccess: () => setUninstallConfirm(null),
        onError: (err) => {
          toast.error(`Failed to uninstall channel "${name}"`, { detail: err.message });
          setUninstallConfirm(null);
        },
      }
    );
  };

  const handleInstall = () => {
    installMutation.mutate(
      { path: installPath },
      { onError: (err) => toast.error('Channel installation failed', { detail: err.message }) }
    );
  };

  const handleChannelPackageUpload = async (filePath: string) => {
    try {
      const result = await verifyPackageMutation.mutateAsync({ filePath });
      setChannelPackageVerification(result);
      setSelectedPackagePath(filePath);
      setShowConsentDialog(true);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      toast.error('Could not verify this package. It may be corrupted or incompatible.', { detail });
      throw err;
    }
  };

  const handleChannelPackageConfirmInstall = (grantedPermissions: string[]) => {
    if (!selectedPackagePath) return;
    installFromPackageMutation.mutate(
      { filePath: selectedPackagePath, grantedPermissions },
      {
        onError: (err) => {
          setShowConsentDialog(false);
          setChannelPackageVerification(null);
          setSelectedPackagePath(null);
          const msg = err.message.includes('already installed')
            ? 'This channel is already installed.'
            : 'Channel installation failed';
          toast.error(msg, { detail: err.message });
        },
      }
    );
  };

  const handleChannelRollback = (name: string) => {
    rollbackMutation.mutate(
      { name },
      {
        onSuccess: () => setRollbackConfirm(null),
        onError: (err) => {
          toast.error(`Failed to rollback channel "${name}"`, { detail: err.message });
          setRollbackConfirm(null);
        },
      }
    );
  };

  const handleChannelUpdateUpload = async (filePath: string) => {
    try {
      const result = await channelUpdateVerifyMutation.mutateAsync({ filePath });
      setChannelUpdateVerification(result);
      setChannelUpdatePackagePath(filePath);
      setShowChannelUpdateConsentDialog(true);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      toast.error('Could not verify this package. It may be corrupted or incompatible.', { detail });
      throw err;
    }
  };

  const handleChannelUpdateConfirmInstall = (grantedPermissions: string[]) => {
    if (!channelUpdateTarget || !channelUpdatePackagePath) return;
    channelUpdateFromPackageMutation.mutate(
      { name: channelUpdateTarget, filePath: channelUpdatePackagePath, grantedPermissions },
      {
        onError: (err) => {
          setShowChannelUpdateConsentDialog(false);
          setChannelUpdateVerification(null);
          setChannelUpdatePackagePath(null);
          setChannelUpdateTarget(null);
          toast.error('Channel update failed', { detail: err.message });
        },
      }
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

      {/* Channel list */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        {/* Built-in Web Channel */}
        <Card variant="outlined" padding="md">
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
              <Globe size={20} css={css`flex-shrink: 0;`} />
              <Typography.BodyAlt as="span">{webChannel.displayName}</Typography.BodyAlt>
              <Badge variant="success">Always on</Badge>
            </div>
            <Typography.SmallBody color="secondary">{webChannel.description}</Typography.SmallBody>
          </div>
        </Card>

        {/* Installed Channel Packages */}
        {channelList.map((channel) => {
          const isExpanded = expandedChannel === channel.name;
          const statusInfo = channelStatusBadge[channel.status] ?? { variant: 'default' as const, label: channel.status };
          const channelSource = sourceBadgeConfig[channel.installedFrom] ?? { variant: 'default' as const, label: channel.installedFrom };
          const IconComponent = channelIconMap[channel.channelType] ?? Plugs;
          const hasError = channel.status === 'error' || channel.status === 'failed';

          return (
            <Card key={channel.name} variant="outlined" padding="md">
              <div
                css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]}; cursor: pointer;`}
                onClick={() => setExpandedChannel(isExpanded ? null : channel.name)}
              >
                {/* Row 1: Icon + title + version + badges + toggle */}
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                  <IconComponent size={20} css={css`flex-shrink: 0;`} />
                  <div css={css`display: flex; align-items: baseline; gap: ${theme.spacing[1.5]};`}>
                    <Typography.BodyAlt as="span">{channel.displayName}</Typography.BodyAlt>
                    <Typography.Caption as="span" color="disabled">v{channel.version}</Typography.Caption>
                  </div>
                  <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                  <Badge variant={channelSource.variant}>{channelSource.label}</Badge>
                  <div css={css`flex: 1;`} />
                  <motion.div
                    animate={{ rotate: isExpanded ? 90 : 0 }}
                    transition={{ duration: 0.15 }}
                    css={css`display: flex; color: ${theme.colors.text.disabled}; flex-shrink: 0;`}
                  >
                    <CaretRight size={14} />
                  </motion.div>
                  <div onClick={(e) => e.stopPropagation()}>
                    {channel.status === 'unconfigured' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigateToConfig(`/settings/channels/${channel.name}/configure`)}
                      >
                        Configure
                      </Button>
                    ) : (
                      <Toggle
                        checked={channel.enabled}
                        onChange={() => handleToggleEnabled(channel.name, channel.enabled)}
                      />
                    )}
                  </div>
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
                      <div css={css`display: flex; gap: ${theme.spacing[6]};`}>
                        {channel.author && (
                          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[0.5]};`}>
                            <Typography.Tiny as="span" css={css`
                              color: ${theme.colors.text.disabled};
                              text-transform: uppercase;
                              letter-spacing: 0.06em;
                              font-weight: ${theme.typography.fontWeight.medium};
                            `}>Author</Typography.Tiny>
                            <Typography.Caption as="span" color="secondary" css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                              {channel.author.name}
                              {channel.author.url && (
                                <a
                                  href={channel.author.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  css={css`
                                    color: ${theme.colors.text.hint};
                                    &:hover { color: ${theme.colors.text.primary}; }
                                  `}
                                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                >
                                  <ArrowSquareOut size={10} />
                                </a>
                              )}
                            </Typography.Caption>
                          </div>
                        )}
                        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[0.5]};`}>
                          <Typography.Tiny as="span" css={css`
                            color: ${theme.colors.text.disabled};
                            text-transform: uppercase;
                            letter-spacing: 0.06em;
                            font-weight: ${theme.typography.fontWeight.medium};
                          `}>Installed</Typography.Tiny>
                          <Typography.Caption as="span" color="secondary">
                            {new Date(channel.installedAt).toLocaleDateString()}
                          </Typography.Caption>
                        </div>
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
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); navigateToConfig(`/settings/channels/${channel.name}/configure`); }}
                        >
                          <GearFine size={14} css={css`margin-right: ${theme.spacing[1]};`} />
                          Configure
                        </Button>
                        {channel.installedFrom === 'package' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setChannelUpdateTarget(channel.name); }}
                          >
                            <Upload size={14} css={css`margin-right: ${theme.spacing[1]};`} />
                            Update Package
                          </Button>
                        )}
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

          {/* Tabs: Package vs Path */}
          <div css={css`display: flex; gap: ${theme.spacing[1]}; border-bottom: 1px solid ${theme.colors.border.light};`}>
            {([
              { id: 'package' as const, label: 'Package', icon: Upload },
              { id: 'path' as const, label: 'Local Path', icon: FolderOpen },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setInstallTab(tab.id); setInstallPath(''); }}
                css={css`
                  display: flex; align-items: center; gap: ${theme.spacing[1.5]};
                  padding: ${theme.spacing[2]} ${theme.spacing[3]};
                  font-size: ${theme.typography.fontSize.sm};
                  font-weight: ${installTab === tab.id ? theme.typography.fontWeight.medium : theme.typography.fontWeight.normal};
                  color: ${installTab === tab.id ? theme.colors.text.primary : theme.colors.text.secondary};
                  cursor: pointer;
                  border-bottom: 2px solid ${installTab === tab.id ? theme.colors.accent : 'transparent'};
                  margin-bottom: -1px;
                  transition: all ${theme.transitions.micro};
                  &:hover { color: ${theme.colors.text.primary}; }
                `}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>

          {installTab === 'path' && (
            <>
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
            </>
          )}

          {installTab === 'package' && (
            <>
              <AnpkDropZone
                onFileReady={(filePath) => handleChannelPackageUpload(filePath)}
                disabled={verifyPackageMutation.isPending}
                packageType="channel"
              />
              <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
                <Button variant="ghost" size="sm" onClick={() => setShowInstallModal(false)}>Cancel</Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Package Consent Dialog */}
      <PackageConsentDialog
        open={showConsentDialog}
        onClose={() => { setShowConsentDialog(false); setChannelPackageVerification(null); setSelectedPackagePath(null); }}
        verification={channelPackageVerification}
        onConfirm={handleChannelPackageConfirmInstall}
        isInstalling={installFromPackageMutation.isPending}
      />

      {/* Rollback Confirmation Modal */}
      <Modal open={rollbackConfirm !== null} onClose={() => setRollbackConfirm(null)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            <ArrowCounterClockwise size={20} css={css`color: ${theme.colors.warning.main};`} />
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              Rollback {rollbackConfirm}?
            </Typography.Subtitle>
          </div>
          <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
            This will revert the channel to its previous version. The current version will be replaced.
          </Typography.SmallBody>
          <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
            <Button variant="ghost" size="sm" onClick={() => setRollbackConfirm(null)}>Cancel</Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => rollbackConfirm && handleChannelRollback(rollbackConfirm)}
              loading={rollbackMutation.isPending}
            >
              Rollback
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

      {/* Channel Update Package Modal */}
      <Modal open={channelUpdateTarget !== null && !showChannelUpdateConsentDialog} onClose={() => setChannelUpdateTarget(null)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            <Upload size={20} css={css`color: ${theme.colors.accent};`} />
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              Update {channelUpdateTarget}
            </Typography.Subtitle>
          </div>
          <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
            Upload a new .anpk package to update this channel. Your existing configuration will be preserved.
          </Typography.SmallBody>
          <AnpkDropZone
            onFileReady={(filePath) => handleChannelUpdateUpload(filePath)}
            disabled={channelUpdateVerifyMutation.isPending}
            packageType="channel"
          />
          <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
            <Button variant="ghost" size="sm" onClick={() => setChannelUpdateTarget(null)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Channel Update Consent Dialog */}
      <PackageConsentDialog
        open={showChannelUpdateConsentDialog}
        onClose={() => { setShowChannelUpdateConsentDialog(false); setChannelUpdateVerification(null); setChannelUpdatePackagePath(null); setChannelUpdateTarget(null); }}
        verification={channelUpdateVerification}
        onConfirm={handleChannelUpdateConfirmInstall}
        isInstalling={channelUpdateFromPackageMutation.isPending}
      />

    </div>
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
  package: { variant: 'info', label: 'package' },
  store: { variant: 'success', label: 'store' },
};

// Status → Badge variant mapping for plugins (mirrors channelStatusBadge)
const pluginStatusBadge: Record<string, { variant: 'default' | 'success' | 'warning' | 'error'; label: string }> = {
  disabled: { variant: 'default', label: 'Disabled' },
  unconfigured: { variant: 'warning', label: 'Needs Configuration' },
  active: { variant: 'success', label: 'Active' },
  error: { variant: 'error', label: 'Error' },
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
  // Package install mutations
  const verifyPackageMutation = trpc.plugins.verifyPackage.useMutation();
  const installFromPackageMutation = trpc.plugins.installFromPackage.useMutation({
    onSuccess: () => {
      utils.plugins.list.invalidate();
      setShowInstallModal(false);
      setShowConsentDialog(false);
      setPackageVerification(null);
      setSelectedPackagePath(null);
      toast.success('Plugin installed successfully');
    },
  });
  const rollbackMutation = trpc.plugins.rollback.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });
  // Package update mutations
  const updateVerifyMutation = trpc.plugins.verifyPackage.useMutation();
  const updateFromPackageMutation = trpc.plugins.updateFromPackage.useMutation({
    onSuccess: () => {
      utils.plugins.list.invalidate();
      setUpdateTarget(null);
      setShowUpdateConsentDialog(false);
      setUpdateVerification(null);
      setUpdatePackagePath(null);
      toast.success('Plugin updated successfully');
    },
  });

  // Local state
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installTab, setInstallTab] = useState<'package' | 'local'>('package');
  const [installPath, setInstallPath] = useState('');
  const [installValidation, setInstallValidation] = useState<{
    valid: boolean;
    manifest?: {
      name: string;
      version: string;
      description?: string;
      author?: string | { name: string };
      [key: string]: unknown;
    };
    error?: string;
  } | null>(null);
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [uninstallConfirm, setUninstallConfirm] = useState<string | null>(null);
  const navigateToConfig = useNavigate();

  // Package consent dialog state
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const [packageVerification, setPackageVerification] = useState<(ReturnType<typeof verifyPackageMutation.mutateAsync> extends Promise<infer T> ? T : never) | null>(null);
  const [selectedPackagePath, setSelectedPackagePath] = useState<string | null>(null);
  const [rollbackConfirm, setRollbackConfirm] = useState<string | null>(null);

  // Update state
  const [updateTarget, setUpdateTarget] = useState<string | null>(null);
  const [showUpdateConsentDialog, setShowUpdateConsentDialog] = useState(false);
  const [updateVerification, setUpdateVerification] = useState<(ReturnType<typeof updateVerifyMutation.mutateAsync> extends Promise<infer T> ? T : never) | null>(null);
  const [updatePackagePath, setUpdatePackagePath] = useState<string | null>(null);

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
    installMutation.mutate(
      { source: 'local' as const, path: installPath },
      {
        onError: (err) => toast.error('Plugin installation failed', { detail: err.message }),
      }
    );
  };

  const handlePackageUpload = async (filePath: string) => {
    try {
      const result = await verifyPackageMutation.mutateAsync({ filePath });
      setPackageVerification(result);
      setSelectedPackagePath(filePath);
      setShowConsentDialog(true);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      toast.error('Could not verify this package. It may be corrupted or incompatible.', { detail });
      throw err;
    }
  };

  const handlePackageConfirmInstall = (grantedPermissions: string[]) => {
    if (!selectedPackagePath) return;
    installFromPackageMutation.mutate(
      { filePath: selectedPackagePath, grantedPermissions },
      {
        onError: (err) => {
          setShowConsentDialog(false);
          setPackageVerification(null);
          setSelectedPackagePath(null);
          const msg = err.message.includes('already installed')
            ? 'This plugin is already installed.'
            : 'Plugin installation failed';
          toast.error(msg, { detail: err.message });
        },
      }
    );
  };

  const handleRollback = (name: string) => {
    rollbackMutation.mutate(
      { name },
      {
        onSuccess: () => setRollbackConfirm(null),
        onError: (err) => {
          toast.error(`Failed to rollback plugin "${name}"`, { detail: err.message });
          setRollbackConfirm(null);
        },
      }
    );
  };

  const handleUpdateUpload = async (filePath: string) => {
    try {
      const result = await updateVerifyMutation.mutateAsync({ filePath });
      setUpdateVerification(result);
      setUpdatePackagePath(filePath);
      setShowUpdateConsentDialog(true);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      toast.error('Could not verify this package. It may be corrupted or incompatible.', { detail });
      throw err;
    }
  };

  const handleUpdateConfirmInstall = (grantedPermissions: string[]) => {
    if (!updateTarget || !updatePackagePath) return;
    updateFromPackageMutation.mutate(
      { name: updateTarget, filePath: updatePackagePath, grantedPermissions },
      {
        onError: (err) => {
          setShowUpdateConsentDialog(false);
          setUpdateVerification(null);
          setUpdatePackagePath(null);
          setUpdateTarget(null);
          toast.error('Plugin update failed', { detail: err.message });
        },
      }
    );
  };

  const handleToggleEnabled = (name: string, currentlyEnabled: boolean) => {
    const action = currentlyEnabled ? 'disable' : 'enable';
    const mutation = currentlyEnabled ? disableMutation : enableMutation;
    mutation.mutate({ name }, {
      onError: (err) => toast.error(`Failed to ${action} plugin "${name}"`, { detail: err.message }),
    });
  };

  const handleUninstall = (name: string) => {
    uninstallMutation.mutate(
      { name },
      {
        onSuccess: () => setUninstallConfirm(null),
        onError: (err) => {
          toast.error(`Failed to uninstall plugin "${name}"`, { detail: err.message });
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
        <Button size="sm" onClick={() => { setShowInstallModal(true); setInstallPath(''); setInstallValidation(null); setInstallTab('package'); }}>
          <Plus size={14} css={css`margin-right: ${theme.spacing[1]};`} />
          Add Plugin
        </Button>
      </div>


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
            onClick={() => { setShowInstallModal(true); setInstallPath(''); setInstallValidation(null); setInstallTab('package'); }}
          >
            Add Plugin
          </Button>
        </div>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {pluginList.map((plugin) => {
            const isExpanded = expandedPlugin === plugin.name;
            const source = sourceBadgeConfig[plugin.installedFrom] ?? { variant: 'default' as const, label: plugin.installedFrom };
            const statusInfo = pluginStatusBadge[plugin.status] ?? { variant: 'default' as const, label: plugin.status };
            const componentBadges: string[] = [];

            // MCP server badge with optional tool count
            const mcpCount = (plugin.components as any).mcpServers as number;
            const mcpToolCount = (plugin.components as any).mcpToolCount as number;
            if (mcpCount > 0) {
              const serverLabel = mcpCount === 1 ? 'MCP server' : 'MCP servers';
              if (mcpToolCount > 0) {
                const toolLabel = mcpToolCount === 1 ? 'tool' : 'tools';
                componentBadges.push(`${mcpCount} ${serverLabel} (${mcpToolCount} ${toolLabel})`);
              } else {
                componentBadges.push(`${mcpCount} ${serverLabel}`);
              }
            }

            // Generic component badges (skip MCP-related keys)
            Object.entries(plugin.components)
              .filter(([key, count]) => !['mcpServers', 'mcpToolCount'].includes(key) && (count as number) > 0)
              .forEach(([key, count]) => {
                const labels = componentLabelMap[key];
                componentBadges.push(
                  labels
                    ? `${count} ${(count as number) === 1 ? labels.singular : labels.plural}`
                    : `${count} ${key}`
                );
              });

            return (
              <Card key={plugin.name} variant="outlined" padding="md">
                <div
                  css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]}; cursor: pointer;`}
                  onClick={() => setExpandedPlugin(isExpanded ? null : plugin.name)}
                >
                  {/* Row 1: Icon + title + version + badges + chevron + toggle */}
                  <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                    {plugin.iconSvg && (
                      <div
                        css={css`
                          width: 20px;
                          height: 20px;
                          flex-shrink: 0;
                          color: ${theme.colors.text.secondary};
                          display: flex;
                          align-items: center;
                          justify-content: center;
                          & svg { width: 100%; height: 100%; }
                        `}
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(plugin.iconSvg, { USE_PROFILES: { svg: true, svgFilters: true } }) }}
                      />
                    )}
                    <div css={css`display: flex; align-items: baseline; gap: ${theme.spacing[1.5]};`}>
                      <Typography.BodyAlt as="span">{plugin.displayName}</Typography.BodyAlt>
                      <Typography.Caption as="span" color="disabled">v{plugin.version}</Typography.Caption>
                    </div>
                    <Badge variant={source.variant}>{source.label}</Badge>
                    <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                    <div css={css`flex: 1;`} />
                    <motion.div
                      animate={{ rotate: isExpanded ? 90 : 0 }}
                      transition={{ duration: 0.15 }}
                      css={css`display: flex; color: ${theme.colors.text.disabled}; flex-shrink: 0;`}
                    >
                      <CaretRight size={14} />
                    </motion.div>
                    <div onClick={(e) => e.stopPropagation()}>
                      {plugin.status === 'unconfigured' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => navigateToConfig(`/settings/plugins/${plugin.name}/configure`)}
                        >
                          Configure
                        </Button>
                      ) : plugin.status === 'error' ? (
                        <Typography.Caption color="hint">Unavailable</Typography.Caption>
                      ) : (
                        <Toggle
                          checked={plugin.enabled}
                          onChange={() => handleToggleEnabled(plugin.name, plugin.enabled)}
                        />
                      )}
                    </div>
                  </div>
                  {/* Error message */}
                  {plugin.status === 'error' && plugin.lastError && (
                    <Typography.SmallBody css={css`
                      color: ${theme.colors.error.main};
                      padding: ${theme.spacing[2]} ${theme.spacing[3]};
                      background: ${theme.colors.error.main}0d;
                      border: 1px solid ${theme.colors.error.main}26;
                      border-radius: ${theme.borderRadius.default};
                    `}>
                      {plugin.lastError}
                    </Typography.SmallBody>
                  )}
                  {/* Description */}
                  {plugin.description && (
                    <Typography.SmallBody color="secondary" css={css`
                      overflow: hidden;
                      text-overflow: ellipsis;
                      white-space: ${isExpanded ? 'normal' : 'nowrap'};
                    `}>
                      {plugin.description}
                    </Typography.SmallBody>
                  )}
                  {/* Component pills */}
                  {componentBadges.length > 0 && (
                    <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[1.5]}; margin-top: ${theme.spacing[1]};`}>
                      {componentBadges.map((label) => (
                        <Typography.Tiny
                          key={label}
                          as="span"
                          color="hint"
                          css={css`
                            padding: 1px ${theme.spacing[1.5]};
                            border: 1px solid ${theme.colors.border.default};
                            border-radius: ${theme.borderRadius.full};
                            white-space: nowrap;
                          `}
                        >
                          {label}
                        </Typography.Tiny>
                      ))}
                    </div>
                  )}
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
                      {plugin.status === 'error' ? (
                        <div css={css`
                          margin-top: ${theme.spacing[4]};
                          padding-top: ${theme.spacing[4]};
                          border-top: 1px solid ${theme.colors.border.light};
                          display: flex;
                          flex-direction: column;
                          gap: ${theme.spacing[3]};
                        `}>
                          <Typography.SmallBody color="secondary">
                            This plugin's directory could not be found. It will recover automatically when the directory becomes available again. You can also uninstall it to remove the record.
                          </Typography.SmallBody>
                          <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setUninstallConfirm(plugin.name)}
                            >
                              Uninstall
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <PluginDetail
                          pluginName={plugin.name}
                          installedFrom={plugin.installedFrom}
                          hasConfig={plugin.hasConfig}
                          onConfigure={() => navigateToConfig(`/settings/plugins/${plugin.name}/configure`)}
                          onUninstall={() => setUninstallConfirm(plugin.name)}
                          onUpdate={() => setUpdateTarget(plugin.name)}
                        />
                      )}
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
              { id: 'package' as const, label: 'Package', icon: Upload },
              { id: 'local' as const, label: 'Local Path', icon: FolderOpen },
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

          {/* .anpk package upload form */}
          {/* .anpk package upload with drag & drop */}
          {installTab === 'package' && (
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
              <AnpkDropZone
                onFileReady={(filePath) => handlePackageUpload(filePath)}
                disabled={verifyPackageMutation.isPending}
                packageType="plugin"
              />
              <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
                <Button variant="ghost" size="sm" onClick={() => setShowInstallModal(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Install error (local path only — package errors use toasts) */}
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

      {/* Package Consent Dialog */}
      <PackageConsentDialog
        open={showConsentDialog}
        onClose={() => { setShowConsentDialog(false); setPackageVerification(null); setSelectedPackagePath(null); }}
        verification={packageVerification}
        onConfirm={handlePackageConfirmInstall}
        isInstalling={installFromPackageMutation.isPending}
      />

      {/* Rollback Confirmation Modal */}
      <Modal open={rollbackConfirm !== null} onClose={() => setRollbackConfirm(null)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            <ArrowCounterClockwise size={20} css={css`color: ${theme.colors.warning.main};`} />
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              Rollback {rollbackConfirm}?
            </Typography.Subtitle>
          </div>
          <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
            This will revert the plugin to its previous version. The current version will be replaced.
          </Typography.SmallBody>
          <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
            <Button variant="ghost" size="sm" onClick={() => setRollbackConfirm(null)}>Cancel</Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => rollbackConfirm && handleRollback(rollbackConfirm)}
              loading={rollbackMutation.isPending}
            >
              Rollback
            </Button>
          </div>
        </div>
      </Modal>

      {/* Update Package Modal */}
      <Modal open={updateTarget !== null && !showUpdateConsentDialog} onClose={() => setUpdateTarget(null)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            <Upload size={20} css={css`color: ${theme.colors.accent};`} />
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              Update {updateTarget}
            </Typography.Subtitle>
          </div>
          <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
            Upload a new .anpk package to update this plugin. Your existing configuration will be preserved.
          </Typography.SmallBody>
          <AnpkDropZone
            onFileReady={(filePath) => handleUpdateUpload(filePath)}
            disabled={updateVerifyMutation.isPending}
            packageType="plugin"
          />
          <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
            <Button variant="ghost" size="sm" onClick={() => setUpdateTarget(null)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Update Consent Dialog */}
      <PackageConsentDialog
        open={showUpdateConsentDialog}
        onClose={() => { setShowUpdateConsentDialog(false); setUpdateVerification(null); setUpdatePackagePath(null); setUpdateTarget(null); }}
        verification={updateVerification}
        onConfirm={handleUpdateConfirmInstall}
        isInstalling={updateFromPackageMutation.isPending}
      />

    </div>
  );
}

// ============================================================================
// Plugin Detail (expanded view within plugin card)
// ============================================================================

function PluginDetail({
  pluginName,
  installedFrom,
  hasConfig,
  onConfigure,
  onUninstall,
  onUpdate,
}: {
  pluginName: string;
  installedFrom: string;
  hasConfig: boolean;
  onConfigure: () => void;
  onUninstall: () => void;
  onUpdate: () => void;
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

  const mcpServers = (detail.components as any).mcpServers as Record<string, { description: string | null; tools: string[] }> | undefined;
  const mcpServerEntries = mcpServers ? Object.entries(mcpServers) : [];

  const componentSections = [
    { label: 'Skills', items: detail.components.skills },
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
      {/* Author */}
      {detail.author && (
        <div css={css`display: flex; gap: ${theme.spacing[6]};`}>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[0.5]};`}>
            <Typography.Tiny as="span" css={css`
              color: ${theme.colors.text.disabled};
              text-transform: uppercase;
              letter-spacing: 0.06em;
              font-weight: ${theme.typography.fontWeight.medium};
            `}>Author</Typography.Tiny>
            <Typography.Caption as="span" color="secondary" css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
              {detail.author.name}
              {detail.author.url && (
                <a
                  href={detail.author.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  css={css`
                    color: ${theme.colors.text.hint};
                    &:hover { color: ${theme.colors.text.primary}; }
                  `}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                  <ArrowSquareOut size={10} />
                </a>
              )}
            </Typography.Caption>
          </div>
        </div>
      )}

      {/* MCP Servers */}
      {mcpServerEntries.length > 0 && (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
          <Typography.Tiny as="span" css={css`
            color: ${theme.colors.text.disabled};
            font-weight: ${theme.typography.fontWeight.medium};
            text-transform: uppercase;
            letter-spacing: 0.06em;
          `}>MCP Servers</Typography.Tiny>
          {mcpServerEntries.map(([name, server]) => (
            <div key={name} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
              <Typography.Caption as="span" color="secondary" css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
                {name}
                {server.description && (
                  <span css={css`font-weight: ${theme.typography.fontWeight.normal}; color: ${theme.colors.text.hint}; margin-left: ${theme.spacing[1]};`}>
                    — {server.description}
                  </span>
                )}
              </Typography.Caption>
              {server.tools.length > 0 && (
                <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[1.5]};`}>
                  {server.tools.map((tool) => (
                    <Typography.Caption
                      key={tool}
                      as="span"
                      css={css`
                        padding: ${theme.spacing[0.5]} ${theme.spacing[2]};
                        background: ${theme.colors.background.elevated};
                        border-radius: ${theme.borderRadius.sm};
                        color: ${theme.colors.text.secondary};
                      `}
                    >
                      {tool}
                    </Typography.Caption>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Component lists */}
      {componentSections.length > 0 && (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {componentSections.map((section) => (
            <div key={section.label} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
              <Typography.Tiny as="span" css={css`
                color: ${theme.colors.text.disabled};
                font-weight: ${theme.typography.fontWeight.medium};
                text-transform: uppercase;
                letter-spacing: 0.06em;
              `}>
                {section.label}
              </Typography.Tiny>
              <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[1.5]};`}>
                {section.items.map((item) => (
                  <Typography.Caption
                    key={item}
                    as="span"
                    css={css`
                      padding: ${theme.spacing[0.5]} ${theme.spacing[2]};
                      background: ${theme.colors.background.elevated};
                      border-radius: ${theme.borderRadius.sm};
                      color: ${theme.colors.text.secondary};
                    `}
                  >
                    {item}
                  </Typography.Caption>
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
        {installedFrom === 'package' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onUpdate(); }}
          >
            <Upload size={14} css={css`margin-right: ${theme.spacing[1]};`} />
            Update Package
          </Button>
        )}
        {installedFrom !== 'built-in' && (
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
  const factoryResetMutation = trpc.data.factoryReset.useMutation();
  const logoutMutation = trpc.auth.logout.useMutation();

  const [confirmAction, setConfirmAction] = useState<'soft' | 'full' | 'factory' | null>(null);
  const [factoryResetting, setFactoryResetting] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const autostart = useAutostart();
  const autoUpdate = useAutoUpdate();

  const handleConfirmAction = async () => {
    const onSuccess = () => setConfirmAction(null);
    if (confirmAction === 'soft') softResetMutation.mutate(undefined, { onSuccess });
    if (confirmAction === 'full') fullResetMutation.mutate(undefined, { onSuccess });
    if (confirmAction === 'factory') {
      setFactoryResetting(true);
      factoryResetMutation.mutate(undefined, {
        onSuccess: async () => {
          // Clear the httpOnly session cookie — frontend JS can't delete
          // httpOnly cookies, so we need the server to send a Set-Cookie clearing it.
          // This must happen AFTER the reset (which is a protectedProcedure) succeeds.
          try { await logoutMutation.mutateAsync(); } catch { /* ok */ }
          localStorage.clear();
          sessionStorage.clear();
          window.location.replace('/register');
        },
        onError: () => {
          setFactoryResetting(false);
        },
      });
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
    factory: {
      title: 'Reset application',
      description: 'This will permanently destroy all application data: databases, authentication, persona, memories, conversations, installed packages, and secrets. Speech models, voices, and saves will be preserved. The application will restart and you will need to set it up again from scratch. This cannot be undone.',
    },
  };

  // Health check
  const { data: healthData } = trpc.settings.healthCheck.useQuery(undefined, { refetchInterval: 30_000 });

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[8]};`}>
      {/* System Health */}
      {healthData && (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            System Health
          </Typography.Subtitle>

          {healthData.status === 'healthy' ? (
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; color: ${theme.colors.success.main};`}>
              <CheckCircle size={18} weight="fill" />
              <Typography.SmallBody css={css`color: ${theme.colors.success.main};`}>
                Animus Engine is healthy
              </Typography.SmallBody>
            </div>
          ) : (
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
              <AnimatePresence>
                {/* Critical failures first */}
                {healthData.checks
                  .filter(c => c.status !== 'pass' && c.severity === 'critical')
                  .map(check => (
                    <motion.div
                      key={check.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      css={css`display: flex; align-items: flex-start; gap: ${theme.spacing[2]};`}
                    >
                      <XCircle size={18} weight="fill" css={css`color: ${theme.colors.error.main}; flex-shrink: 0; margin-top: 2px;`} />
                      <div>
                        <Typography.SmallBody css={css`color: ${theme.colors.error.main};`}>{check.label}</Typography.SmallBody>
                        {check.detail && <Typography.Caption color="hint">{check.detail}</Typography.Caption>}
                      </div>
                    </motion.div>
                  ))}
                {/* Warnings */}
                {healthData.checks
                  .filter(c => c.status !== 'pass' && c.severity === 'warning')
                  .map(check => (
                    <motion.div
                      key={check.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      css={css`display: flex; align-items: flex-start; gap: ${theme.spacing[2]};`}
                    >
                      <Warning size={18} weight="fill" css={css`color: ${theme.colors.warning.main}; flex-shrink: 0; margin-top: 2px;`} />
                      <div>
                        <Typography.SmallBody css={css`color: ${theme.colors.warning.main};`}>{check.label}</Typography.SmallBody>
                        {check.detail && <Typography.Caption color="hint">{check.detail}</Typography.Caption>}
                      </div>
                    </motion.div>
                  ))}
                {/* Info */}
                {healthData.checks
                  .filter(c => c.status !== 'pass' && c.severity === 'info')
                  .map(check => (
                    <motion.div
                      key={check.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      css={css`display: flex; align-items: flex-start; gap: ${theme.spacing[2]};`}
                    >
                      <Warning size={18} css={css`color: ${theme.colors.text.hint}; flex-shrink: 0; margin-top: 2px;`} />
                      <div>
                        <Typography.SmallBody color="secondary">{check.label}</Typography.SmallBody>
                        {check.detail && <Typography.Caption color="hint">{check.detail}</Typography.Caption>}
                      </div>
                    </motion.div>
                  ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* Desktop App */}
      {isTauri() && (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            Desktop App
          </Typography.Subtitle>

          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
            <Toggle
              checked={autostart.enabled}
              onChange={autostart.toggle}
              disabled={autostart.loading || !autostart.available}
              label="Launch at startup"
            />
          </div>
          <Typography.Caption as="p" color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
            Automatically start Animus when you log in. The app will launch hidden in the system tray.
          </Typography.Caption>

          {autoUpdate.available && (
            <>
              <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]}; margin-top: ${theme.spacing[2]};`}>
                <Toggle
                  checked={autoUpdate.enabled}
                  onChange={autoUpdate.toggle}
                  label="Automatic updates"
                />
              </div>
              <Typography.Caption as="p" color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
                Check for updates in the background and notify you when a new version is ready.
              </Typography.Caption>
              <div css={css`margin-top: ${theme.spacing[1]};`}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={autoUpdate.checkNow}
                  disabled={autoUpdate.checking || autoUpdate.downloading}
                  loading={autoUpdate.checking || autoUpdate.downloading}
                >
                  {autoUpdate.checking ? 'Checking...' : autoUpdate.downloading ? 'Downloading...' : 'Check for updates'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Developer */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Developer
        </Typography.Subtitle>

        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
          <Toggle
            checked={settings?.contextDebugMode ?? false}
            onChange={(checked: boolean) => {
              updateSettingsMutation.mutate({ contextDebugMode: checked });
            }}
            label="Context debug mode"
          />
        </div>
        <Typography.Caption as="p" color="hint" css={css`margin-top: -${theme.spacing[1]};`}>
          Captures full context window breakdowns for each pipeline phase and agentic loop turn. Useful for debugging prompt assembly and cache performance. Increases storage.
        </Typography.Caption>
      </div>

      {/* Telemetry */}
      <TelemetryInline />

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
              onClick={() => setConfirmAction('factory')}
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
              Reset application
            </button>
            <Typography.Caption as="p" color="hint" css={css`margin-top: ${theme.spacing[0.5]};`}>
              Completely wipe all data and start fresh. Requires re-setup.
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

      {/* About */}
      <AboutInline />

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
                loading={softResetMutation.isPending || fullResetMutation.isPending || factoryResetting}
              >
                Confirm
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Success/error banners */}
      <AnimatePresence>
        {(softResetMutation.isSuccess || fullResetMutation.isSuccess) && (
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
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const changePasswordMutation = trpc.seal.changePassword.useMutation({
    onSuccess: () => {
      setSuccess(true);
      setError('');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => onClose(), 2000);
    },
    onError: (err) => {
      setError(err.message || 'Failed to change password');
    },
  });

  const handleSubmit = () => {
    setError('');
    setSuccess(false);
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    changePasswordMutation.mutate({
      currentPassword,
      newPassword,
      confirmNewPassword: confirmPassword,
    });
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
      {success && (
        <Typography.SmallBody
          as="div"
          css={css`
            color: ${theme.colors.success.main};
            padding: ${theme.spacing[2]} ${theme.spacing[3]};
            background: ${theme.colors.success.main}12;
            border: 1px solid ${theme.colors.success.main}40;
            border-radius: ${theme.borderRadius.default};
          `}
        >
          Password changed successfully
        </Typography.SmallBody>
      )}
      <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
        <Button size="sm" onClick={handleSubmit} loading={changePasswordMutation.isPending}>
          {changePasswordMutation.isPending ? 'Saving...' : 'Save password'}
        </Button>
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
      case 'cortex_provider': return <CortexProviderSection />;
      case 'usage': return <UsagePage />;
      case 'channels': return <ChannelsSection />;
      case 'plugins': return <PluginsSection />;
      case 'passwords': return <PasswordsSection />;
      case 'tools': return <ToolsSection />;
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
