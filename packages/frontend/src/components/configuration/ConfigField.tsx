/** @jsxImportSource @emotion/react */
import { css, useTheme, keyframes } from '@emotion/react';
import { forwardRef, useState, useRef, useCallback } from 'react';
import {
  Eye,
  EyeSlash,
  ShieldCheck,
  ArrowSquareOut,
  Upload,
  File as FileIcon,
  Trash,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import { Input, Select, Toggle, Typography, Tooltip } from '../ui';
import { OAuthField } from './OAuthField';
import type { ConfigField as ConfigFieldType } from '@animus-labs/shared';

const glowFade = keyframes`
  0% { box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5); }
  100% { box-shadow: 0 0 0 2px transparent; }
`;

interface ConfigFieldProps {
  field: ConfigFieldType;
  value: unknown;
  error?: string | undefined;
  showSecret?: boolean | undefined;
  highlighted?: boolean | undefined;
  onChange: (key: string, value: unknown) => void;
  onToggleSecret?: ((key: string) => void) | undefined;
  /** Plugin name, needed for OAuth fields to initiate flows */
  pluginName?: string | undefined;
  /** All current config values, needed for OAuth dependsOn checks */
  configValues?: Record<string, unknown> | undefined;
}

export const ConfigField = forwardRef<HTMLDivElement, ConfigFieldProps>(
  ({ field, value, error, showSecret, highlighted, onChange, onToggleSecret, pluginName, configValues }, ref) => {
    const theme = useTheme();

    const wrapperCss = css`
      ${highlighted ? css`
        animation: ${glowFade} 1.5s ease-out forwards;
        border-radius: ${theme.borderRadius.default};
        padding: ${theme.spacing[2]};
        margin: -${theme.spacing[2]};
      ` : ''}
    `;

    const helpLinkEl = field.helpLink ? (
      <a
        href={field.helpLink.url}
        target="_blank"
        rel="noopener noreferrer"
        css={css`
          display: inline-flex;
          align-items: center;
          gap: 3px;
          color: ${theme.colors.accent};
          font-size: 12px;
          text-decoration: none;
          &:hover { text-decoration: underline; }
        `}
      >
        {field.helpLink.label} <ArrowSquareOut size={11} />
      </a>
    ) : null;

    // Toggle — settings-row: [label + description] ... [toggle]
    if (field.type === 'toggle') {
      return (
        <div ref={ref} css={wrapperCss}>
          <div css={css`
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: ${theme.spacing[4]};
            padding: ${theme.spacing[3]} 0;
          `}>
            <div css={css`display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0;`}>
              <span css={css`
                font-size: ${theme.typography.fontSize.sm};
                font-weight: ${theme.typography.fontWeight.medium};
                color: ${theme.colors.text.primary};
              `}>
                {field.label}
              </span>
              {field.helpText && (
                <Typography.Caption as="p" color="hint" css={css`line-height: 1.5;`}>
                  {field.helpText}
                </Typography.Caption>
              )}
              {helpLinkEl}
            </div>
            <div css={css`flex-shrink: 0; padding-top: 1px;`}>
              <Toggle
                checked={!!value}
                onChange={(checked) => onChange(field.key, checked)}
              />
            </div>
          </div>
          {error && (
            <span css={css`color: ${theme.colors.error.main}; font-size: 12px; display: block;`}>
              {error}
            </span>
          )}
        </div>
      );
    }

    // Select
    if (field.type === 'select' && field.options) {
      return (
        <div ref={ref} css={wrapperCss}>
          <Select
            label={`${field.label}${field.required ? ' *' : ''}`}
            value={value != null ? String(value) : ''}
            onChange={(v) => onChange(field.key, v)}
            options={field.options}
            error={error}
            helperText={field.helpText}
          />
          {helpLinkEl && (
            <div css={css`margin-top: 2px;`}>{helpLinkEl}</div>
          )}
        </div>
      );
    }

    // Secret
    if (field.type === 'secret') {
      return (
        <div ref={ref} css={wrapperCss}>
          <div css={css`display: flex; flex-direction: column;`}>
            <Input
              label={`${field.label}${field.required ? ' *' : ''}`}
              type={showSecret ? 'text' : 'password'}
              value={value != null ? String(value) : ''}
              onChange={(e) => onChange(field.key, (e.target as HTMLInputElement).value)}
              placeholder={field.placeholder}
              helperText={field.helpText}
              error={error}
              rightElement={
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[1.5]};`}>
                  <Tooltip content="Encrypted at rest and injected securely at runtime" position="top" align="right">
                    <ShieldCheck size={16} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
                  </Tooltip>
                  <button
                    type="button"
                    onClick={() => onToggleSecret?.(field.key)}
                    css={css`cursor: pointer; padding: 0; color: ${theme.colors.text.hint}; &:hover { color: ${theme.colors.text.primary}; }`}
                  >
                    {showSecret ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              }
            />
            {helpLinkEl && (
              <div css={css`margin-top: 2px;`}>{helpLinkEl}</div>
            )}
          </div>
        </div>
      );
    }

    // File Secret (encrypted file upload)
    if (field.type === 'file_secret') {
      return (
        <FileSecretField
          ref={ref}
          field={field}
          value={value}
          error={error}
          highlighted={highlighted}
          onChange={onChange}
          wrapperCss={wrapperCss}
          helpLinkEl={helpLinkEl}
        />
      );
    }

    // Text-list (tag input)
    if (field.type === 'text-list') {
      const tags = (Array.isArray(value) ? value : []) as string[];
      return (
        <div ref={ref} css={wrapperCss}>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
            <label css={css`
              font-size: ${theme.typography.fontSize.sm};
              font-weight: ${theme.typography.fontWeight.medium};
              color: ${theme.colors.text.secondary};
            `}>
              {field.label}{field.required && <span css={css`color: ${theme.colors.error.main}; margin-left: 2px;`}>*</span>}
            </label>
            <div>
              {tags.length > 0 && (
                <div css={css`display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;`}>
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
                        onClick={() => onChange(field.key, tags.filter((_, idx) => idx !== i))}
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
                      onChange(field.key, [...tags, val]);
                      e.currentTarget.value = '';
                    }
                  }
                }}
                css={css`
                  width: 100%;
                  padding: ${theme.spacing[3]};
                  background: ${theme.colors.background.paper};
                  border: 1px solid ${error ? theme.colors.error.main : theme.colors.border.default};
                  border-radius: ${theme.borderRadius.default};
                  color: ${theme.colors.text.primary};
                  font-size: ${theme.typography.fontSize.base};
                  outline: none;
                  &:focus { border-color: ${error ? theme.colors.error.main : theme.colors.border.focus}; }
                  &::placeholder { color: ${theme.colors.text.hint}; }
                `}
              />
            </div>
            {(field.helpText || helpLinkEl) && (
              <div css={css`display: flex; flex-direction: column; gap: 2px;`}>
                {field.helpText && (
                  <Typography.Caption as="p" color="hint">{field.helpText}</Typography.Caption>
                )}
                {helpLinkEl}
              </div>
            )}
            {error && (
              <span css={css`color: ${theme.colors.error.main}; font-size: 12px; margin-top: 4px; display: block;`}>
                {error}
              </span>
            )}
          </div>
        </div>
      );
    }

    // OAuth
    if (field.type === 'oauth') {
      return (
        <div ref={ref} css={wrapperCss}>
          <OAuthField
            field={field}
            pluginName={pluginName ?? ''}
            configValues={configValues ?? {}}
            highlighted={highlighted}
          />
        </div>
      );
    }

    // text, url, number
    return (
      <div ref={ref} css={wrapperCss}>
        <div css={css`display: flex; flex-direction: column;`}>
          <Input
            label={`${field.label}${field.required ? ' *' : ''}`}
            type={field.type === 'number' ? 'number' : 'text'}
            value={value != null ? String(value) : ''}
            onChange={(e) => {
              const raw = (e.target as HTMLInputElement).value;
              const parsed = field.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
              onChange(field.key, parsed);
            }}
            placeholder={field.placeholder}
            helperText={field.helpText}
            error={error}
          />
          {helpLinkEl && (
            <div css={css`margin-top: 2px;`}>{helpLinkEl}</div>
          )}
        </div>
      </div>
    );
  }
);

ConfigField.displayName = 'ConfigField';

// ---------------------------------------------------------------------------
// FileSecretField — sub-component for file_secret type
// Matches AnpkDropZone visual language for consistency.
// ---------------------------------------------------------------------------

interface FileSecretFieldProps {
  field: ConfigFieldType;
  value: unknown;
  error?: string | undefined;
  highlighted?: boolean | undefined;
  onChange: (key: string, value: unknown) => void;
  wrapperCss: ReturnType<typeof css>;
  helpLinkEl: React.ReactNode;
}

function readFileAsBase64(
  file: File,
  field: ConfigFieldType,
  onChange: (key: string, value: unknown) => void,
) {
  const reader = new FileReader();
  reader.onload = () => {
    const arrayBuffer = reader.result as ArrayBuffer;
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    onChange(field.key, {
      __file_secret: true,
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      data: btoa(binary),
    });
  };
  reader.readAsArrayBuffer(file);
}

const FileSecretField = forwardRef<HTMLDivElement, FileSecretFieldProps>(
  ({ field, value, error, onChange, wrapperCss, helpLinkEl }, ref) => {
    const theme = useTheme();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [sizeError, setSizeError] = useState<string | null>(null);

    const fileValue = value as Record<string, unknown> | undefined;
    const isConfigured = fileValue?.['__file_secret'] === true &&
      (fileValue?.['configured'] === true || typeof fileValue?.['data'] === 'string');
    const filename = (fileValue?.['filename'] as string) ?? '';

    const processFile = useCallback((file: File) => {
      setSizeError(null);
      const maxSize: number = field.maxFileSize ?? 102_400;
      if (file.size > maxSize) {
        setSizeError(`File too large (${Math.round(file.size / 1024)}KB). Max ${Math.round(maxSize / 1024)}KB.`);
        return;
      }
      readFileAsBase64(file, field, onChange);
    }, [field, onChange]);

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

    const handleDrop = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    }, [processFile]);

    const handleBrowse = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }, [processFile]);

    const displayError = error || sizeError;

    // Configured state: show filename with shield badge and controls
    if (isConfigured) {
      return (
        <div ref={ref} css={wrapperCss}>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
            <label css={css`
              font-size: ${theme.typography.fontSize.sm};
              font-weight: ${theme.typography.fontWeight.medium};
              color: ${theme.colors.text.secondary};
            `}>
              {field.label}{field.required && <span css={css`color: ${theme.colors.error.main}; margin-left: 2px;`}>*</span>}
            </label>
            <div css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[3]};
              padding: ${theme.spacing[3]} ${theme.spacing[4]};
              background: ${theme.colors.background.paper};
              border: 1px solid ${theme.colors.border.default};
              border-radius: ${theme.borderRadius.lg};
            `}>
              <ShieldCheck size={20} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
              <FileIcon size={18} css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`} />
              <Typography.SmallBody css={css`
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              `}>
                {filename}
              </Typography.SmallBody>
              <Tooltip content="Replace file" position="top">
                <button
                  type="button"
                  onClick={handleBrowse}
                  css={css`
                    cursor: pointer; padding: 4px; color: ${theme.colors.text.hint};
                    background: none; border: none; display: flex; flex-shrink: 0;
                    &:hover { color: ${theme.colors.text.primary}; }
                  `}
                >
                  <ArrowsClockwise size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Remove file" position="top">
                <button
                  type="button"
                  onClick={() => onChange(field.key, undefined)}
                  css={css`
                    cursor: pointer; padding: 4px; color: ${theme.colors.text.hint};
                    background: none; border: none; display: flex; flex-shrink: 0;
                    &:hover { color: ${theme.colors.error.main}; }
                  `}
                >
                  <Trash size={16} />
                </button>
              </Tooltip>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={field.accept}
              onChange={handleFileInputChange}
              css={css`display: none;`}
            />
            {(field.helpText || helpLinkEl) && (
              <div css={css`display: flex; flex-direction: column; gap: 2px;`}>
                {field.helpText && (
                  <Typography.Caption as="p" color="hint">{field.helpText}</Typography.Caption>
                )}
                {helpLinkEl}
              </div>
            )}
            {displayError && (
              <Typography.Caption css={css`color: ${theme.colors.error.main};`}>{displayError}</Typography.Caption>
            )}
          </div>
        </div>
      );
    }

    // Upload state: drag-and-drop zone (matches AnpkDropZone styling)
    return (
      <div ref={ref} css={wrapperCss}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
          <label css={css`
            font-size: ${theme.typography.fontSize.sm};
            font-weight: ${theme.typography.fontWeight.medium};
            color: ${theme.colors.text.secondary};
          `}>
            {field.label}{field.required && <span css={css`color: ${theme.colors.error.main}; margin-left: 2px;`}>*</span>}
          </label>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={field.accept}
            onChange={handleFileInputChange}
            css={css`display: none;`}
          />

          {/* Drop zone */}
          <div
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
              border: 2px dashed ${isDragOver ? theme.colors.accent : (displayError ? theme.colors.error.main : theme.colors.border.default)};
              border-radius: ${theme.borderRadius.lg};
              background: ${isDragOver ? `${theme.colors.accent}0a` : theme.colors.background.paper};
              cursor: pointer;
              transition: all ${theme.transitions.micro};

              &:hover {
                border-color: ${displayError ? theme.colors.error.main : theme.colors.accent};
                background: ${`${theme.colors.accent}08`};
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
                Drag & drop a file here
              </Typography.SmallBody>
              <Typography.Caption as="div" color="hint" css={css`margin-top: ${theme.spacing[1]};`}>
                or click to browse
              </Typography.Caption>
            </div>
          </div>

          {(field.helpText || helpLinkEl) && (
            <div css={css`display: flex; flex-direction: column; gap: 2px;`}>
              {field.helpText && (
                <Typography.Caption as="p" color="hint">{field.helpText}</Typography.Caption>
              )}
              {helpLinkEl}
            </div>
          )}
          {displayError && (
            <Typography.Caption css={css`color: ${theme.colors.error.main};`}>{displayError}</Typography.Caption>
          )}
        </div>
      </div>
    );
  },
);

FileSecretField.displayName = 'FileSecretField';
