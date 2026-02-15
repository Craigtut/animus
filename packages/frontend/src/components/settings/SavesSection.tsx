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
} from '@phosphor-icons/react';
import { Button, Input, Modal, Typography, Card } from '../ui';
import { trpc } from '../../utils/trpc';

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

// ============================================================================
// SavesSection
// ============================================================================

export function SavesSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Data
  const { data: saves, isLoading } = trpc.saves.list.useQuery();
  const createMutation = trpc.saves.create.useMutation({
    onSuccess: () => utils.saves.list.invalidate(),
  });
  const deleteMutation = trpc.saves.delete.useMutation({
    onSuccess: () => utils.saves.list.invalidate(),
  });
  const restoreMutation = trpc.saves.restore.useMutation({
    onSuccess: () => utils.saves.list.invalidate(),
  });

  // Modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');

  const [restoreTarget, setRestoreTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const [exportingId, setExportingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

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
    restoreMutation.mutate({ id: restoreTarget.id }, {
      onSuccess: () => setRestoreTarget(null),
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
      {/* Header */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <div css={css`
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: ${theme.spacing[3]};
        `}>
          <div>
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              Saves
            </Typography.Subtitle>
            <Typography.SmallBody color="secondary" css={css`margin-top: ${theme.spacing[1]};`}>
              Create snapshots of your Animus's state. Restore to roll back memories, emotions, and conversations.
            </Typography.SmallBody>
          </div>
          <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
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
          </div>
        </div>
      </div>

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

      {/* Save List */}
      {isLoading ? (
        <div css={css`
          display: flex;
          align-items: center;
          justify-content: center;
          padding: ${theme.spacing[10]} 0;
          color: ${theme.colors.text.secondary};
        `}>
          <CircleNotch size={24} css={css`animation: spin 800ms linear infinite; @keyframes spin { to { transform: rotate(360deg); } }`} />
        </div>
      ) : !saves?.length ? (
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
          {saves.map((save) => (
            <Card key={save.id} variant="outlined" padding="md">
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
                  <Typography.SmallBodyAlt css={css`
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                  `}>
                    {save.manifest.name}
                  </Typography.SmallBodyAlt>
                  {save.manifest.description && (
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
                    onClick={() => setRestoreTarget({ id: save.id, name: save.manifest.name })}
                    title="Restore"
                  >
                    <ArrowCounterClockwise size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleExport(save.id, save.manifest.name)}
                    disabled={exportingId === save.id}
                    title="Export"
                  >
                    {exportingId === save.id
                      ? <CircleNotch size={16} css={css`animation: spin 800ms linear infinite; @keyframes spin { to { transform: rotate(360deg); } }`} />
                      : <DownloadSimple size={16} />
                    }
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget({ id: save.id, name: save.manifest.name })}
                    title="Delete"
                  >
                    <Trash size={16} />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
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
