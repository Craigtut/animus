/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, WarningCircle, CheckCircle, Warning, Info, CaretDown, CaretUp } from '@phosphor-icons/react';
import { Typography } from './ui';
import { useToastStore, type Toast, type ToastVariant } from '../store/toast-store';

const iconMap: Record<ToastVariant, typeof WarningCircle> = {
  error: WarningCircle,
  success: CheckCircle,
  warning: Warning,
  info: Info,
};

function variantColor(variant: ToastVariant, theme: ReturnType<typeof useTheme>) {
  switch (variant) {
    case 'success': return theme.colors.success.main;
    case 'warning': return theme.colors.warning.main;
    case 'info': return theme.colors.info.main;
    default: return theme.colors.error.main;
  }
}

function ToastItem({ t }: { t: Toast }) {
  const theme = useTheme();
  const removeToast = useToastStore((s) => s.removeToast);
  const [expanded, setExpanded] = useState(false);

  const Icon = iconMap[t.variant];
  const color = variantColor(t.variant, theme);
  const hasDetail = !!t.detail;
  const hasActions = !!t.actions?.length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.95 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      css={css`
        pointer-events: auto;
        width: 380px;
        background: ${theme.mode === 'dark'
          ? 'rgba(30, 28, 26, 0.94)'
          : 'rgba(255, 255, 255, 0.94)'};
        backdrop-filter: blur(16px);
        border: 1px solid ${color}33;
        border-radius: ${theme.borderRadius.lg};
        box-shadow: ${theme.shadows.lg};
        overflow: hidden;
      `}
    >
      {/* Main row */}
      <div css={css`
        display: flex;
        align-items: flex-start;
        gap: ${theme.spacing[3]};
        padding: ${theme.spacing[3]} ${theme.spacing[3]} ${theme.spacing[3]} ${theme.spacing[4]};
      `}>
        <Icon
          size={16}
          weight="fill"
          css={css`color: ${color}; flex-shrink: 0; margin-top: 2px;`}
        />
        <div css={css`flex: 1; min-width: 0;`}>
          <Typography.SmallBody css={css`
            color: ${theme.colors.text.primary};
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            line-height: ${theme.typography.lineHeight.relaxed};
          `}>
            {t.message}
          </Typography.SmallBody>
        </div>
        <button
          onClick={() => removeToast(t.id)}
          css={css`
            flex-shrink: 0;
            color: ${theme.colors.text.hint};
            cursor: pointer;
            padding: 2px;
            border-radius: ${theme.borderRadius.sm};
            display: flex;
            align-items: center;
            transition: color ${theme.transitions.micro};
            &:hover { color: ${theme.colors.text.primary}; }
          `}
        >
          <X size={14} />
        </button>
      </div>

      {/* Actions row */}
      {(hasDetail || hasActions) && (
        <div css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          padding: 0 ${theme.spacing[4]} ${theme.spacing[3]};
          margin-top: -${theme.spacing[1]};
        `}>
          {hasDetail && (
            <button
              onClick={() => setExpanded((v) => !v)}
              css={css`
                display: flex;
                align-items: center;
                gap: 4px;
                color: ${theme.colors.text.hint};
                font-size: ${theme.typography.fontSize.xs};
                font-family: ${theme.typography.fontFamily.sans};
                cursor: pointer;
                padding: 0;
                transition: color ${theme.transitions.micro};
                &:hover { color: ${theme.colors.text.secondary}; }
              `}
            >
              {expanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
              {expanded ? 'Less' : 'Details'}
            </button>
          )}
          {t.actions?.map((action, i) => (
            <button
              key={i}
              onClick={() => {
                action.onClick();
                removeToast(t.id);
              }}
              css={css`
                color: ${color};
                font-size: ${theme.typography.fontSize.xs};
                font-family: ${theme.typography.fontFamily.sans};
                font-weight: ${theme.typography.fontWeight.medium};
                cursor: pointer;
                padding: 0;
                transition: opacity ${theme.transitions.micro};
                &:hover { opacity: 0.7; }
              `}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Expandable detail */}
      <AnimatePresence>
        {expanded && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            css={css`overflow: hidden;`}
          >
            <div css={css`
              padding: ${theme.spacing[3]} ${theme.spacing[4]};
              border-top: 1px solid ${theme.colors.border.light};
              background: ${theme.mode === 'dark'
                ? 'rgba(0, 0, 0, 0.15)'
                : 'rgba(0, 0, 0, 0.025)'};
            `}>
              <Typography.Caption css={css`
                color: ${theme.colors.text.secondary};
                font-family: ${theme.typography.fontFamily.mono ?? 'monospace'};
                font-size: 11px;
                line-height: 1.5;
                word-break: break-all;
                white-space: pre-wrap;
                user-select: text;
              `}>
                {t.detail}
              </Typography.Caption>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function ToastContainer() {
  const theme = useTheme();
  const toasts = useToastStore((s) => s.toasts);

  return (
    <div css={css`
      position: fixed;
      bottom: ${theme.spacing[6]};
      right: ${theme.spacing[6]};
      z-index: 1100;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: ${theme.spacing[2]};
      pointer-events: none;
    `}>
      <AnimatePresence>
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}
