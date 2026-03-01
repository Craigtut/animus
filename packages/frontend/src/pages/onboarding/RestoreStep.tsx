/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Upload,
  File,
  XCircle,
  CircleNotch,
  Warning,
  ArrowCounterClockwise,
} from '@phosphor-icons/react';
import { Button, Typography } from '../../components/ui';
import { OnboardingNav } from './OnboardingNav';
import { trpc } from '../../utils/trpc';
import type { SaveInfo } from '@animus-labs/shared';

type RestoreState =
  | { status: 'idle' }
  | { status: 'uploading'; filename: string }
  | { status: 'uploaded'; saveInfo: SaveInfo; filename: string }
  | { status: 'restoring' }
  | { status: 'error'; message: string };

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

export function RestoreStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [state, setState] = useState<RestoreState>({ status: 'idle' });

  const utils = trpc.useUtils();
  const restoreMutation = trpc.saves.restore.useMutation();
  const completeMutation = trpc.onboarding.completeFromRestore.useMutation();

  const uploadFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.animus')) {
      setState({ status: 'error', message: 'Only .animus save files are accepted' });
      return;
    }

    setState({ status: 'uploading', filename: file.name });

    try {
      const buffer = await file.arrayBuffer();
      const response = await fetch('/api/saves/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        credentials: 'include',
        body: buffer,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Import failed' }));
        throw new Error(err.message || `Import failed (${response.status})`);
      }

      const saveInfo = (await response.json()) as SaveInfo;
      setState({ status: 'uploaded', saveInfo, filename: file.name });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Import failed',
      });
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile],
  );

  const handleBrowse = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [uploadFile],
  );

  const handleReset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  const handleRestore = useCallback(() => {
    if (state.status !== 'uploaded') return;
    const saveId = state.saveInfo.id;

    setState({ status: 'restoring' });

    restoreMutation.mutate(
      { id: saveId },
      {
        onSuccess: () => {
          completeMutation.mutate(undefined, {
            onSuccess: () => {
              // Update the cached onboarding state so AuthGuard sees isComplete: true
              // when the user navigates to "/" after the AgentProviderStep.
              // Without this, the stale cached value (isComplete: false) causes
              // a redirect loop back to the welcome screen.
              utils.onboarding.getState.setData(undefined, { isComplete: true, currentStep: 8 });
              navigate('/onboarding/agent');
            },
            onError: (err) => {
              setState({
                status: 'error',
                message: err.message || 'Failed to complete onboarding after restore',
              });
            },
          });
        },
        onError: (err) => {
          setState({
            status: 'error',
            message: err.message || 'Restore failed',
          });
        },
      },
    );
  }, [state, restoreMutation, completeMutation, navigate]);

  const handleBack = () => navigate('/onboarding/welcome');

  const isRestoring = state.status === 'restoring';
  const canRestore = state.status === 'uploaded';

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* Header */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <Typography.Body color="secondary" serif css={css`font-style: italic;`}>
          Pick up where you left off
        </Typography.Body>
        <Typography.Title3 as="h2" css={css`
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          Restore from a save
        </Typography.Title3>
        <Typography.SmallBody color="secondary" css={css`margin-top: ${theme.spacing[1]};`}>
          Upload a previously exported <Typography.SmallBodyAlt as="span">.animus</Typography.SmallBodyAlt> save
          file to restore your AI's memories, personality, and conversation history.
        </Typography.SmallBody>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".animus"
        onChange={handleFileInputChange}
        css={css`display: none;`}
      />

      {/* Drop zone / upload states */}
      <AnimatePresence mode="wait">
        {(state.status === 'idle' || state.status === 'error') && (
          <motion.div
            key="dropzone"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleBrowse}
            css={css`
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: ${theme.spacing[2]};
              padding: ${theme.spacing[8]} ${theme.spacing[4]};
              border: 2px dashed ${isDragOver ? theme.colors.accent : theme.colors.border.default};
              border-radius: ${theme.borderRadius.lg};
              background: ${isDragOver ? `${theme.colors.accent}0a` : theme.colors.background.paper};
              cursor: pointer;
              transition: all ${theme.transitions.micro};

              &:hover {
                border-color: ${theme.colors.accent};
                background: ${theme.colors.accent}08;
              }
            `}
          >
            <Upload
              size={36}
              weight={isDragOver ? 'fill' : 'regular'}
              css={css`
                color: ${isDragOver ? theme.colors.accent : theme.colors.text.hint};
                transition: all ${theme.transitions.micro};
              `}
            />
            <div css={css`text-align: center;`}>
              <Typography.SmallBody color="secondary">
                Drag & drop an <Typography.SmallBodyAlt as="span" css={css`color: ${theme.colors.text.primary};`}>.animus</Typography.SmallBodyAlt> save file here
              </Typography.SmallBody>
              <Typography.Caption as="div" color="hint" css={css`margin-top: ${theme.spacing[1]};`}>
                or click to browse
              </Typography.Caption>
            </div>
          </motion.div>
        )}

        {state.status === 'uploading' && (
          <motion.div
            key="uploading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[3]};
              padding: ${theme.spacing[5]};
              border: 1px solid ${theme.colors.border.default};
              border-radius: ${theme.borderRadius.lg};
              background: ${theme.colors.background.paper};
            `}
          >
            <CircleNotch
              size={20}
              css={css`
                color: ${theme.colors.accent};
                flex-shrink: 0;
                animation: spin 1s linear infinite;
                @keyframes spin { to { transform: rotate(360deg); } }
              `}
            />
            <Typography.SmallBody css={css`
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `}>
              Uploading {state.filename}...
            </Typography.SmallBody>
          </motion.div>
        )}

        {state.status === 'uploaded' && (
          <motion.div
            key="uploaded"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            css={css`
              display: flex;
              flex-direction: column;
              gap: ${theme.spacing[4]};
              padding: ${theme.spacing[5]};
              border: 1px solid ${theme.colors.success.main}33;
              border-radius: ${theme.borderRadius.lg};
              background: ${theme.colors.success.main}08;
            `}
          >
            {/* File info row */}
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
              <File
                size={20}
                weight="fill"
                css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`}
              />
              <div css={css`flex: 1; min-width: 0;`}>
                <Typography.SmallBodyAlt css={css`
                  overflow: hidden;
                  text-overflow: ellipsis;
                  white-space: nowrap;
                `}>
                  {state.filename}
                </Typography.SmallBodyAlt>
                <Typography.Caption as="div" color="hint">
                  {formatBytes(state.saveInfo.sizeBytes)}
                </Typography.Caption>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleReset(); }}
                css={css`
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: ${theme.spacing[1]};
                  color: ${theme.colors.text.hint};
                  cursor: pointer;
                  border-radius: ${theme.borderRadius.default};
                  transition: all ${theme.transitions.micro};
                  background: none;
                  border: none;
                  &:hover { color: ${theme.colors.text.primary}; background: ${theme.colors.background.elevated}; }
                `}
                title="Remove and choose a different file"
              >
                <XCircle size={16} />
              </button>
            </div>

            {/* Manifest preview */}
            <div css={css`
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: ${theme.spacing[2]} ${theme.spacing[4]};
              padding: ${theme.spacing[3]} ${theme.spacing[4]};
              background: ${theme.colors.background.paper};
              border-radius: ${theme.borderRadius.default};
              border: 1px solid ${theme.colors.border.default};
            `}>
              {state.saveInfo.manifest.stats.personaName && (
                <div>
                  <Typography.Caption color="hint">Persona</Typography.Caption>
                  <Typography.SmallBody>{state.saveInfo.manifest.stats.personaName}</Typography.SmallBody>
                </div>
              )}
              <div>
                <Typography.Caption color="hint">Created</Typography.Caption>
                <Typography.SmallBody>{formatDate(state.saveInfo.manifest.createdAt)}</Typography.SmallBody>
              </div>
              <div>
                <Typography.Caption color="hint">Ticks</Typography.Caption>
                <Typography.SmallBody>{state.saveInfo.manifest.stats.tickCount.toLocaleString()}</Typography.SmallBody>
              </div>
              <div>
                <Typography.Caption color="hint">Messages</Typography.Caption>
                <Typography.SmallBody>{state.saveInfo.manifest.stats.messageCount.toLocaleString()}</Typography.SmallBody>
              </div>
            </div>
          </motion.div>
        )}

        {state.status === 'restoring' && (
          <motion.div
            key="restoring"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            css={css`
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: ${theme.spacing[3]};
              padding: ${theme.spacing[8]} ${theme.spacing[4]};
              border: 1px solid ${theme.colors.border.default};
              border-radius: ${theme.borderRadius.lg};
              background: ${theme.colors.background.paper};
            `}
          >
            <CircleNotch
              size={28}
              css={css`
                color: ${theme.colors.accent};
                animation: spin 1s linear infinite;
                @keyframes spin { to { transform: rotate(360deg); } }
              `}
            />
            <Typography.SmallBody color="secondary">
              Restoring save... This may take a moment.
            </Typography.SmallBody>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error message */}
      <AnimatePresence>
        {state.status === 'error' && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            css={css`
              display: flex;
              align-items: flex-start;
              gap: ${theme.spacing[2]};
              padding: ${theme.spacing[2]} ${theme.spacing[3]};
              border-radius: ${theme.borderRadius.default};
              background: ${theme.colors.error.main}1a;
            `}
          >
            <XCircle size={14} weight="fill" css={css`color: ${theme.colors.error.main}; flex-shrink: 0; margin-top: 2px;`} />
            <Typography.Caption color={theme.colors.error.main}>
              {state.message}
            </Typography.Caption>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Warning text */}
      {canRestore && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          css={css`
            display: flex;
            align-items: flex-start;
            gap: ${theme.spacing[2]};
          `}
        >
          <Warning size={14} css={css`color: ${theme.colors.warning.main}; flex-shrink: 0; margin-top: 2px;`} />
          <Typography.Caption color="secondary">
            Restoring will replace all current AI state including memories, emotions, and conversation
            history. You will still need to set up your agent provider credentials.
          </Typography.Caption>
        </motion.div>
      )}

      {/* Navigation */}
      <OnboardingNav
        onBack={handleBack}
        onContinue={handleRestore}
        continueLabel="Restore"
        continueDisabled={!canRestore || isRestoring}
        continueLoading={isRestoring}
        continueTooltip={!canRestore && !isRestoring ? 'Upload a .animus save file first' : undefined}
      />
    </div>
  );
}
