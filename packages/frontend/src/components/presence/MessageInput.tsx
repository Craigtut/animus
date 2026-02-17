/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useRef, useEffect } from 'react';
import { PaperPlaneRight } from '@phosphor-icons/react';

// ============================================================================
// Types
// ============================================================================

export interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

// ============================================================================
// Floating Message Input (pill capsule)
// ============================================================================

export function MessageInput({ onSend, disabled = false }: MessageInputProps) {
  const theme = useTheme();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Line height in px: 1rem (16px) * 1.5 = 24px
  const lineHeightPx = 24;
  const paddingY = 12; // 6px top + 6px bottom (spacing[1.5] = 0.375rem = 6px)
  const maxLines = 3;
  const maxTextareaHeight = lineHeightPx * maxLines + paddingY;
  const singleLineHeight = lineHeightPx + paddingY;
  const [textareaHeight, setTextareaHeight] = useState<number>(singleLineHeight);

  // Measure and update textarea height whenever value changes
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    // Temporarily collapse to measure true content height
    const prev = el.style.height;
    el.style.height = '0px';
    const scrollH = el.scrollHeight;
    el.style.height = prev;

    const clamped = Math.min(scrollH, maxTextareaHeight);
    setTextareaHeight(clamped);
  }, [value, maxTextareaHeight]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    setTextareaHeight(singleLineHeight);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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

  const hasContent = value.trim().length > 0;
  const isMultiline = textareaHeight > singleLineHeight;

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
          align-items: flex-end;
          gap: ${theme.spacing[2]};
          padding: ${theme.spacing[1.5]} ${theme.spacing[1.5]} ${theme.spacing[1.5]} ${theme.spacing[4]};
          border-radius: ${isMultiline ? theme.borderRadius.xl : theme.borderRadius.full};
          background: ${theme.mode === 'light'
            ? 'rgba(250, 249, 244, 0.85)'
            : 'rgba(28, 26, 24, 0.85)'};
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid ${theme.colors.border.light};
          transition: border-radius 100ms ease-out;
        `}
      >
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
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
          disabled={!hasContent || disabled}
          aria-label="Send message"
          css={css`
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            flex-shrink: 0;
            cursor: ${hasContent ? 'pointer' : 'default'};
            padding: 0;
            border: none;
            background: ${hasContent ? theme.colors.accent : 'transparent'};
            color: ${hasContent ? theme.colors.accentForeground : theme.colors.text.hint};
            transition: all ${theme.transitions.fast};

            &:hover:not(:disabled) {
              opacity: 0.85;
            }

            &:disabled {
              cursor: default;
            }
          `}
        >
          <PaperPlaneRight size={18} weight={hasContent ? 'fill' : 'regular'} />
        </button>
      </div>
    </div>
  );
}
