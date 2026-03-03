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
  ArrowClockwise,
  Plugs,
  FloppyDisk,
  CaretRight,
  CaretDown,
  Wrench,
  SignOut,
  MagnifyingGlass,
  Key,
} from '@phosphor-icons/react';
import { Card, SelectionCard, Button, Input, Select, Modal, Badge, Toggle, Slider, Typography, Tooltip } from '../components/ui';
import { trpc } from '../utils/trpc';
import { isTauri } from '../utils/tauri';
import { useAutostart } from '../hooks/useAutostart';
import type { Theme } from '../styles/theme';
import { SavesSection } from '../components/settings/SavesSection';
import { ToolsSection } from '../components/settings/ToolsSection';
import { PackageConsentDialog } from '../components/settings/PackageConsentDialog';
import { Upload, ArrowCounterClockwise } from '@phosphor-icons/react';
import { AnpkDropZone } from '../components/settings/AnpkDropZone';
import { AboutInline } from '../components/settings/AboutSection';
import { TelemetryInline } from '../components/settings/TelemetrySection';
import { PasswordsSection } from '../components/settings/PasswordsSection';
import { toast } from '../store/toast-store';
import DOMPurify from 'dompurify';

// ============================================================================
// Types
// ============================================================================

type SettingsSection = 'heartbeat' | 'provider' | 'channels' | 'plugins' | 'passwords' | 'tools' | 'goals' | 'saves' | 'system';

interface ModelData {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputPricePer1M: number;
  outputPricePer1M: number;
  supportsVision: boolean;
  supportsThinking: boolean;
  recommended: boolean;
  isDefault: boolean;
  createdAt: string | null;
}

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
  const warmthSave = useSaveFlash();
  const budgetSave = useSaveFlash();

  const isRunning = hbState?.isRunning ?? false;

  // Clear resuming state once the heartbeat is confirmed running
  useEffect(() => {
    if (isRunning && isResuming) setIsResuming(false);
  }, [isRunning, isResuming]);
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
// Section: Agent Provider
// ============================================================================

function ProviderSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: systemSettings } = trpc.settings.getSystemSettings.useQuery();
  const { data: claudeKey } = trpc.provider.hasKey.useQuery({ provider: 'claude' });
  const { data: codexKey } = trpc.provider.hasKey.useQuery({ provider: 'codex' });
  const { data: detectData, dataUpdatedAt: detectUpdatedAt } = trpc.provider.detect.useQuery();

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
    onSuccess: () => {
      utils.settings.getSystemSettings.invalidate();
      // Provider changes re-seed tool permissions on the backend;
      // invalidate the tools cache so the UI picks up the new set.
      utils.tools.listTools.invalidate();
    },
  });

  // Codex OAuth mutations
  const codexInitiateMutation = trpc.codexAuth.initiate.useMutation();
  const codexCancelMutation = trpc.codexAuth.cancel.useMutation();

  // Claude OAuth mutations
  const claudeInitiateMutation = trpc.claudeAuth.initiate.useMutation();
  const claudeCancelMutation = trpc.claudeAuth.cancel.useMutation();
  const claudeLogoutMutation = trpc.claudeAuth.logout.useMutation({
    onSuccess: () => {
      utils.provider.hasKey.invalidate();
      utils.provider.detect.invalidate();
    },
  });

  // Codex CLI auth mutations
  const codexCliInitiateMutation = trpc.codexCliAuth.initiate.useMutation();
  const codexCliCancelMutation = trpc.codexCliAuth.cancel.useMutation();
  const codexCliLogoutMutation = trpc.codexCliAuth.logout.useMutation({
    onSuccess: () => {
      utils.provider.hasKey.invalidate();
      utils.provider.detect.invalidate();
    },
  });

  const rawProvider = systemSettings?.defaultAgentProvider ?? 'claude';
  const activeProvider: 'claude' | 'codex' = rawProvider === 'codex' ? 'codex' : 'claude';
  const activeModel = systemSettings?.defaultModel ?? null;

  // Local state
  const [expandedProviderGroup, setExpandedProviderGroup] = useState<'claude' | 'codex'>(activeProvider);
  const [showAllClaudeModels, setShowAllClaudeModels] = useState(false);
  const [showAllCodexModels, setShowAllCodexModels] = useState(false);
  const [claudeModelSearch, setClaudeModelSearch] = useState('');
  const [codexModelSearch, setCodexModelSearch] = useState('');
  const [credentialsExpandedProvider, setCredentialsExpandedProvider] = useState<'claude' | 'codex' | null>(null);
  const [credentialInput, setCredentialInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [validateResult, setValidateResult] = useState<{ valid: boolean; message: string } | null>(null);
  const [recentSwitch, setRecentSwitch] = useState<{
    fromModel: string | null;
    fromProvider: string;
    toModel: string;
    toProvider: string;
    modelName: string;
    undoTimer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Claude OAuth state
  const [claudeOAuthSession, setClaudeOAuthSession] = useState<string | null>(null);
  const [claudeOAuthStatus, setClaudeOAuthStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [claudeOAuthMessage, setClaudeOAuthMessage] = useState('');

  // Codex CLI auth state
  const [codexCliAuthSession, setCodexCliAuthSession] = useState<string | null>(null);
  const [codexCliAuthStatus, setCodexCliAuthStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [codexCliAuthMessage, setCodexCliAuthMessage] = useState('');

  // Sync expanded provider group with active provider on initial load
  const initialSyncDone = useRef(false);
  useEffect(() => {
    if (!initialSyncDone.current && systemSettings) {
      initialSyncDone.current = true;
      setExpandedProviderGroup(activeProvider);
    }
  }, [systemSettings, activeProvider]);

  // detect may clean up stale CLI credentials; refetch hasKey to stay in sync
  useEffect(() => {
    if (detectUpdatedAt) {
      utils.provider.hasKey.invalidate();
    }
  }, [detectUpdatedAt, utils.provider.hasKey]);

  // Two parallel model queries — one per provider
  const { data: claudeModels } = trpc.provider.listModels.useQuery({ provider: 'claude' }) as { data: ModelData[] | undefined };
  const { data: codexModels } = trpc.provider.listModels.useQuery({ provider: 'codex' }) as { data: ModelData[] | undefined };

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

  // Claude OAuth status subscription
  trpc.claudeAuth.status.useSubscription(
    { sessionId: claudeOAuthSession! },
    {
      enabled: claudeOAuthSession !== null && claudeOAuthStatus === 'pending',
      onData: (data) => {
        if (data.status === 'success') {
          setClaudeOAuthStatus('success');
          utils.provider.hasKey.invalidate();
          utils.provider.detect.invalidate();
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
          utils.provider.hasKey.invalidate();
          utils.provider.detect.invalidate();
        } else if (data.status === 'error') {
          setCodexCliAuthStatus('error');
          setCodexCliAuthMessage(data.message ?? 'Authentication failed');
        } else if (data.status === 'cancelled') {
          setCodexCliAuthStatus('idle');
        }
      },
    }
  );

  // Derive CLI detection
  const claudeCliInstalled = detectData?.find((d) => d.provider === 'claude')?.cliInstalled ?? false;
  const codexCliInstalled = detectData?.find((d) => d.provider === 'codex')?.cliInstalled ?? false;
  const claudeCliAvailable = detectData?.find((d) => d.provider === 'claude')?.methods.some((m) => m.method === 'cli' && m.available) ?? false;
  const codexCliAvailable = detectData?.find((d) => d.provider === 'codex')?.methods.some((m) => m.method === 'cli' && m.available) ?? false;

  // Auto-persist cli_detected sentinel when live CLI auth is found but DB has no record.
  // This keeps the DB in sync so backend consumers (heartbeat, etc.) also see credentials.
  useEffect(() => {
    if (claudeCliAvailable && claudeKey && !claudeKey.hasKey) {
      useCliMutation.mutate({ provider: 'claude' });
    }
  }, [claudeCliAvailable, claudeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (codexCliAvailable && codexKey && !codexKey.hasKey) {
      useCliMutation.mutate({ provider: 'codex' });
    }
  }, [codexCliAvailable, codexKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Credential status helpers
  const getKeyData = (provider: string) => {
    if (provider === 'claude') return claudeKey;
    if (provider === 'codex') return codexKey;
    return null;
  };

  const hasCredentials = (provider: string) => {
    // Check DB-stored credentials first
    if (getKeyData(provider)?.hasKey) return true;
    // Also consider live CLI auth (detect query) so the badge stays
    // consistent with the expanded "signed in" state
    if (provider === 'claude') return claudeCliAvailable;
    if (provider === 'codex') return codexCliAvailable;
    return false;
  };

  // Infer credential type from input prefix
  const inferredType = (() => {
    if (!credentialInput || credentialInput.length < 5) return null;
    if (credentialInput.startsWith('sk-ant-oat01-')) return 'OAuth Token';
    if (credentialInput.startsWith('sk-ant-api03-')) return 'API Key';
    if (credentialInput.startsWith('sk-ant-')) return 'API Key';
    if (credentialInput.startsWith('sk-')) return 'API Key';
    return null;
  })();

  // Formatting helpers
  const formatTokens = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` :
    n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(n);

  const formatPrice = (per1M: number) => `$${per1M.toFixed(2)}`;

  // Auto-save model selection with optional provider switch
  const handleModelClick = (model: ModelData) => {
    // If provider is uncredentialed, open its credential card instead
    if (!hasCredentials(model.provider)) {
      setCredentialsExpandedProvider(model.provider as 'claude' | 'codex');
      return;
    }
    // If already the active model, do nothing
    if (model.id === activeModel && model.provider === activeProvider) return;

    const mutation: { defaultModel: string; defaultAgentProvider?: 'claude' | 'codex' | 'opencode' } = { defaultModel: model.id };
    if (model.provider !== activeProvider) {
      mutation.defaultAgentProvider = model.provider as 'claude' | 'codex' | 'opencode';
    }

    const prevModel = activeModel;
    const prevProvider = activeProvider;

    updateSettingsMutation.mutate(mutation, {
      onSuccess: () => {
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        const timer = setTimeout(() => setRecentSwitch(null), 5000);
        undoTimerRef.current = timer;
        setRecentSwitch({
          fromModel: prevModel,
          fromProvider: prevProvider,
          toModel: model.id,
          toProvider: model.provider,
          modelName: model.name,
          undoTimer: timer,
        });
      },
    });
  };

  const handleUndo = () => {
    if (!recentSwitch) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;

    const mutation: { defaultModel: string | null; defaultAgentProvider?: 'claude' | 'codex' | 'opencode' } = { defaultModel: recentSwitch.fromModel };
    if (recentSwitch.fromProvider !== recentSwitch.toProvider) {
      mutation.defaultAgentProvider = recentSwitch.fromProvider as 'claude' | 'codex' | 'opencode';
    }
    updateSettingsMutation.mutate(mutation);
    setRecentSwitch(null);
  };

  const toggleCredentialCard = (provider: 'claude' | 'codex') => {
    setCredentialsExpandedProvider(prev => prev === provider ? null : provider);
    setCredentialInput('');
    setShowKey(false);
    setValidateResult(null);
  };

  // Cleanup undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

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

  const handleClaudeOAuthStart = () => {
    setClaudeOAuthStatus('pending');
    setClaudeOAuthMessage('');

    claudeInitiateMutation.mutate(undefined, {
      onSuccess: (result) => {
        setClaudeOAuthSession(result.sessionId);
      },
      onError: (err) => {
        setClaudeOAuthStatus('error');
        setClaudeOAuthMessage(err.message ?? 'Failed to start authentication');
      },
    });
  };

  const handleClaudeOAuthCancel = () => {
    if (claudeOAuthSession) {
      claudeCancelMutation.mutate({ sessionId: claudeOAuthSession });
    }
    setClaudeOAuthStatus('idle');
    setClaudeOAuthSession(null);
  };

  const handleCodexCliAuthStart = () => {
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

  const handleSignOut = (provider: 'claude' | 'codex') => {
    if (provider === 'claude') {
      claudeLogoutMutation.mutate();
    } else {
      codexCliLogoutMutation.mutate();
    }
    // Reset any in-progress auth flows
    setClaudeOAuthStatus('idle');
    setClaudeOAuthSession(null);
    setCodexCliAuthStatus('idle');
    setCodexCliAuthSession(null);
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

  // Sort models by release date (newest first)
  const sortByDate = (a: ModelData, b: ModelData) => {
    if (!a.createdAt && !b.createdAt) return 0;
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return b.createdAt.localeCompare(a.createdAt);
  };

  // Per-provider model lists
  const claudeRecommended = (claudeModels?.filter(m => m.recommended) ?? []).sort(sortByDate);
  const claudeNonRecommended = (claudeModels?.filter(m => !m.recommended) ?? []).sort(sortByDate);
  const codexRecommended = (codexModels?.filter(m => m.recommended) ?? []).sort(sortByDate);
  const codexNonRecommended = (codexModels?.filter(m => !m.recommended) ?? []).sort(sortByDate);

  // Per-provider search filtering
  const claudeSearchLower = claudeModelSearch.toLowerCase();
  const filteredClaudeNonRec = claudeModelSearch
    ? claudeNonRecommended.filter(m =>
        m.id.toLowerCase().includes(claudeSearchLower) ||
        m.name.toLowerCase().includes(claudeSearchLower)
      )
    : claudeNonRecommended;
  const codexSearchLower = codexModelSearch.toLowerCase();
  const filteredCodexNonRec = codexModelSearch
    ? codexNonRecommended.filter(m =>
        m.id.toLowerCase().includes(codexSearchLower) ||
        m.name.toLowerCase().includes(codexSearchLower)
      )
    : codexNonRecommended;

  const MAX_VISIBLE_ALL = 20;

  // Active model data (for reasoning effort support check)
  const activeModelData = activeModel
    ? (claudeModels?.find(m => m.id === activeModel) ?? codexModels?.find(m => m.id === activeModel))
    : null;
  const activeModelSupportsThinking = activeModelData?.supportsThinking ?? false;

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>

      {/* ============ Undo Banner ============ */}
      <AnimatePresence>
        {recentSwitch && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div css={css`
              padding: ${theme.spacing[3]} ${theme.spacing[4]};
              border: 1px solid ${theme.colors.success.main}33;
              border-radius: ${theme.borderRadius.md};
              background: ${theme.colors.success.main}08;
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: ${theme.spacing[3]};
            `}>
              <Typography.SmallBody css={css`
                display: flex;
                align-items: center;
                gap: ${theme.spacing[2]};
              `}>
                <CheckCircle size={16} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
                <span>Switched to <strong>{recentSwitch.modelName}</strong>. Mind session restarts on next tick.</span>
              </Typography.SmallBody>
              <Button variant="ghost" size="sm" onClick={handleUndo} css={css`flex-shrink: 0;`}>
                Undo
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ Model Section Header ============ */}
      <div>
        <Typography.Body as="div" css={css`
          font-weight: ${theme.typography.fontWeight.semibold};
          margin-bottom: ${theme.spacing[1]};
        `}>
          Model
        </Typography.Body>
        <Typography.SmallBody color="secondary">
          Choose which model powers your Animus.
        </Typography.SmallBody>
      </div>

      {/* ============ Claude Provider Group ============ */}
      <div>
        {/* Provider header row — clickable to expand/collapse */}
        <button
          onClick={() => setExpandedProviderGroup(expandedProviderGroup === 'claude' ? 'codex' : 'claude')}
          css={css`
            width: 100%;
            display: flex;
            align-items: center;
            gap: ${theme.spacing[2]};
            margin-bottom: ${expandedProviderGroup === 'claude' ? theme.spacing[2] : '0'};
            padding: 0;
            background: transparent;
            cursor: pointer;
            border: none;
            text-align: left;
          `}
        >
          {expandedProviderGroup === 'claude' ? <CaretDown size={12} css={css`color: ${theme.colors.text.hint};`} /> : <CaretRight size={12} css={css`color: ${theme.colors.text.hint};`} />}
          <span css={css`
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: ${hasCredentials('claude') ? theme.colors.success.main : theme.colors.text.disabled};
            flex-shrink: 0;
          `} />
          <Typography.Body as="span" css={css`
            font-weight: ${theme.typography.fontWeight.semibold};
          `}>
            Claude
          </Typography.Body>
          {activeProvider === 'claude' && (
            <Badge variant="default" css={css`
              font-size: ${theme.typography.fontSize.xs};
              background: ${theme.colors.accent}15;
              color: ${theme.colors.accent};
            `}>
              Active
            </Badge>
          )}
          {!hasCredentials('claude') && (
            <span
              onClick={(e) => { e.stopPropagation(); toggleCredentialCard('claude'); }}
              css={css`
                margin-left: auto;
                font-size: 13px;
                color: ${theme.colors.accent};
                cursor: pointer;
                &:hover { text-decoration: underline; }
              `}
            >
              Set up credentials
            </span>
          )}
        </button>

        <AnimatePresence initial={false}>
        {expandedProviderGroup === 'claude' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            css={css`overflow: hidden;`}
          >
        {!hasCredentials('claude') ? (
          <div css={css`
            padding: ${theme.spacing[3]} ${theme.spacing[4]};
            border: 1px solid ${theme.colors.border.light};
            border-radius: ${theme.borderRadius.md};
            text-align: center;
          `}>
            <Typography.SmallBody color="secondary">
              Set up Claude credentials below to select a model.
            </Typography.SmallBody>
          </div>
        ) : (
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
            {/* Recommended Claude models */}
            {claudeRecommended.length > 0 && (
              <div css={css`
                border: 1px solid ${theme.colors.border.light};
                border-radius: ${theme.borderRadius.md};
                overflow: hidden;
              `}>
                <div css={css`
                  padding: ${theme.spacing[2]} ${theme.spacing[4]};
                  background: ${theme.colors.background.elevated};
                  border-bottom: 1px solid ${theme.colors.border.light};
                `}>
                  <Typography.SmallBody css={css`
                    font-weight: ${theme.typography.fontWeight.semibold};
                    color: ${theme.colors.text.primary};
                  `}>
                    Recommended
                  </Typography.SmallBody>
                </div>

                {claudeRecommended.map((model, idx) => {
                  const isCurrent = model.id === activeModel;
                  return (
                    <div
                      key={model.id}
                      onClick={() => handleModelClick(model)}
                      css={css`
                        padding: ${theme.spacing[3]} ${theme.spacing[4]};
                        cursor: pointer;
                        transition: background 150ms ease-out;
                        position: relative;
                        ${idx > 0 ? `border-top: 1px solid ${theme.colors.border.light};` : ''}
                        ${isCurrent ? `
                          background: ${theme.colors.accent}0a;
                          border-left: 2px solid ${theme.colors.accent};
                          padding-left: calc(${theme.spacing[4]} - 2px);
                        ` : `
                          border-left: 2px solid transparent;
                          padding-left: calc(${theme.spacing[4]} - 2px);
                          &:hover {
                            background: ${theme.colors.accent}05;
                          }
                        `}
                      `}
                    >
                      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; margin-bottom: ${theme.spacing[1]};`}>
                        <span css={css`
                          width: 18px;
                          height: 18px;
                          border-radius: 50%;
                          border: 2px solid ${isCurrent ? theme.colors.accent : theme.colors.border.default};
                          display: flex;
                          align-items: center;
                          justify-content: center;
                          flex-shrink: 0;
                          transition: all 150ms ease-out;
                          ${isCurrent ? `background: ${theme.colors.accent};` : ''}
                        `}>
                          {isCurrent && (
                            <span css={css`
                              width: 6px;
                              height: 6px;
                              border-radius: 50%;
                              background: ${theme.colors.accentForeground};
                            `} />
                          )}
                        </span>
                        <Typography.Body as="span" css={css`
                          font-weight: ${theme.typography.fontWeight.medium};
                          font-size: 15px;
                        `}>
                          {model.name}
                        </Typography.Body>
                        {isCurrent && (
                          <Badge variant="default" css={css`font-size: ${theme.typography.fontSize.xs};`}>
                            Current
                          </Badge>
                        )}
                        {model.isDefault && (
                          <Badge variant="default" css={css`
                            font-size: ${theme.typography.fontSize.xs};
                            background: ${theme.colors.accent}15;
                            color: ${theme.colors.accent};
                          `}>
                            Default
                          </Badge>
                        )}
                      </div>
                      <div css={css`
                        margin-left: 24px;
                        font-size: 13px;
                        color: ${theme.colors.text.secondary};
                        line-height: 1.4;
                      `}>
                        {formatTokens(model.contextWindow)} context · {formatTokens(model.maxOutputTokens)} max output
                      </div>
                      <div css={css`
                        margin-left: 24px;
                        font-size: 13px;
                        color: ${theme.colors.text.secondary};
                        line-height: 1.4;
                      `}>
                        <span css={css`color: ${theme.colors.text.primary};`}>{formatPrice(model.inputPricePer1M)}</span> input /{' '}
                        <span css={css`color: ${theme.colors.text.primary};`}>{formatPrice(model.outputPricePer1M)}</span> output per 1M tokens
                      </div>
                      {(model.supportsVision || model.supportsThinking) && (
                        <div css={css`
                          margin-left: 24px;
                          margin-top: ${theme.spacing[1]};
                          display: flex;
                          gap: ${theme.spacing[1]};
                        `}>
                          {model.supportsVision && (
                            <span css={css`
                              font-size: 12px;
                              padding: 1px ${theme.spacing[1.5]};
                              background: ${theme.colors.background.elevated};
                              border-radius: ${theme.borderRadius.sm};
                              color: ${theme.colors.text.hint};
                            `}>
                              Vision
                            </span>
                          )}
                          {model.supportsThinking && (
                            <span css={css`
                              font-size: 12px;
                              padding: 1px ${theme.spacing[1.5]};
                              background: ${theme.colors.background.elevated};
                              border-radius: ${theme.borderRadius.sm};
                              color: ${theme.colors.text.hint};
                            `}>
                              Thinking
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* All Claude models (collapsible with search) */}
            {claudeNonRecommended.length > 0 && (
              <div css={css`
                border: 1px solid ${theme.colors.border.light};
                border-radius: ${theme.borderRadius.md};
                overflow: hidden;
              `}>
                <div css={css`
                  padding: ${theme.spacing[2]} ${theme.spacing[4]};
                  background: ${theme.colors.background.elevated};
                  border-bottom: ${showAllClaudeModels || claudeModelSearch ? `1px solid ${theme.colors.border.light}` : 'none'};
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  gap: ${theme.spacing[2]};
                `}>
                  <button
                    onClick={() => { setShowAllClaudeModels(!showAllClaudeModels); setClaudeModelSearch(''); }}
                    css={css`
                      display: flex;
                      align-items: center;
                      gap: ${theme.spacing[1.5]};
                      background: transparent;
                      cursor: pointer;
                      padding: 0;
                      color: ${theme.colors.text.secondary};
                      &:hover { color: ${theme.colors.text.primary}; }
                    `}
                  >
                    {showAllClaudeModels || claudeModelSearch ? <CaretDown size={12} /> : <CaretRight size={12} />}
                    <Typography.SmallBody css={css`
                      font-weight: ${theme.typography.fontWeight.semibold};
                      color: inherit;
                    `}>
                      All Models ({claudeNonRecommended.length})
                    </Typography.SmallBody>
                  </button>

                  {(showAllClaudeModels || claudeModelSearch) && (
                    <div css={css`
                      position: relative;
                      flex: 1;
                      max-width: 240px;
                    `}>
                      <MagnifyingGlass size={14} css={css`
                        position: absolute;
                        left: ${theme.spacing[2]};
                        top: 50%;
                        transform: translateY(-50%);
                        color: ${theme.colors.text.hint};
                        pointer-events: none;
                      `} />
                      <input
                        type="text"
                        value={claudeModelSearch}
                        onChange={(e) => setClaudeModelSearch(e.target.value)}
                        placeholder="Search models..."
                        css={css`
                          width: 100%;
                          padding: ${theme.spacing[1.5]} ${theme.spacing[3]} ${theme.spacing[1.5]} 2rem;
                          border: 1px solid ${theme.colors.border.default};
                          border-radius: ${theme.borderRadius.md};
                          background: ${theme.colors.background.default};
                          color: ${theme.colors.text.primary};
                          font-size: 13px;
                          outline: none;
                          &:focus {
                            border-color: ${theme.colors.accent};
                          }
                          &::placeholder {
                            color: ${theme.colors.text.hint};
                          }
                        `}
                      />
                    </div>
                  )}
                </div>

                {(showAllClaudeModels || claudeModelSearch) && (() => {
                  const visible = filteredClaudeNonRec.slice(0, MAX_VISIBLE_ALL);
                  const overflow = filteredClaudeNonRec.length - visible.length;
                  return (
                    <>
                      {visible.length === 0 && claudeModelSearch && (
                        <div css={css`
                          padding: ${theme.spacing[4]};
                          text-align: center;
                          color: ${theme.colors.text.hint};
                          font-size: 13px;
                        `}>
                          No models matching &quot;{claudeModelSearch}&quot;
                        </div>
                      )}

                      {visible.map((model, idx) => {
                        const isCurrent = model.id === activeModel;
                        return (
                          <div
                            key={model.id}
                            onClick={() => handleModelClick(model)}
                            css={css`
                              padding: ${theme.spacing[2]} ${theme.spacing[4]};
                              cursor: pointer;
                              transition: background 150ms ease-out;
                              ${idx > 0 ? `border-top: 1px solid ${theme.colors.border.light};` : ''}
                              ${isCurrent ? `
                                background: ${theme.colors.accent}0a;
                                border-left: 2px solid ${theme.colors.accent};
                                padding-left: calc(${theme.spacing[4]} - 2px);
                              ` : `
                                border-left: 2px solid transparent;
                                padding-left: calc(${theme.spacing[4]} - 2px);
                                &:hover {
                                  background: ${theme.colors.accent}05;
                                }
                              `}
                            `}
                          >
                            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                              <span css={css`
                                width: 16px;
                                height: 16px;
                                border-radius: 50%;
                                border: 2px solid ${isCurrent ? theme.colors.accent : theme.colors.border.default};
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                flex-shrink: 0;
                                transition: all 150ms ease-out;
                                ${isCurrent ? `background: ${theme.colors.accent};` : ''}
                              `}>
                                {isCurrent && (
                                  <span css={css`
                                    width: 5px;
                                    height: 5px;
                                    border-radius: 50%;
                                    background: ${theme.colors.accentForeground};
                                  `} />
                                )}
                              </span>
                              <Typography.SmallBody css={css`
                                font-weight: ${theme.typography.fontWeight.medium};
                              `}>
                                {model.name}
                              </Typography.SmallBody>
                              {isCurrent && (
                                <Badge variant="default" css={css`font-size: 11px;`}>
                                  Current
                                </Badge>
                              )}
                              {model.contextWindow > 0 && (
                                <span css={css`
                                  font-size: 12px;
                                  color: ${theme.colors.text.hint};
                                  margin-left: auto;
                                `}>
                                  {formatTokens(model.contextWindow)} · {formatPrice(model.inputPricePer1M)}/{formatPrice(model.outputPricePer1M)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {overflow > 0 && (
                        <div css={css`
                          padding: ${theme.spacing[2]} ${theme.spacing[4]};
                          border-top: 1px solid ${theme.colors.border.light};
                          font-size: 12px;
                          color: ${theme.colors.text.hint};
                          text-align: center;
                        `}>
                          and {overflow} more matching...
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
          </motion.div>
        )}
        </AnimatePresence>
      </div>

      {/* Divider between provider groups */}
      <div css={css`border-top: 1px solid ${theme.colors.border.light};`} />

      {/* ============ Codex Provider Group ============ */}
      <div>
        {/* Provider header row — clickable to expand/collapse */}
        <button
          onClick={() => setExpandedProviderGroup(expandedProviderGroup === 'codex' ? 'claude' : 'codex')}
          css={css`
            width: 100%;
            display: flex;
            align-items: center;
            gap: ${theme.spacing[2]};
            margin-bottom: ${expandedProviderGroup === 'codex' ? theme.spacing[2] : '0'};
            padding: 0;
            background: transparent;
            cursor: pointer;
            border: none;
            text-align: left;
          `}
        >
          {expandedProviderGroup === 'codex' ? <CaretDown size={12} css={css`color: ${theme.colors.text.hint};`} /> : <CaretRight size={12} css={css`color: ${theme.colors.text.hint};`} />}
          <span css={css`
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: ${hasCredentials('codex') ? theme.colors.success.main : theme.colors.text.disabled};
            flex-shrink: 0;
          `} />
          <Typography.Body as="span" css={css`
            font-weight: ${theme.typography.fontWeight.semibold};
          `}>
            Codex
          </Typography.Body>
          {activeProvider === 'codex' && (
            <Badge variant="default" css={css`
              font-size: ${theme.typography.fontSize.xs};
              background: ${theme.colors.accent}15;
              color: ${theme.colors.accent};
            `}>
              Active
            </Badge>
          )}
          {!hasCredentials('codex') && (
            <span
              onClick={(e) => { e.stopPropagation(); toggleCredentialCard('codex'); }}
              css={css`
                margin-left: auto;
                font-size: 13px;
                color: ${theme.colors.accent};
                cursor: pointer;
                &:hover { text-decoration: underline; }
              `}
            >
              Set up credentials
            </span>
          )}
        </button>

        <AnimatePresence initial={false}>
        {expandedProviderGroup === 'codex' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            css={css`overflow: hidden;`}
          >
        {!hasCredentials('codex') ? (
          <div css={css`
            padding: ${theme.spacing[3]} ${theme.spacing[4]};
            border: 1px solid ${theme.colors.border.light};
            border-radius: ${theme.borderRadius.md};
            text-align: center;
          `}>
            <Typography.SmallBody color="secondary">
              Set up Codex credentials below to select a model.
            </Typography.SmallBody>
          </div>
        ) : (
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
            {/* Recommended Codex models */}
            {codexRecommended.length > 0 && (
              <div css={css`
                border: 1px solid ${theme.colors.border.light};
                border-radius: ${theme.borderRadius.md};
                overflow: hidden;
              `}>
                <div css={css`
                  padding: ${theme.spacing[2]} ${theme.spacing[4]};
                  background: ${theme.colors.background.elevated};
                  border-bottom: 1px solid ${theme.colors.border.light};
                `}>
                  <Typography.SmallBody css={css`
                    font-weight: ${theme.typography.fontWeight.semibold};
                    color: ${theme.colors.text.primary};
                  `}>
                    Recommended
                  </Typography.SmallBody>
                </div>

                {codexRecommended.map((model, idx) => {
                  const isCurrent = model.id === activeModel;
                  return (
                    <div
                      key={model.id}
                      onClick={() => handleModelClick(model)}
                      css={css`
                        padding: ${theme.spacing[3]} ${theme.spacing[4]};
                        cursor: pointer;
                        transition: background 150ms ease-out;
                        position: relative;
                        ${idx > 0 ? `border-top: 1px solid ${theme.colors.border.light};` : ''}
                        ${isCurrent ? `
                          background: ${theme.colors.accent}0a;
                          border-left: 2px solid ${theme.colors.accent};
                          padding-left: calc(${theme.spacing[4]} - 2px);
                        ` : `
                          border-left: 2px solid transparent;
                          padding-left: calc(${theme.spacing[4]} - 2px);
                          &:hover {
                            background: ${theme.colors.accent}05;
                          }
                        `}
                      `}
                    >
                      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; margin-bottom: ${theme.spacing[1]};`}>
                        <span css={css`
                          width: 18px;
                          height: 18px;
                          border-radius: 50%;
                          border: 2px solid ${isCurrent ? theme.colors.accent : theme.colors.border.default};
                          display: flex;
                          align-items: center;
                          justify-content: center;
                          flex-shrink: 0;
                          transition: all 150ms ease-out;
                          ${isCurrent ? `background: ${theme.colors.accent};` : ''}
                        `}>
                          {isCurrent && (
                            <span css={css`
                              width: 6px;
                              height: 6px;
                              border-radius: 50%;
                              background: ${theme.colors.accentForeground};
                            `} />
                          )}
                        </span>
                        <Typography.Body as="span" css={css`
                          font-weight: ${theme.typography.fontWeight.medium};
                          font-size: 15px;
                        `}>
                          {model.name}
                        </Typography.Body>
                        {isCurrent && (
                          <Badge variant="default" css={css`font-size: ${theme.typography.fontSize.xs};`}>
                            Current
                          </Badge>
                        )}
                        {model.isDefault && (
                          <Badge variant="default" css={css`
                            font-size: ${theme.typography.fontSize.xs};
                            background: ${theme.colors.accent}15;
                            color: ${theme.colors.accent};
                          `}>
                            Default
                          </Badge>
                        )}
                      </div>
                      <div css={css`
                        margin-left: 24px;
                        font-size: 13px;
                        color: ${theme.colors.text.secondary};
                        line-height: 1.4;
                      `}>
                        {formatTokens(model.contextWindow)} context · {formatTokens(model.maxOutputTokens)} max output
                      </div>
                      <div css={css`
                        margin-left: 24px;
                        font-size: 13px;
                        color: ${theme.colors.text.secondary};
                        line-height: 1.4;
                      `}>
                        <span css={css`color: ${theme.colors.text.primary};`}>{formatPrice(model.inputPricePer1M)}</span> input /{' '}
                        <span css={css`color: ${theme.colors.text.primary};`}>{formatPrice(model.outputPricePer1M)}</span> output per 1M tokens
                      </div>
                      {(model.supportsVision || model.supportsThinking) && (
                        <div css={css`
                          margin-left: 24px;
                          margin-top: ${theme.spacing[1]};
                          display: flex;
                          gap: ${theme.spacing[1]};
                        `}>
                          {model.supportsVision && (
                            <span css={css`
                              font-size: 12px;
                              padding: 1px ${theme.spacing[1.5]};
                              background: ${theme.colors.background.elevated};
                              border-radius: ${theme.borderRadius.sm};
                              color: ${theme.colors.text.hint};
                            `}>
                              Vision
                            </span>
                          )}
                          {model.supportsThinking && (
                            <span css={css`
                              font-size: 12px;
                              padding: 1px ${theme.spacing[1.5]};
                              background: ${theme.colors.background.elevated};
                              border-radius: ${theme.borderRadius.sm};
                              color: ${theme.colors.text.hint};
                            `}>
                              Thinking
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* All Codex models (collapsible with search) */}
            {codexNonRecommended.length > 0 && (
              <div css={css`
                border: 1px solid ${theme.colors.border.light};
                border-radius: ${theme.borderRadius.md};
                overflow: hidden;
              `}>
                <div css={css`
                  padding: ${theme.spacing[2]} ${theme.spacing[4]};
                  background: ${theme.colors.background.elevated};
                  border-bottom: ${showAllCodexModels || codexModelSearch ? `1px solid ${theme.colors.border.light}` : 'none'};
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  gap: ${theme.spacing[2]};
                `}>
                  <button
                    onClick={() => { setShowAllCodexModels(!showAllCodexModels); setCodexModelSearch(''); }}
                    css={css`
                      display: flex;
                      align-items: center;
                      gap: ${theme.spacing[1.5]};
                      background: transparent;
                      cursor: pointer;
                      padding: 0;
                      color: ${theme.colors.text.secondary};
                      &:hover { color: ${theme.colors.text.primary}; }
                    `}
                  >
                    {showAllCodexModels || codexModelSearch ? <CaretDown size={12} /> : <CaretRight size={12} />}
                    <Typography.SmallBody css={css`
                      font-weight: ${theme.typography.fontWeight.semibold};
                      color: inherit;
                    `}>
                      All Models ({codexNonRecommended.length})
                    </Typography.SmallBody>
                  </button>

                  {(showAllCodexModels || codexModelSearch) && (
                    <div css={css`
                      position: relative;
                      flex: 1;
                      max-width: 240px;
                    `}>
                      <MagnifyingGlass size={14} css={css`
                        position: absolute;
                        left: ${theme.spacing[2]};
                        top: 50%;
                        transform: translateY(-50%);
                        color: ${theme.colors.text.hint};
                        pointer-events: none;
                      `} />
                      <input
                        type="text"
                        value={codexModelSearch}
                        onChange={(e) => setCodexModelSearch(e.target.value)}
                        placeholder="Search models..."
                        css={css`
                          width: 100%;
                          padding: ${theme.spacing[1.5]} ${theme.spacing[3]} ${theme.spacing[1.5]} 2rem;
                          border: 1px solid ${theme.colors.border.default};
                          border-radius: ${theme.borderRadius.md};
                          background: ${theme.colors.background.default};
                          color: ${theme.colors.text.primary};
                          font-size: 13px;
                          outline: none;
                          &:focus {
                            border-color: ${theme.colors.accent};
                          }
                          &::placeholder {
                            color: ${theme.colors.text.hint};
                          }
                        `}
                      />
                    </div>
                  )}
                </div>

                {(showAllCodexModels || codexModelSearch) && (() => {
                  const visible = filteredCodexNonRec.slice(0, MAX_VISIBLE_ALL);
                  const overflow = filteredCodexNonRec.length - visible.length;
                  return (
                    <>
                      {visible.length === 0 && codexModelSearch && (
                        <div css={css`
                          padding: ${theme.spacing[4]};
                          text-align: center;
                          color: ${theme.colors.text.hint};
                          font-size: 13px;
                        `}>
                          No models matching &quot;{codexModelSearch}&quot;
                        </div>
                      )}

                      {visible.map((model, idx) => {
                        const isCurrent = model.id === activeModel;
                        return (
                          <div
                            key={model.id}
                            onClick={() => handleModelClick(model)}
                            css={css`
                              padding: ${theme.spacing[2]} ${theme.spacing[4]};
                              cursor: pointer;
                              transition: background 150ms ease-out;
                              ${idx > 0 ? `border-top: 1px solid ${theme.colors.border.light};` : ''}
                              ${isCurrent ? `
                                background: ${theme.colors.accent}0a;
                                border-left: 2px solid ${theme.colors.accent};
                                padding-left: calc(${theme.spacing[4]} - 2px);
                              ` : `
                                border-left: 2px solid transparent;
                                padding-left: calc(${theme.spacing[4]} - 2px);
                                &:hover {
                                  background: ${theme.colors.accent}05;
                                }
                              `}
                            `}
                          >
                            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                              <span css={css`
                                width: 16px;
                                height: 16px;
                                border-radius: 50%;
                                border: 2px solid ${isCurrent ? theme.colors.accent : theme.colors.border.default};
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                flex-shrink: 0;
                                transition: all 150ms ease-out;
                                ${isCurrent ? `background: ${theme.colors.accent};` : ''}
                              `}>
                                {isCurrent && (
                                  <span css={css`
                                    width: 5px;
                                    height: 5px;
                                    border-radius: 50%;
                                    background: ${theme.colors.accentForeground};
                                  `} />
                                )}
                              </span>
                              <Typography.SmallBody css={css`
                                font-weight: ${theme.typography.fontWeight.medium};
                              `}>
                                {model.name}
                              </Typography.SmallBody>
                              {isCurrent && (
                                <Badge variant="default" css={css`font-size: 11px;`}>
                                  Current
                                </Badge>
                              )}
                              {model.contextWindow > 0 && (
                                <span css={css`
                                  font-size: 12px;
                                  color: ${theme.colors.text.hint};
                                  margin-left: auto;
                                `}>
                                  {formatTokens(model.contextWindow)} · {formatPrice(model.inputPricePer1M)}/{formatPrice(model.outputPricePer1M)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {overflow > 0 && (
                        <div css={css`
                          padding: ${theme.spacing[2]} ${theme.spacing[4]};
                          border-top: 1px solid ${theme.colors.border.light};
                          font-size: 12px;
                          color: ${theme.colors.text.hint};
                          text-align: center;
                        `}>
                          and {overflow} more matching...
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
          </motion.div>
        )}
        </AnimatePresence>
      </div>

      {/* ============ Reasoning Effort ============ */}
      <div css={css`
        ${!activeModelSupportsThinking ? 'opacity: 0.45; pointer-events: none;' : ''}
      `}>
        <Typography.Body as="div" css={css`
          font-weight: ${theme.typography.fontWeight.semibold};
          margin-bottom: ${theme.spacing[1]};
        `}>
          Reasoning Effort
        </Typography.Body>
        <Typography.SmallBody as="div" css={css`
          color: ${theme.colors.text.secondary};
          margin-bottom: ${theme.spacing[2]};
        `}>
          {activeModelSupportsThinking
            ? 'Controls how much the model thinks before responding.'
            : 'Not supported by the current model.'}
        </Typography.SmallBody>
        <div css={css`
          display: flex;
          border: 1px solid ${theme.colors.border.default};
          border-radius: ${theme.borderRadius.md};
          overflow: hidden;
        `}>
          {[
            { value: null, label: 'Default' },
            { value: 'low' as const, label: 'Low' },
            { value: 'medium' as const, label: 'Medium' },
            { value: 'high' as const, label: 'High' },
            { value: 'max' as const, label: 'Max' },
          ].map((effort, idx) => {
            const isSelected = (systemSettings?.reasoningEffort ?? null) === effort.value;
            return (
              <button
                key={effort.label}
                onClick={() => {
                  updateSettingsMutation.mutate({ reasoningEffort: effort.value });
                }}
                css={css`
                  flex: 1;
                  padding: ${theme.spacing[2]} ${theme.spacing[2]};
                  cursor: pointer;
                  transition: all 150ms ease-out;
                  font-size: ${theme.typography.fontSize.sm};
                  font-weight: ${theme.typography.fontWeight.medium};
                  ${idx > 0 ? `border-left: 1px solid ${theme.colors.border.default};` : ''}
                  ${isSelected ? `
                    background: ${theme.colors.accent}15;
                    color: ${theme.colors.accent};
                  ` : `
                    background: transparent;
                    color: ${theme.colors.text.secondary};
                    &:hover {
                      background: ${theme.colors.background.elevated};
                      color: ${theme.colors.text.primary};
                    }
                  `}
                `}
              >
                {effort.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ============ Credentials ============ */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <div>
          <Typography.Body as="div" css={css`
            font-weight: ${theme.typography.fontWeight.semibold};
            margin-bottom: ${theme.spacing[1]};
          `}>
            Credentials
          </Typography.Body>
          <Typography.SmallBody color="secondary">
            API keys and authentication for each provider.
          </Typography.SmallBody>
        </div>

        {/* Claude credential card */}
        <div css={css`
          border: 1px solid ${theme.colors.border.light};
          border-radius: ${theme.borderRadius.md};
          overflow: hidden;
        `}>
          <button
            onClick={() => toggleCredentialCard('claude')}
            css={css`
              width: 100%;
              padding: ${theme.spacing[3]} ${theme.spacing[4]};
              display: flex;
              align-items: center;
              gap: ${theme.spacing[2]};
              background: transparent;
              cursor: pointer;
              border: none;
              text-align: left;
            `}
          >
            <span css={css`
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background: ${hasCredentials('claude') ? theme.colors.success.main : theme.colors.text.disabled};
              flex-shrink: 0;
            `} />
            <Typography.SmallBody css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
              Claude
            </Typography.SmallBody>
            <Badge variant="default" css={css`font-size: 11px;`}>
              {hasCredentials('claude') ? 'Connected' : 'Not configured'}
            </Badge>
            <span css={css`margin-left: auto; color: ${theme.colors.text.hint};`}>
              {credentialsExpandedProvider === 'claude' ? <CaretDown size={12} /> : <CaretRight size={12} />}
            </span>
          </button>
          <AnimatePresence>
            {credentialsExpandedProvider === 'claude' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                css={css`overflow: hidden;`}
              >
                <div css={css`
                  padding: ${theme.spacing[3]} ${theme.spacing[4]};
                  border-top: 1px solid ${theme.colors.border.light};
                  display: flex;
                  flex-direction: column;
                  gap: ${theme.spacing[3]};
                `}>
                  {/* CLI signed-in state */}
                  {claudeCliAvailable && (
                    <div css={css`
                      padding: ${theme.spacing[3]};
                      border-radius: ${theme.borderRadius.sm};
                      border: 1px solid ${theme.colors.success.main}33;
                      background: ${theme.colors.success.main}08;
                      display: flex;
                      align-items: center;
                      justify-content: space-between;
                      gap: ${theme.spacing[3]};
                    `}>
                      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                        <CheckCircle size={18} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
                        <div>
                          <Typography.SmallBody as="div">Claude is signed in</Typography.SmallBody>
                          <Typography.Caption as="div" color="hint">Claude Code CLI authenticated</Typography.Caption>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSignOut('claude')}
                        loading={claudeLogoutMutation.isPending}
                        css={css`flex-shrink: 0;`}
                      >
                        <SignOut size={14} css={css`margin-right: ${theme.spacing[1]};`} />
                        Sign out
                      </Button>
                    </div>
                  )}

                  {/* CLI installed, not authenticated */}
                  {claudeCliInstalled && !claudeCliAvailable && (
                    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                      {claudeOAuthStatus === 'idle' && (
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
                            <Typography.SmallBody as="div">Claude Sign In</Typography.SmallBody>
                            <Typography.Caption as="div" color="hint">Recommended. Opens a browser to sign in.</Typography.Caption>
                          </div>
                          <Button size="sm" onClick={handleClaudeOAuthStart} loading={claudeInitiateMutation.isPending}>
                            Sign in
                          </Button>
                        </div>
                      )}

                      {claudeOAuthStatus === 'pending' && (
                        <div css={css`
                          padding: ${theme.spacing[3]};
                          border: 1px solid ${theme.colors.border.default};
                          border-radius: ${theme.borderRadius.sm};
                          display: flex;
                          flex-direction: column;
                          gap: ${theme.spacing[3]};
                        `}>
                          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                            <CircleNotch
                              size={14}
                              css={css`
                                color: ${theme.colors.text.hint};
                                animation: spin 1s linear infinite;
                                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                              `}
                            />
                            <Typography.SmallBody as="div" color="secondary">
                              Complete sign-in in your browser...
                            </Typography.SmallBody>
                          </div>
                          <Button variant="ghost" size="sm" onClick={handleClaudeOAuthCancel}>
                            Cancel
                          </Button>
                        </div>
                      )}

                      {claudeOAuthStatus === 'success' && (
                        <Typography.SmallBody as="div" color={theme.colors.success.main} css={css`
                          display: flex; align-items: center; gap: ${theme.spacing[2]};
                          padding: ${theme.spacing[2]} ${theme.spacing[3]};
                          background: ${theme.colors.success.main}0d;
                          border-radius: ${theme.borderRadius.sm};
                        `}>
                          <CheckCircle size={16} weight="fill" /> Signed in with Claude
                        </Typography.SmallBody>
                      )}

                      {claudeOAuthStatus === 'error' && (
                        <div css={css`
                          display: flex; align-items: center; justify-content: space-between;
                          padding: ${theme.spacing[2]} ${theme.spacing[3]};
                          background: ${theme.colors.error.main}0d;
                          border-radius: ${theme.borderRadius.sm};
                        `}>
                          <Typography.SmallBody as="span" color={theme.colors.error.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                            <XCircle size={16} weight="fill" /> {claudeOAuthMessage || 'Failed'}
                          </Typography.SmallBody>
                          <Button variant="ghost" size="sm" onClick={() => { setClaudeOAuthStatus('idle'); setClaudeOAuthSession(null); }}>
                            Retry
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Claude OAuth (non-CLI) */}
                  {!claudeCliInstalled && (
                    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                      {claudeOAuthStatus === 'idle' && (
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
                            <Typography.SmallBody as="div">Claude Sign In</Typography.SmallBody>
                            <Typography.Caption as="div" color="hint">Use your Claude subscription (Pro/Max)</Typography.Caption>
                          </div>
                          <Button size="sm" onClick={handleClaudeOAuthStart} loading={claudeInitiateMutation.isPending}>
                            Sign in
                          </Button>
                        </div>
                      )}

                      {claudeOAuthStatus === 'pending' && (
                        <div css={css`
                          padding: ${theme.spacing[3]};
                          border: 1px solid ${theme.colors.border.default};
                          border-radius: ${theme.borderRadius.sm};
                          display: flex;
                          flex-direction: column;
                          gap: ${theme.spacing[3]};
                        `}>
                          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                            <CircleNotch
                              size={14}
                              css={css`
                                color: ${theme.colors.text.hint};
                                animation: spin 1s linear infinite;
                                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                              `}
                            />
                            <Typography.SmallBody as="div" color="secondary">
                              Complete sign-in in your browser...
                            </Typography.SmallBody>
                          </div>
                          <Button variant="ghost" size="sm" onClick={handleClaudeOAuthCancel}>
                            Cancel
                          </Button>
                        </div>
                      )}

                      {claudeOAuthStatus === 'success' && (
                        <Typography.SmallBody as="div" color={theme.colors.success.main} css={css`
                          display: flex; align-items: center; gap: ${theme.spacing[2]};
                          padding: ${theme.spacing[2]} ${theme.spacing[3]};
                          background: ${theme.colors.success.main}0d;
                          border-radius: ${theme.borderRadius.sm};
                        `}>
                          <CheckCircle size={16} weight="fill" /> Signed in with Claude
                        </Typography.SmallBody>
                      )}

                      {claudeOAuthStatus === 'error' && (
                        <div css={css`
                          display: flex; align-items: center; justify-content: space-between;
                          padding: ${theme.spacing[2]} ${theme.spacing[3]};
                          background: ${theme.colors.error.main}0d;
                          border-radius: ${theme.borderRadius.sm};
                        `}>
                          <Typography.SmallBody as="span" color={theme.colors.error.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                            <XCircle size={16} weight="fill" /> {claudeOAuthMessage || 'Failed'}
                          </Typography.SmallBody>
                          <Button variant="ghost" size="sm" onClick={() => { setClaudeOAuthStatus('idle'); setClaudeOAuthSession(null); }}>
                            Retry
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* API key / OAuth token input */}
                  <div css={css`display: flex; gap: ${theme.spacing[2]}; align-items: flex-end;`}>
                    <div css={css`flex: 1;`}>
                      <Input
                        label="API Key or OAuth Token"
                        type={showKey ? 'text' : 'password'}
                        value={credentialInput}
                        onChange={(e) => { setCredentialInput((e.target as HTMLInputElement).value); setValidateResult(null); }}
                        placeholder={hasCredentials('claude') ? '********' : 'sk-ant-api03-... or sk-ant-oat01-...'}
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
                              onClick={() => setShowKey(!showKey)}
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
                      onClick={() => handleValidateAndSave('claude')}
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

                  {hasCredentials('claude') && (
                    <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove('claude')}
                        loading={removeKeyMutation.isPending}
                      >
                        <Trash size={14} css={css`margin-right: ${theme.spacing[1]};`} />
                        Remove credentials
                      </Button>
                    </div>
                  )}

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
        </div>

        {/* Codex credential card */}
        <div css={css`
          border: 1px solid ${theme.colors.border.light};
          border-radius: ${theme.borderRadius.md};
          overflow: hidden;
        `}>
          <button
            onClick={() => toggleCredentialCard('codex')}
            css={css`
              width: 100%;
              padding: ${theme.spacing[3]} ${theme.spacing[4]};
              display: flex;
              align-items: center;
              gap: ${theme.spacing[2]};
              background: transparent;
              cursor: pointer;
              border: none;
              text-align: left;
            `}
          >
            <span css={css`
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background: ${hasCredentials('codex') ? theme.colors.success.main : theme.colors.text.disabled};
              flex-shrink: 0;
            `} />
            <Typography.SmallBody css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
              Codex
            </Typography.SmallBody>
            <Badge variant="default" css={css`font-size: 11px;`}>
              {hasCredentials('codex') ? 'Connected' : 'Not configured'}
            </Badge>
            <span css={css`margin-left: auto; color: ${theme.colors.text.hint};`}>
              {credentialsExpandedProvider === 'codex' ? <CaretDown size={12} /> : <CaretRight size={12} />}
            </span>
          </button>
          <AnimatePresence>
            {credentialsExpandedProvider === 'codex' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                css={css`overflow: hidden;`}
              >
                <div css={css`
                  padding: ${theme.spacing[3]} ${theme.spacing[4]};
                  border-top: 1px solid ${theme.colors.border.light};
                  display: flex;
                  flex-direction: column;
                  gap: ${theme.spacing[3]};
                `}>
                  {/* CLI signed-in state */}
                  {codexCliAvailable && (
                    <div css={css`
                      padding: ${theme.spacing[3]};
                      border-radius: ${theme.borderRadius.sm};
                      border: 1px solid ${theme.colors.success.main}33;
                      background: ${theme.colors.success.main}08;
                      display: flex;
                      align-items: center;
                      justify-content: space-between;
                      gap: ${theme.spacing[3]};
                    `}>
                      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                        <CheckCircle size={18} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
                        <div>
                          <Typography.SmallBody as="div">Codex is signed in</Typography.SmallBody>
                          <Typography.Caption as="div" color="hint">Codex CLI authenticated</Typography.Caption>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSignOut('codex')}
                        loading={codexCliLogoutMutation.isPending}
                        css={css`flex-shrink: 0;`}
                      >
                        <SignOut size={14} css={css`margin-right: ${theme.spacing[1]};`} />
                        Sign out
                      </Button>
                    </div>
                  )}

                  {/* CLI installed, not authenticated */}
                  {codexCliInstalled && !codexCliAvailable && (
                    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                      {codexCliAuthStatus === 'idle' && (
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
                            <Typography.SmallBody as="div">ChatGPT Sign In</Typography.SmallBody>
                            <Typography.Caption as="div" color="hint">Recommended. Opens a browser to sign in.</Typography.Caption>
                          </div>
                          <Button size="sm" onClick={handleCodexCliAuthStart} loading={codexCliInitiateMutation.isPending}>
                            Sign in
                          </Button>
                        </div>
                      )}

                      {codexCliAuthStatus === 'pending' && (
                        <div css={css`
                          padding: ${theme.spacing[3]};
                          border: 1px solid ${theme.colors.border.default};
                          border-radius: ${theme.borderRadius.sm};
                          display: flex;
                          flex-direction: column;
                          gap: ${theme.spacing[3]};
                        `}>
                          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                            <CircleNotch
                              size={14}
                              css={css`
                                color: ${theme.colors.text.hint};
                                animation: spin 1s linear infinite;
                                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                              `}
                            />
                            <Typography.SmallBody as="div" color="secondary">
                              Complete sign-in in your browser...
                            </Typography.SmallBody>
                          </div>
                          <Button variant="ghost" size="sm" onClick={handleCodexCliAuthCancel}>
                            Cancel
                          </Button>
                        </div>
                      )}

                      {codexCliAuthStatus === 'success' && (
                        <Typography.SmallBody as="div" color={theme.colors.success.main} css={css`
                          display: flex; align-items: center; gap: ${theme.spacing[2]};
                          padding: ${theme.spacing[2]} ${theme.spacing[3]};
                          background: ${theme.colors.success.main}0d;
                          border-radius: ${theme.borderRadius.sm};
                        `}>
                          <CheckCircle size={16} weight="fill" /> Signed in with ChatGPT
                        </Typography.SmallBody>
                      )}

                      {codexCliAuthStatus === 'error' && (
                        <div css={css`
                          display: flex; align-items: center; justify-content: space-between;
                          padding: ${theme.spacing[2]} ${theme.spacing[3]};
                          background: ${theme.colors.error.main}0d;
                          border-radius: ${theme.borderRadius.sm};
                        `}>
                          <Typography.SmallBody as="span" color={theme.colors.error.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                            <XCircle size={16} weight="fill" /> {codexCliAuthMessage || 'Failed'}
                          </Typography.SmallBody>
                          <Button variant="ghost" size="sm" onClick={() => { setCodexCliAuthStatus('idle'); setCodexCliAuthSession(null); }}>
                            Retry
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Codex device-code OAuth */}
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
                          <Typography.SmallBody as="div">ChatGPT Device Code</Typography.SmallBody>
                          <Typography.Caption as="div" color="hint">Use your ChatGPT subscription via device code</Typography.Caption>
                        </div>
                        <Button size="sm" variant="secondary" onClick={handleCodexOAuthStart} loading={codexInitiateMutation.isPending}>
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
                            onClick={() => handleCopyCode(codexOAuthData.userCode)}
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
                          <Typography.Caption color="hint">Waiting...</Typography.Caption>
                          {codexCountdown > 0 && (
                            <Typography.Caption color="disabled" css={css`margin-left: auto;`}>
                              {formatCountdown(codexCountdown)}
                            </Typography.Caption>
                          )}
                        </div>
                        <Button variant="ghost" size="sm" onClick={handleCodexOAuthCancel}>
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
                        <Button variant="ghost" size="sm" onClick={() => { setCodexOAuthStatus('idle'); setCodexOAuthSession(null); setCodexOAuthData(null); }}>
                          Retry
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* API key input */}
                  <div css={css`display: flex; gap: ${theme.spacing[2]}; align-items: flex-end;`}>
                    <div css={css`flex: 1;`}>
                      <Input
                        label="API Key"
                        type={showKey ? 'text' : 'password'}
                        value={credentialInput}
                        onChange={(e) => { setCredentialInput((e.target as HTMLInputElement).value); setValidateResult(null); }}
                        placeholder={hasCredentials('codex') ? '********' : 'sk-proj-...'}
                        rightElement={
                          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[1.5]};`}>
                            <Tooltip content="Encrypted at rest and injected securely at runtime" position="top" align="right">
                              <ShieldCheck size={16} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
                            </Tooltip>
                            <button
                              onClick={() => setShowKey(!showKey)}
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
                      onClick={() => handleValidateAndSave('codex')}
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

                  {hasCredentials('codex') && (
                    <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove('codex')}
                        loading={removeKeyMutation.isPending}
                      >
                        <Trash size={14} css={css`margin-right: ${theme.spacing[1]};`} />
                        Remove credentials
                      </Button>
                    </div>
                  )}

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
        </div>
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
      {/* Author & license */}
      {(detail.author || detail.license) && (
        <div css={css`display: flex; gap: ${theme.spacing[6]};`}>
          {detail.author && (
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
          )}
          {detail.license && (
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[0.5]};`}>
              <Typography.Tiny as="span" css={css`
                color: ${theme.colors.text.disabled};
                text-transform: uppercase;
                letter-spacing: 0.06em;
                font-weight: ${theme.typography.fontWeight.medium};
              `}>License</Typography.Tiny>
              <Typography.Caption as="span" color="secondary">
                {detail.license}
              </Typography.Caption>
            </div>
          )}
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
        </div>
      )}

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
      case 'provider': return <ProviderSection />;
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
