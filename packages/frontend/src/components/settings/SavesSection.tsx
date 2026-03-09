/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useRef } from 'react';
import {
  FloppyDisk,
  Plus,
  DownloadSimple,
  Upload,
  Trash,
  ArrowCounterClockwise,
  Warning,
  CircleNotch,
  ArrowsClockwise,
  CaretDown,
  CaretUp,
} from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'motion/react';
import { Button, Input, Modal, Typography, Card, Toggle, Select } from '../ui';
import { trpc } from '../../utils/trpc';
import { toast } from '../../store/toast-store';

// ============================================================================
// Types
// ============================================================================

interface SaveInfo {
  id: string;
  manifest: {
    version: 1;
    name: string;
    description?: string;
    createdAt: string;
    animusVersion: string;
    schemaVersions: Record<string, number>;
    stats: { tickCount: number; messageCount: number; memoryCount: number; personaName?: string };
    isAutosave?: boolean;
  };
  sizeBytes: number;
  isAutosave: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const FREQUENCY_OPTIONS = [
  { value: '1h', label: 'Every hour' },
  { value: '6h', label: 'Every 6 hours' },
  { value: '12h', label: 'Every 12 hours' },
  { value: '24h', label: 'Every 24 hours' },
  { value: '3d', label: 'Every 3 days' },
  { value: '7d', label: 'Every 7 days' },
];

const TIME_OF_DAY_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const hour12 = i === 0 ? 12 : i > 12 ? i - 12 : i;
  const period = i < 12 ? 'AM' : 'PM';
  return { value: String(i), label: `${hour12}:00 ${period}` };
});

const MAX_COUNT_OPTIONS = [
  { value: '3', label: '3' },
  { value: '5', label: '5' },
  { value: '10', label: '10' },
  { value: '15', label: '15' },
  { value: '20', label: '20' },
];

const FREQUENCIES_WITH_TIME = new Set(['12h', '24h', '3d', '7d']);

// ============================================================================
// Helpers
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatScheduledTime(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ============================================================================
// Collapsible Section Header
// ============================================================================

function SectionHeader({
  title,
  collapsed,
  onToggle,
  right,
  collapsible = true,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  right?: React.ReactNode;
  collapsible?: boolean;
}) {
  const theme = useTheme();
  const Icon = collapsed ? CaretDown : CaretUp;

  return (
    <div css={css`
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: ${theme.spacing[3]};
    `}>
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          css={css`
            display: flex;
            align-items: center;
            gap: ${theme.spacing[2]};
            background: none;
            border: none;
            padding: 0;
            cursor: pointer;
            color: ${theme.colors.text.primary};
            font-family: inherit;
          `}
        >
          <Typography.SmallBodyAlt>{title}</Typography.SmallBodyAlt>
          <Icon size={14} css={css`color: ${theme.colors.text.hint};`} />
        </button>
      ) : (
        <Typography.SmallBodyAlt>{title}</Typography.SmallBodyAlt>
      )}
      {right && <div css={css`display: flex; gap: ${theme.spacing[2]};`}>{right}</div>}
    </div>
  );
}

// ============================================================================
// Save Card (shared between manual and autosave)
// ============================================================================

function SaveCard({
  save,
  onRestore,
  onExport,
  onDelete,
  isExporting,
}: {
  save: SaveInfo;
  onRestore: () => void;
  onExport: () => void;
  onDelete?: () => void;
  isExporting: boolean;
}) {
  const theme = useTheme();
  const isAutosave = save.isAutosave;

  return (
    <Card variant="outlined" padding="md">
      <div css={css`
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: ${theme.spacing[4]};

        @media (max-width: ${theme.breakpoints.sm}) {
          flex-direction: column;
        }
      `}>
        {/* Save info */}
        <div css={css`flex: 1; min-width: 0;`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            {isAutosave && (
              <ArrowsClockwise
                size={14}
                css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`}
              />
            )}
            <Typography.SmallBodyAlt css={css`
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `}>
              {isAutosave ? 'Autosave' : save.manifest.name}
            </Typography.SmallBodyAlt>
          </div>
          {!isAutosave && save.manifest.description && (
            <Typography.Caption color="secondary" css={css`
              margin-top: ${theme.spacing[0.5]};
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
              overflow: hidden;
            `}>
              {save.manifest.description}
            </Typography.Caption>
          )}
          <div css={css`
            display: flex;
            flex-wrap: wrap;
            gap: ${theme.spacing[3]};
            margin-top: ${theme.spacing[2]};
          `}>
            <Typography.Caption color="hint">
              {formatDate(save.manifest.createdAt)}
            </Typography.Caption>
            {save.manifest.stats.personaName && (
              <Typography.Caption color="hint">
                {save.manifest.stats.personaName}
              </Typography.Caption>
            )}
            <Typography.Caption color="hint">
              Tick #{save.manifest.stats.tickCount.toLocaleString()}
            </Typography.Caption>
            <Typography.Caption color="hint">
              {formatBytes(save.sizeBytes)}
            </Typography.Caption>
          </div>
        </div>

        {/* Actions */}
        <div css={css`
          display: flex;
          gap: ${theme.spacing[1]};
          flex-shrink: 0;
        `}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRestore}
            title="Restore"
          >
            <ArrowCounterClockwise size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onExport}
            disabled={isExporting}
            title="Export"
          >
            {isExporting
              ? <CircleNotch size={16} css={css`animation: spin 800ms linear infinite; @keyframes spin { to { transform: rotate(360deg); } }`} />
              : <DownloadSimple size={16} />
            }
          </Button>
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              title="Delete"
            >
              <Trash size={16} />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ============================================================================
// Autosave Banner
// ============================================================================

function AutosaveBanner() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: systemSettings } = trpc.settings.getSystemSettings.useQuery();
  const { data: autosaveStatus } = trpc.saves.autosaveStatus.useQuery();
  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation({
    onSuccess: () => {
      utils.settings.getSystemSettings.invalidate();
      utils.saves.autosaveStatus.invalidate();
    },
  });

  const [configExpanded, setConfigExpanded] = useState(false);

  const enabled = systemSettings?.autosaveEnabled ?? false;
  const frequency = systemSettings?.autosaveFrequency ?? '24h';
  const timeOfDay = systemSettings?.autosaveTimeOfDay ?? 3;
  const maxCount = systemSettings?.autosaveMaxCount ?? 5;

  const showTimeOfDay = FREQUENCIES_WITH_TIME.has(frequency);

  const handleToggle = (checked: boolean) => {
    updateSettingsMutation.mutate({ autosaveEnabled: checked });
  };

  const handleFrequencyChange = (value: string) => {
    updateSettingsMutation.mutate({ autosaveFrequency: value as '1h' | '6h' | '12h' | '24h' | '3d' | '7d' });
  };

  const handleTimeOfDayChange = (value: string) => {
    updateSettingsMutation.mutate({ autosaveTimeOfDay: parseInt(value, 10) });
  };

  const handleMaxCountChange = (value: string) => {
    updateSettingsMutation.mutate({ autosaveMaxCount: parseInt(value, 10) });
  };

  const ConfigIcon = configExpanded ? CaretUp : CaretDown;

  return (
    <div>
      {/* Row 1: Toggle + last autosave */}
      <div css={css`
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: ${theme.spacing[3]};
      `}>
        <Typography.SmallBodyAlt>Autosave</Typography.SmallBodyAlt>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
          {enabled && (
            <Typography.Caption color="hint">
              Last: {formatRelativeTime(autosaveStatus?.lastAutosaveAt)}
            </Typography.Caption>
          )}
          <Toggle checked={enabled} onChange={handleToggle} />
        </div>
      </div>

      {/* Configure button */}
      {enabled && (
        <div css={css`margin-top: ${theme.spacing[2]};`}>
          <button
            type="button"
            onClick={() => setConfigExpanded(!configExpanded)}
            css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[1]};
              background: none;
              border: none;
              padding: 0;
              cursor: pointer;
              color: ${theme.colors.text.secondary};
              font-family: inherit;
              font-size: ${theme.typography.fontSize.xs};
              transition: color ${theme.transitions.fast};

              &:hover {
                color: ${theme.colors.text.primary};
              }
            `}
          >
            Configure
            <ConfigIcon size={12} />
          </button>
        </div>
      )}

      {/* Row 2: Config (collapsible) */}
      <AnimatePresence>
        {enabled && configExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
            animate={{ height: 'auto', opacity: 1, overflow: 'visible', transitionEnd: { overflow: 'visible' } }}
            exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div css={css`
              display: flex;
              flex-wrap: wrap;
              gap: ${theme.spacing[4]};
              margin-top: ${theme.spacing[4]};
            `}>
              <div css={css`flex: 1; min-width: 140px;`}>
                <Select
                  label="Frequency"
                  options={FREQUENCY_OPTIONS}
                  value={frequency}
                  onChange={handleFrequencyChange}
                />
              </div>

              {showTimeOfDay && (
                <div css={css`flex: 1; min-width: 140px;`}>
                  <Select
                    label="Time of day"
                    options={TIME_OF_DAY_OPTIONS}
                    value={String(timeOfDay)}
                    onChange={handleTimeOfDayChange}
                  />
                </div>
              )}

              <div css={css`flex: 1; min-width: 100px;`}>
                <Select
                  label="Max saves"
                  options={MAX_COUNT_OPTIONS}
                  value={String(maxCount)}
                  onChange={handleMaxCountChange}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// SavesSection
// ============================================================================

export function SavesSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Data
  const { data: saves, isLoading: savesLoading } = trpc.saves.list.useQuery();
  const { data: autosaves, isLoading: autosavesLoading } = trpc.saves.listAutosaves.useQuery();
  const { data: systemSettings } = trpc.settings.getSystemSettings.useQuery();
  const { data: autosaveStatus } = trpc.saves.autosaveStatus.useQuery();

  const createMutation = trpc.saves.create.useMutation({
    onSuccess: () => utils.saves.list.invalidate(),
  });
  const deleteMutation = trpc.saves.delete.useMutation({
    onSuccess: () => utils.saves.list.invalidate(),
  });
  const restoreMutation = trpc.saves.restore.useMutation({
    onSuccess: () => {
      utils.saves.list.invalidate();
      utils.saves.listAutosaves.invalidate();
    },
  });

  // Modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');

  const [restoreTarget, setRestoreTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const [exportingId, setExportingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Autosave expansion state
  const [showOlderAutosaves, setShowOlderAutosaves] = useState(false);

  // Derived state
  const autosaveEnabled = systemSettings?.autosaveEnabled ?? false;
  const autosaveMaxCount = systemSettings?.autosaveMaxCount ?? 5;
  const isLoading = savesLoading || autosavesLoading;

  // Handlers
  const handleCreate = () => {
    if (!createName.trim()) return;
    createMutation.mutate(
      { name: createName.trim(), description: createDescription.trim() || undefined },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setCreateName('');
          setCreateDescription('');
        },
      },
    );
  };

  const handleRestore = () => {
    if (!restoreTarget) return;
    const name = restoreTarget.name;
    restoreMutation.mutate({ id: restoreTarget.id }, {
      onSuccess: () => {
        setRestoreTarget(null);
        toast.success(`Restored from "${name}" successfully.`);
      },
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate({ id: deleteTarget.id }, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  const handleExport = async (saveId: string, saveName: string) => {
    setExportingId(saveId);
    try {
      const response = await fetch(`/api/saves/${saveId}/export`, { credentials: 'include' });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${saveName.replace(/[^a-zA-Z0-9_-]/g, '_')}.animus`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Export failed silently
    } finally {
      setExportingId(null);
    }
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const response = await fetch('/api/saves/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        credentials: 'include',
        body: buffer,
      });
      if (!response.ok) throw new Error('Import failed');
      utils.saves.list.invalidate();
    } catch {
      // Import failed silently
    } finally {
      setImporting(false);
    }
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* Page Header */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Saves
        </Typography.Subtitle>
        <Typography.SmallBody color="secondary">
          Create snapshots of your Animus's state. Restore to roll back memories, emotions, and conversations.
        </Typography.SmallBody>
      </div>

      {/* Autosave Banner */}
      <AutosaveBanner />

      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".animus"
        css={css`display: none;`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleImport(file);
            e.target.value = '';
          }
        }}
      />

      {/* Loading state */}
      {isLoading && (
        <div css={css`
          display: flex;
          align-items: center;
          justify-content: center;
          padding: ${theme.spacing[10]} 0;
          color: ${theme.colors.text.secondary};
        `}>
          <CircleNotch size={24} css={css`animation: spin 800ms linear infinite; @keyframes spin { to { transform: rotate(360deg); } }`} />
        </div>
      )}

      {/* Autosaves Section */}
      {!isLoading && (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          <Typography.SmallBodyAlt>
            Autosaves{autosaves && autosaves.length > 0 ? ` (${autosaves.length} of ${autosaveMaxCount})` : ''}
          </Typography.SmallBodyAlt>

          {(!autosaves || autosaves.length === 0) ? (
            <Card variant="outlined" padding="lg">
              <div css={css`
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: ${theme.spacing[3]};
                text-align: center;
                padding: ${theme.spacing[4]} 0;
              `}>
                <ArrowsClockwise size={32} weight="light" css={css`color: ${theme.colors.text.disabled};`} />
                <Typography.SmallBody color="secondary">
                  {autosaveEnabled
                    ? `No autosaves yet. The next autosave is scheduled for ${formatScheduledTime(autosaveStatus?.nextAutosaveAt)}.`
                    : 'Autosave is disabled.'
                  }
                </Typography.SmallBody>
              </div>
            </Card>
          ) : (
            <>
              {/* Most recent autosave always visible */}
              <SaveCard
                key={autosaves[0]!.id}
                save={autosaves[0]!}
                onRestore={() => setRestoreTarget({ id: autosaves[0]!.id, name: 'Autosave' })}
                onExport={() => handleExport(autosaves[0]!.id, `autosave_${autosaves[0]!.manifest.createdAt.slice(0, 10)}`)}
                isExporting={exportingId === autosaves[0]!.id}
              />

              {/* Older autosaves behind expansion */}
              {autosaves.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowOlderAutosaves(!showOlderAutosaves)}
                    css={css`
                      display: flex;
                      align-items: center;
                      gap: ${theme.spacing[1]};
                      background: none;
                      border: none;
                      padding: 0;
                      cursor: pointer;
                      color: ${theme.colors.text.secondary};
                      font-family: inherit;
                      font-size: ${theme.typography.fontSize.xs};
                      transition: color ${theme.transitions.fast};
                      align-self: flex-start;

                      &:hover {
                        color: ${theme.colors.text.primary};
                      }
                    `}
                  >
                    {showOlderAutosaves ? 'Hide' : `Show ${autosaves.length - 1} older`}
                    {showOlderAutosaves ? <CaretUp size={12} /> : <CaretDown size={12} />}
                  </button>

                  <AnimatePresence initial={false}>
                    {showOlderAutosaves && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        css={css`overflow: hidden;`}
                      >
                        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
                          {autosaves.slice(1).map((save: SaveInfo) => (
                            <SaveCard
                              key={save.id}
                              save={save}
                              onRestore={() => setRestoreTarget({ id: save.id, name: 'Autosave' })}
                              onExport={() => handleExport(save.id, `autosave_${save.manifest.createdAt.slice(0, 10)}`)}
                              isExporting={exportingId === save.id}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Manual Saves Section */}
      {!isLoading && (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          <SectionHeader
            title="Manual Saves"
            collapsed={false}
            onToggle={() => {}}
            collapsible={false}
            right={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                >
                  {importing ? <CircleNotch size={16} css={css`animation: spin 800ms linear infinite; @keyframes spin { to { transform: rotate(360deg); } }`} /> : <Upload size={16} />}
                  Import
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus size={16} />
                  New Save
                </Button>
              </>
            }
          />

          {!saves?.length ? (
            <Card variant="outlined" padding="lg">
              <div css={css`
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: ${theme.spacing[3]};
                text-align: center;
                padding: ${theme.spacing[4]} 0;
              `}>
                <FloppyDisk size={40} weight="light" css={css`color: ${theme.colors.text.disabled};`} />
                <Typography.SmallBody color="secondary">
                  No saves yet. Create your first save to snapshot your Animus's current state.
                </Typography.SmallBody>
              </div>
            </Card>
          ) : (
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
              {saves.map((save: SaveInfo) => (
                <SaveCard
                  key={save.id}
                  save={save}
                  onRestore={() => setRestoreTarget({ id: save.id, name: save.manifest.name })}
                  onExport={() => handleExport(save.id, save.manifest.name)}
                  onDelete={() => setDeleteTarget({ id: save.id, name: save.manifest.name })}
                  isExporting={exportingId === save.id}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
          <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            New Save
          </Typography.Subtitle>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            <div>
              <Typography.SmallBodyAlt as="label" css={css`display: block; margin-bottom: ${theme.spacing[1.5]};`}>
                Name
              </Typography.SmallBodyAlt>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Before personality tweak"
                maxLength={100}
                autoFocus
              />
            </div>
            <div>
              <Typography.SmallBodyAlt as="label" css={css`display: block; margin-bottom: ${theme.spacing[1.5]};`}>
                Description
              </Typography.SmallBodyAlt>
              <textarea
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="Optional notes about this save..."
                maxLength={500}
                rows={3}
                css={css`
                  width: 100%;
                  padding: ${theme.spacing[2]} ${theme.spacing[3]};
                  border: 1px solid ${theme.colors.border.default};
                  border-radius: ${theme.borderRadius.default};
                  background: ${theme.colors.background.paper};
                  color: ${theme.colors.text.primary};
                  font-family: inherit;
                  font-size: ${theme.typography.fontSize.sm};
                  line-height: ${theme.typography.lineHeight.normal};
                  resize: vertical;
                  outline: none;
                  transition: border-color ${theme.transitions.fast};

                  &:focus {
                    border-color: ${theme.colors.border.focus};
                  }

                  &::placeholder {
                    color: ${theme.colors.text.hint};
                  }
                `}
              />
            </div>
          </div>
          <div css={css`display: flex; justify-content: flex-end; gap: ${theme.spacing[2]};`}>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreate}
              disabled={!createName.trim()}
              loading={createMutation.isPending}
            >
              <FloppyDisk size={16} />
              Create Save
            </Button>
          </div>
        </div>
      </Modal>

      {/* Restore Confirmation Modal */}
      <Modal open={!!restoreTarget} onClose={() => setRestoreTarget(null)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            <Warning size={24} css={css`color: ${theme.colors.warning.main}; flex-shrink: 0;`} />
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              Restore Save
            </Typography.Subtitle>
          </div>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
            <Typography.SmallBody color="secondary">
              This will replace ALL current AI state including memories, emotions, and conversation history with the state from this save. This action cannot be undone.
            </Typography.SmallBody>
            {restoreTarget && (
              <Typography.SmallBodyAlt>
                {restoreTarget.name}
              </Typography.SmallBodyAlt>
            )}
          </div>
          <div css={css`display: flex; justify-content: flex-end; gap: ${theme.spacing[2]};`}>
            <Button variant="ghost" size="sm" onClick={() => setRestoreTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleRestore}
              loading={restoreMutation.isPending}
            >
              Restore
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
          <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            Delete Save
          </Typography.Subtitle>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
            <Typography.SmallBody color="secondary">
              Are you sure you want to delete this save? This action cannot be undone.
            </Typography.SmallBody>
            {deleteTarget && (
              <Typography.SmallBodyAlt>
                {deleteTarget.name}
              </Typography.SmallBodyAlt>
            )}
          </div>
          <div css={css`display: flex; justify-content: flex-end; gap: ${theme.spacing[2]};`}>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              loading={deleteMutation.isPending}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
