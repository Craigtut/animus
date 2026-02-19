/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useRef, useEffect, useLayoutEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { PaperPlaneRight, Paperclip, X, File as FileIcon, Spinner } from '@phosphor-icons/react';
import type { AttachmentData } from './Conversation';

// ============================================================================
// Types
// ============================================================================

export interface StagedFile {
  id: string; // server-assigned upload ID
  file: File;
  type: 'image' | 'audio' | 'video' | 'file';
  status: 'uploading' | 'ready' | 'error';
  previewUrl: string | undefined;
}

export interface MessageInputHandle {
  addFiles: (files: File[]) => void;
}

export interface MessageInputProps {
  onSend: (content: string, attachmentIds?: string[]) => void;
  disabled?: boolean;
  isDragOver?: boolean;
}

// ============================================================================
// Upload helper
// ============================================================================

async function uploadFile(file: File): Promise<{ id: string; type: 'image' | 'audio' | 'video' | 'file'; mimeType: string; originalFilename: string | null; sizeBytes: number }> {
  const formData = new FormData();
  formData.append('file', file);

  const resp = await fetch('/api/media/upload', {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Upload failed' }));
    throw new Error(err.message || `Upload failed: ${resp.status}`);
  }

  const data = await resp.json();
  return data.attachments[0];
}

function classifyFile(file: File): 'image' | 'audio' | 'video' | 'file' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'file';
}

// ============================================================================
// Staged file preview
// ============================================================================

function StagedFilePreview({
  staged,
  onRemove,
}: {
  staged: StagedFile;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const isImage = staged.type === 'image' && staged.previewUrl;

  return (
    <div
      css={css`
        position: relative;
        flex-shrink: 0;
        width: ${isImage ? '64px' : 'auto'};
        height: 64px;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid ${theme.colors.border.light};
        background: ${theme.mode === 'light'
          ? 'rgba(26, 24, 22, 0.04)'
          : 'rgba(250, 249, 244, 0.06)'};
        ${!isImage ? `
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0 10px;
        ` : ''}
        ${staged.status === 'uploading' ? 'opacity: 0.6;' : ''}
        ${staged.status === 'error' ? `border-color: ${theme.colors.error.main};` : ''}
      `}
    >
      {isImage ? (
        <img
          src={staged.previewUrl}
          alt={staged.file.name}
          css={css`
            width: 100%;
            height: 100%;
            object-fit: cover;
          `}
        />
      ) : (
        <>
          <FileIcon size={16} color={theme.colors.text.hint} />
          <span
            css={css`
              font-size: 0.75rem;
              color: ${theme.colors.text.secondary};
              max-width: 80px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `}
          >
            {staged.file.name}
          </span>
        </>
      )}

      {/* Upload spinner overlay */}
      {staged.status === 'uploading' && (
        <div
          css={css`
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.3);
          `}
        >
          <Spinner size={18} color="white" css={css`animation: spin 1s linear infinite; @keyframes spin { to { transform: rotate(360deg); } }`} />
        </div>
      )}

      {/* Remove button */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        css={css`
          position: absolute;
          top: 2px;
          right: 2px;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          border: none;
          background: rgba(0, 0, 0, 0.5);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
          &:hover { background: rgba(0, 0, 0, 0.7); }
        `}
      >
        <X size={10} weight="bold" />
      </button>
    </div>
  );
}

// ============================================================================
// Floating Message Input (pill capsule)
// ============================================================================

export const MessageInput = forwardRef<MessageInputHandle, MessageInputProps>(function MessageInput(
  { onSend, disabled = false, isDragOver = false },
  ref,
) {
  const theme = useTheme();
  const [value, setValue] = useState('');
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Line height in px: 1rem (16px) * 1.5 = 24px
  const lineHeightPx = 24;
  const paddingY = 12; // 6px top + 6px bottom (spacing[1.5] = 0.375rem = 6px)
  const maxLines = 3;
  const maxTextareaHeight = lineHeightPx * maxLines + paddingY;
  const singleLineHeight = lineHeightPx + paddingY;
  const [textareaHeight, setTextareaHeight] = useState<number>(singleLineHeight);

  // Measure and update textarea height whenever value changes.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    if (!value) {
      setTextareaHeight(singleLineHeight);
      return;
    }

    const prev = el.style.height;
    el.style.height = '0px';
    const scrollH = el.scrollHeight;
    el.style.height = prev;

    const clamped = Math.min(scrollH, maxTextareaHeight);
    setTextareaHeight(clamped);
  }, [value, maxTextareaHeight, singleLineHeight]);

  // File processing
  const addFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      const type = classifyFile(file);
      const tempId = crypto.randomUUID();

      // Create local preview for images
      let previewUrl: string | undefined;
      if (type === 'image') {
        previewUrl = URL.createObjectURL(file);
      }

      const staged: StagedFile = {
        id: tempId,
        file,
        type,
        status: 'uploading',
        previewUrl,
      };

      setStagedFiles((prev) => [...prev, staged]);

      // Upload
      try {
        const result = await uploadFile(file);
        setStagedFiles((prev) =>
          prev.map((f) =>
            f.id === tempId ? { ...f, id: result.id, status: 'ready' as const } : f
          )
        );
      } catch {
        setStagedFiles((prev) =>
          prev.map((f) =>
            f.id === tempId ? { ...f, status: 'error' as const } : f
          )
        );
      }
    }
  }, []);

  // Expose addFiles to parent via ref
  useImperativeHandle(ref, () => ({ addFiles }), [addFiles]);

  const removeFile = useCallback((id: string) => {
    setStagedFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      stagedFiles.forEach((f) => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = () => {
    const trimmed = value.trim();
    const readyFiles = stagedFiles.filter((f) => f.status === 'ready');
    const hasUploading = stagedFiles.some((f) => f.status === 'uploading');

    if ((!trimmed && readyFiles.length === 0) || disabled || hasUploading) return;

    const content = trimmed || ' '; // Need at least a space for content validation
    const attachmentIds = readyFiles.length > 0 ? readyFiles.map((f) => f.id) : undefined;

    onSend(content, attachmentIds);
    setValue('');
    // Clean up preview URLs
    stagedFiles.forEach((f) => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    });
    setStagedFiles([]);
    setTextareaHeight(singleLineHeight);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Handle paste (images from clipboard)
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }, [addFiles]);

  // Focus on "/" key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement === document.body) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const hasContent = value.trim().length > 0 || stagedFiles.some((f) => f.status === 'ready');
  const hasUploading = stagedFiles.some((f) => f.status === 'uploading');
  const isMultiline = textareaHeight > singleLineHeight || stagedFiles.length > 0;

  return (
    <div
      css={css`
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: ${theme.zIndex.sticky};
        width: min(600px, calc(100vw - 48px));

        @media (max-width: ${theme.breakpoints.md}) {
          bottom: calc(56px + 12px + env(safe-area-inset-bottom, 0px));
        }
      `}
    >
      <div
        css={css`
          display: flex;
          flex-direction: column;
          border-radius: ${isMultiline ? theme.borderRadius.xl : theme.borderRadius.full};
          background: ${theme.mode === 'light'
            ? 'rgba(250, 249, 244, 0.85)'
            : 'rgba(28, 26, 24, 0.85)'};
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid ${isDragOver ? theme.colors.accent : theme.colors.border.light};
          transition: border-radius 100ms ease-out, border-color 150ms ease;
        `}
      >
        {/* Staged file previews */}
        {stagedFiles.length > 0 && (
          <div
            css={css`
              display: flex;
              gap: 8px;
              padding: ${theme.spacing[2]} ${theme.spacing[3]} 0;
              overflow-x: auto;
              scrollbar-width: none;
              &::-webkit-scrollbar { display: none; }
            `}
          >
            {stagedFiles.map((staged) => (
              <StagedFilePreview
                key={staged.id}
                staged={staged}
                onRemove={() => removeFile(staged.id)}
              />
            ))}
          </div>
        )}

        {/* Input row */}
        <div
          css={css`
            display: flex;
            align-items: flex-end;
            gap: ${theme.spacing[1]};
            padding: ${theme.spacing[1.5]} ${theme.spacing[1.5]} ${theme.spacing[1.5]} ${theme.spacing[2]};
          `}
        >
          {/* Attachment button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
            css={css`
              display: flex;
              align-items: center;
              justify-content: center;
              width: 36px;
              height: 36px;
              border-radius: 50%;
              flex-shrink: 0;
              cursor: pointer;
              padding: 0;
              border: none;
              background: transparent;
              color: ${theme.colors.text.hint};
              transition: all ${theme.transitions.fast};
              &:hover {
                color: ${theme.colors.text.secondary};
                background: ${theme.mode === 'light'
                  ? 'rgba(26, 24, 22, 0.06)'
                  : 'rgba(250, 249, 244, 0.08)'};
              }
            `}
          >
            <Paperclip size={18} />
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,audio/*,video/*,.pdf,.txt,.csv,.md,.json,.zip"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length > 0) addFiles(files);
              e.target.value = ''; // Reset so same file can be selected again
            }}
            css={css`display: none;`}
          />

          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Message..."
            aria-label="Message input"
            rows={1}
            css={css`
              flex: 1;
              padding: ${theme.spacing[1.5]} 0;
              background: transparent;
              border: none;
              color: ${theme.colors.text.primary};
              font-size: ${theme.typography.fontSize.base};
              font-family: ${theme.typography.fontFamily.sans};
              line-height: ${theme.typography.lineHeight.normal};
              resize: none;
              outline: none;
              overflow-y: ${textareaHeight >= maxTextareaHeight ? 'auto' : 'hidden'};
              transition: height 100ms ease-out;
              height: ${textareaHeight}px;

              &::placeholder {
                color: ${theme.colors.text.hint};
              }
            `}
          />
          <button
            onClick={handleSend}
            disabled={!hasContent || disabled || hasUploading}
            aria-label="Send message"
            css={css`
              display: flex;
              align-items: center;
              justify-content: center;
              width: 36px;
              height: 36px;
              border-radius: 50%;
              flex-shrink: 0;
              cursor: ${hasContent && !hasUploading ? 'pointer' : 'default'};
              padding: 0;
              border: none;
              background: ${hasContent && !hasUploading ? theme.colors.accent : 'transparent'};
              color: ${hasContent && !hasUploading ? theme.colors.accentForeground : theme.colors.text.hint};
              transition: all ${theme.transitions.fast};

              &:hover:not(:disabled) {
                opacity: 0.85;
              }

              &:disabled {
                cursor: default;
              }
            `}
          >
            {hasUploading ? (
              <Spinner size={18} css={css`animation: spin 1s linear infinite; @keyframes spin { to { transform: rotate(360deg); } }`} />
            ) : (
              <PaperPlaneRight size={18} weight={hasContent ? 'fill' : 'regular'} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
