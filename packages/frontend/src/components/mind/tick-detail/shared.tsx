/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CaretDown } from '@phosphor-icons/react';

// ============================================================================
// Badge
// ============================================================================

export function Badge({ label, color }: { label: string; color: string }) {
  const theme = useTheme();
  return (
    <span css={css`
      display: inline-block;
      font-size: ${theme.typography.fontSize.xs};
      font-weight: ${theme.typography.fontWeight.medium};
      color: ${color};
      border: 1px solid ${color}33;
      background: ${color}11;
      padding: 1px ${theme.spacing[1.5]};
      border-radius: ${theme.borderRadius.sm};
      white-space: nowrap;
    `}>
      {label}
    </span>
  );
}

// ============================================================================
// CodeBlock
// ============================================================================

export function CodeBlock({ content, maxHeight = 300 }: { content: string; maxHeight?: number }) {
  const theme = useTheme();
  return (
    <pre css={css`
      font-family: ${theme.typography.fontFamily.mono};
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      color: ${theme.colors.text.primary};
      background: ${theme.mode === 'light'
        ? 'rgba(0, 0, 0, 0.03)'
        : 'rgba(255, 255, 255, 0.04)'};
      padding: ${theme.spacing[3]};
      border-radius: ${theme.borderRadius.default};
      border: 1px solid ${theme.colors.border.light};
      max-height: ${maxHeight}px;
      overflow-y: auto;
      margin: 0;
    `}>
      {content}
    </pre>
  );
}

// ============================================================================
// DetailField
// ============================================================================

export function DetailField({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  const theme = useTheme();
  return (
    <div css={css`margin-bottom: ${theme.spacing[2]};`}>
      <span css={css`
        display: block;
        font-family: ${theme.typography.fontFamily.sans};
        font-size: 11px;
        font-weight: ${theme.typography.fontWeight.medium};
        color: ${theme.colors.text.hint};
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: ${theme.spacing[0.5]};
      `}>
        {label}
      </span>
      <span css={css`
        font-family: ${mono ? theme.typography.fontFamily.mono : theme.typography.fontFamily.sans};
        font-size: ${mono ? '12px' : '13px'};
        color: ${theme.colors.text.primary};
        word-break: break-word;
      `}>
        {children}
      </span>
    </div>
  );
}

// ============================================================================
// DetailCollapsible
// ============================================================================

export function DetailCollapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div css={css`margin-top: ${theme.spacing[2]};`}>
      <button
        onClick={() => setOpen((o) => !o)}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[1]};
          font-family: ${theme.typography.fontFamily.sans};
          font-size: 11px;
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${theme.colors.text.hint};
          text-transform: uppercase;
          letter-spacing: 0.04em;
          cursor: pointer;
          padding: ${theme.spacing[0.5]} 0;
          transition: color ${theme.transitions.micro};
          &:hover { color: ${theme.colors.text.secondary}; }
        `}
      >
        <CaretDown size={10} css={open ? undefined : css`transform: rotate(-90deg);`} />
        {title}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            css={css`overflow: hidden;`}
          >
            <div css={css`margin-top: ${theme.spacing[1.5]};`}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// SectionLabel
// ============================================================================

export function SectionLabel({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <span css={css`
      display: block;
      font-family: ${theme.typography.fontFamily.sans};
      font-size: 11px;
      font-weight: ${theme.typography.fontWeight.medium};
      color: ${theme.colors.text.hint};
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: ${theme.spacing[2]};
    `}>
      {children}
    </span>
  );
}

// ============================================================================
// TokenStat — inline token count display
// ============================================================================

export function TokenStat({ label, value, suffix }: { label: string; value: number | null; suffix?: string }) {
  const theme = useTheme();
  if (value == null) return null;
  return (
    <span css={css`
      display: inline-flex;
      align-items: baseline;
      gap: 3px;
      font-family: ${theme.typography.fontFamily.mono};
      font-size: 11px;
      color: ${theme.colors.text.hint};
    `}>
      <span css={css`color: ${theme.colors.text.secondary};`}>
        {value.toLocaleString()}
      </span>
      {suffix ?? label}
    </span>
  );
}

// ============================================================================
// DurationBadge
// ============================================================================

export function DurationBadge({ ms }: { ms: number }) {
  const theme = useTheme();
  const color = ms < 200 ? theme.colors.success.main
    : ms <= 1000 ? theme.colors.warning.main
    : theme.colors.error.main;

  return (
    <span
      title={`${Math.round(ms).toLocaleString()}ms`}
      css={css`
        font-family: ${theme.typography.fontFamily.mono};
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 6px;
        background: ${color}1F;
        color: ${color};
        white-space: nowrap;
        flex-shrink: 0;
      `}
    >
      {formatDuration(ms)}
    </span>
  );
}

// ============================================================================
// Helpers
// ============================================================================

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatRelativeMs(ms: number): string {
  if (ms === 0) return '0s';
  return `+${(ms / 1000).toFixed(1)}s`;
}

/** Shorten a file path for display -- keep filename and parent dir */
export function shortenPath(fullPath: string): string {
  const parts = fullPath.split('/').filter(Boolean);
  if (parts.length <= 2) return fullPath;
  return `.../${parts.slice(-2).join('/')}`;
}

export function triggerColor(triggerType: string, theme: ReturnType<typeof useTheme>): string {
  switch (triggerType) {
    case 'message':        return theme.colors.accent;
    case 'interval':       return theme.colors.text.hint;
    case 'scheduled_task': return theme.colors.warning.main;
    case 'agent_complete': return theme.colors.success.main;
    default:               return theme.colors.text.secondary;
  }
}

export function formatCost(usd: number | string | null | undefined): string | null {
  if (usd == null) return null;
  const n = typeof usd === 'string' ? parseFloat(usd) : usd;
  if (isNaN(n)) return null;
  if (n < 0.001) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(4)}`;
}

/** Extract a string from event data */
export function str(val: unknown): string {
  return typeof val === 'string' ? val : '';
}
