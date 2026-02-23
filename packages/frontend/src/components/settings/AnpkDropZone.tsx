/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, File, XCircle, CircleNotch } from '@phosphor-icons/react';
import { Typography } from '../ui';

interface AnpkDropZoneProps {
  /** Called with the server-side file path after successful upload */
  onFileReady: (filePath: string) => void;
  /** Whether the parent is performing an action (disables interactions) */
  disabled?: boolean;
  /** Label for the file type (e.g., "plugin" or "channel") */
  packageType?: string;
}

type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; filename: string; progress: number }
  | { status: 'ready'; filename: string; filePath: string; sizeBytes: number }
  | { status: 'error'; message: string };

export function AnpkDropZone({ onFileReady, disabled, packageType = 'package' }: AnpkDropZoneProps) {
  const theme = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({ status: 'idle' });

  const uploadFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.anpk')) {
      setUploadState({ status: 'error', message: 'Only .anpk files are accepted' });
      return;
    }

    setUploadState({ status: 'uploading', filename: file.name, progress: 0 });

    try {
      const formData = new FormData();
      formData.append('file', file);

      const resp = await fetch('/api/packages/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ message: 'Upload failed' }));
        throw new Error(err.message || `Upload failed (${resp.status})`);
      }

      const result = await resp.json() as { filePath: string; originalFilename: string; sizeBytes: number };
      setUploadState({
        status: 'ready',
        filename: result.originalFilename,
        filePath: result.filePath,
        sizeBytes: result.sizeBytes,
      });
      onFileReady(result.filePath);
    } catch (err) {
      setUploadState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }, [onFileReady]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragOver(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (disabled) return;

    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }, [disabled, uploadFile]);

  const handleBrowse = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadFile]);

  const handleReset = useCallback(() => {
    setUploadState({ status: 'idle' });
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".anpk"
        onChange={handleFileInputChange}
        css={css`display: none;`}
      />

      {/* Drop zone */}
      <AnimatePresence mode="wait">
        {(uploadState.status === 'idle' || uploadState.status === 'error') && (
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
              padding: ${theme.spacing[6]} ${theme.spacing[4]};
              border: 2px dashed ${isDragOver ? theme.colors.accent : theme.colors.border.default};
              border-radius: ${theme.borderRadius.lg};
              background: ${isDragOver ? `${theme.colors.accent}0a` : theme.colors.background.paper};
              cursor: ${disabled ? 'default' : 'pointer'};
              transition: all ${theme.transitions.micro};
              opacity: ${disabled ? 0.5 : 1};

              &:hover {
                border-color: ${disabled ? theme.colors.border.default : theme.colors.accent};
                background: ${disabled ? theme.colors.background.paper : `${theme.colors.accent}08`};
              }
            `}
          >
            <Upload
              size={32}
              weight={isDragOver ? 'fill' : 'regular'}
              css={css`
                color: ${isDragOver ? theme.colors.accent : theme.colors.text.hint};
                transition: all ${theme.transitions.micro};
              `}
            />
            <div css={css`text-align: center;`}>
              <Typography.SmallBody color="secondary">
                Drag & drop an <Typography.SmallBodyAlt as="span" css={css`color: ${theme.colors.text.primary};`}>.anpk</Typography.SmallBodyAlt> file here
              </Typography.SmallBody>
              <Typography.Caption as="div" color="hint" css={css`margin-top: ${theme.spacing[1]};`}>
                or click to browse
              </Typography.Caption>
            </div>
          </motion.div>
        )}

        {uploadState.status === 'uploading' && (
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
              padding: ${theme.spacing[4]};
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
            <div css={css`flex: 1; min-width: 0;`}>
              <Typography.SmallBody css={css`
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              `}>
                Uploading {uploadState.filename}...
              </Typography.SmallBody>
            </div>
          </motion.div>
        )}

        {uploadState.status === 'ready' && (
          <motion.div
            key="ready"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[3]};
              padding: ${theme.spacing[3]} ${theme.spacing[4]};
              border: 1px solid ${theme.colors.success.main}33;
              border-radius: ${theme.borderRadius.lg};
              background: ${theme.colors.success.main}0d;
            `}
          >
            <File
              size={20}
              weight="fill"
              css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`}
            />
            <div css={css`flex: 1; min-width: 0;`}>
              <Typography.SmallBody css={css`
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              `}>
                {uploadState.filename}
              </Typography.SmallBody>
              <Typography.Caption as="div" color="hint">
                {formatSize(uploadState.sizeBytes)}
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
                &:hover { color: ${theme.colors.text.primary}; background: ${theme.colors.background.elevated}; }
              `}
              title="Remove and choose a different file"
            >
              <XCircle size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error message */}
      <AnimatePresence>
        {uploadState.status === 'error' && (
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
              {uploadState.message}
            </Typography.Caption>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
