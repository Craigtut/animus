/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useCallback } from 'react';
import { Copy, Check } from '@phosphor-icons/react';

interface CopyableCodeBlockProps {
  code: string;
}

export function CopyableCodeBlock({ code }: CopyableCodeBlockProps) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div css={css`
      position: relative;
      border-radius: ${theme.borderRadius.default};
      border: 1px solid ${theme.colors.border.default};
      background: ${theme.colors.background.elevated};
      overflow: hidden;
    `}>
      <button
        type="button"
        onClick={handleCopy}
        css={css`
          position: absolute;
          top: ${theme.spacing[1.5]};
          right: ${theme.spacing[1.5]};
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid ${theme.colors.border.default};
          background: ${theme.colors.background.paper};
          color: ${copied ? theme.colors.success.main : theme.colors.text.secondary};
          font-size: 11px;
          cursor: pointer;
          transition: all 150ms;
          &:hover {
            background: ${theme.colors.background.default};
            color: ${theme.colors.text.primary};
          }
        `}
      >
        {copied ? <Check size={12} weight="bold" /> : <Copy size={12} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre css={css`
        margin: 0;
        padding: ${theme.spacing[3]};
        padding-right: ${theme.spacing[10]};
        overflow-x: auto;
        font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
        font-size: 12px;
        line-height: 1.5;
        color: ${theme.colors.text.secondary};
        white-space: pre;
        max-height: 280px;
        overflow-y: auto;
      `}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
