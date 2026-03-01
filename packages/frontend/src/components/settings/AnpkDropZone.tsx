/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, XCircle, CircleNotch } from '@phosphor-icons/react';
import { Typography } from '../ui';

interface AnpkDropZoneProps {
  /** Called with the server-side file path after successful upload. Awaited for verification feedback. */
  onFileReady: (filePath: string) => Promise<void>;
  /** Whether the parent is performing an action (disables interactions) */
  disabled?: boolean;
  /** Label for the file type (e.g., "plugin" or "channel") */
  packageType?: string;
}

type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; filename: string; progress: number }
  | { status: 'verifying'; filename: string; filePath: string; sizeBytes: number }
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

    // Phase 1: Upload file to server
    let result: { filePath: string; originalFilename: string; sizeBytes: number };
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

      result = await resp.json() as { filePath: string; originalFilename: string; sizeBytes: number };
    } catch (err) {
      setUploadState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Upload failed',
      });
      return;
    }

    // Phase 2: Verify package (parent handles toast on error)
    setUploadState({
      status: 'verifying',
      filename: result.originalFilename,
      filePath: result.filePath,
      sizeBytes: result.sizeBytes,
    });

    try {
      await onFileReady(result.filePath);
    } catch {
      // Parent already shows error toast; reset to idle so user can try again
    }
    setUploadState({ status: 'idle' });
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

        {uploadState.status === 'verifying' && (
          <motion.div
            key="verifying"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            css={css`
              display: flex;
              flex-direction: column;
              gap: ${theme.spacing[2]};
              padding: ${theme.spacing[4]};
              border: 1px solid ${theme.colors.border.default};
              border-radius: ${theme.borderRadius.lg};
              background: ${theme.colors.background.paper};
            `}
          >
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
              <CircleNotch
                size={20}
                css={css`
                  color: ${theme.colors.accent};
                  flex-shrink: 0;
                  animation: spin 1s linear infinite;
                  @keyframes spin { to { transform: rotate(360deg); } }
                `}
              />
              <div css={css`flex: 1; min-width: 0; display: flex; align-items: baseline; gap: ${theme.spacing[2]};`}>
                <Typography.SmallBody css={css`
                  overflow: hidden;
                  text-overflow: ellipsis;
                  white-space: nowrap;
                  min-width: 0;
                `}>
                  {uploadState.filename}
                </Typography.SmallBody>
                <Typography.Caption color="hint" css={css`flex-shrink: 0;`}>
                  {formatSize(uploadState.sizeBytes)}
                </Typography.Caption>
              </div>
            </div>
            {/* Indeterminate shimmer progress bar */}
            <div css={css`
              width: 100%;
              height: 2px;
              background: ${theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'};
              border-radius: 1px;
              overflow: hidden;
            `}>
              <div css={css`
                height: 100%;
                border-radius: 1px;
                background: ${theme.colors.accent};
                width: 40%;
                animation: shimmer 1.5s ease-in-out infinite;
                @keyframes shimmer {
                  0% { transform: translateX(-100%); }
                  100% { transform: translateX(350%); }
                }
              `} />
            </div>
            <Typography.Caption color="hint" css={css`text-align: center;`}>
              Verifying package...
            </Typography.Caption>
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
