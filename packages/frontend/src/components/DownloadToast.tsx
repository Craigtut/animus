/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { AnimatePresence, motion } from 'motion/react';
import {
  DownloadSimple,
  Check,
  WarningCircle,
  X,
  ArrowClockwise,
  CircleNotch,
} from '@phosphor-icons/react';
import { Typography } from './ui';
import { useDownloadStore, type DownloadItem } from '../store/download-store';
import { trpc } from '../utils/trpc';

// ============================================================================
// Progress Bar
// ============================================================================

function ProgressBar({ percent, indeterminate }: { percent: number; indeterminate?: boolean }) {
  const theme = useTheme();
  return (
    <div css={css`
      width: 100%;
      height: 4px;
      background: ${theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'};
      border-radius: 2px;
      overflow: hidden;
    `}>
      <div css={css`
        height: 100%;
        border-radius: 2px;
        background: ${theme.colors.accent};
        transition: width 0.3s ease;
        ${indeterminate ? `
          width: 40%;
          animation: indeterminate 1.5s ease-in-out infinite;
          @keyframes indeterminate {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
          }
        ` : `
          width: ${percent}%;
        `}
      `} />
    </div>
  );
}

// ============================================================================
// Download Row
// ============================================================================

function DownloadRow({ item }: { item: DownloadItem }) {
  const theme = useTheme();
  const isExtracting = item.phase === 'extracting';
  const isComplete = item.phase === 'completed';
  const isFailed = item.phase === 'failed';

  return (
    <div css={css`
      display: flex;
      flex-direction: column;
      gap: 4px;
    `}>
      <div css={css`
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: ${theme.spacing[2]};
      `}>
        <div css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[1.5]};
          min-width: 0;
          flex: 1;
        `}>
          {isComplete && (
            <Check size={14} weight="bold" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
          )}
          {isFailed && (
            <WarningCircle size={14} weight="fill" css={css`color: ${theme.colors.warning.main}; flex-shrink: 0;`} />
          )}
          {isExtracting && (
            <CircleNotch size={14} css={css`
              color: ${theme.colors.accent};
              flex-shrink: 0;
              animation: spin 1s linear infinite;
              @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `} />
          )}
          <Typography.Caption css={css`
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: ${theme.colors.text.primary};
          `}>
            {item.label}
            {isExtracting && ' (extracting...)'}
          </Typography.Caption>
        </div>
        {!isComplete && !isFailed && (
          <Typography.Caption css={css`
            color: ${theme.colors.text.hint};
            font-variant-numeric: tabular-nums;
            flex-shrink: 0;
          `}>
            {item.percent}%
          </Typography.Caption>
        )}
        {isFailed && (
          <Typography.Caption css={css`color: ${theme.colors.warning.main};`}>
            Failed
          </Typography.Caption>
        )}
      </div>
      {!isComplete && !isFailed && (
        <ProgressBar percent={item.percent} indeterminate={isExtracting} />
      )}
      {isFailed && item.error && (
        <Typography.Caption css={css`
          color: ${theme.colors.text.hint};
          font-size: 11px;
        `}>
          {item.error}
        </Typography.Caption>
      )}
    </div>
  );
}

// ============================================================================
// Download Toast
// ============================================================================

export function DownloadToast() {
  const theme = useTheme();
  const { items, visible, dismissed } = useDownloadStore();
  const retryMutation = trpc.downloads.startSpeechDownloads.useMutation();

  const itemList = Array.from(items.values());
  const hasItems = itemList.length > 0;
  const allComplete = hasItems && itemList.every((i) => i.phase === 'completed');
  const hasFailed = itemList.some((i) => i.phase === 'failed' && i.retriesRemaining === 0);
  const show = visible && !dismissed && hasItems;

  const handleDismiss = () => {
    useDownloadStore.getState().dismiss();
  };

  const handleRetry = () => {
    useDownloadStore.getState().retry();
    retryMutation.mutate();
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          css={css`
            position: fixed;
            bottom: ${theme.spacing[6]};
            left: 50%;
            transform: translateX(-50%);
            z-index: 1075;
            min-width: 320px;
            max-width: 420px;
            background: ${theme.mode === 'dark'
              ? 'rgba(30, 28, 26, 0.92)'
              : 'rgba(255, 255, 255, 0.92)'};
            backdrop-filter: blur(16px);
            border: 1px solid ${theme.colors.border.default};
            border-radius: ${theme.borderRadius.lg};
            padding: ${theme.spacing[4]};
            box-shadow: ${theme.shadows.lg};
            display: flex;
            flex-direction: column;
            gap: ${theme.spacing[3]};
          `}
        >
          {/* Header */}
          <div css={css`
            display: flex;
            align-items: center;
            justify-content: space-between;
          `}>
            <div css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[2]};
            `}>
              {allComplete ? (
                <Check size={16} weight="bold" css={css`color: ${theme.colors.success.main};`} />
              ) : (
                <DownloadSimple size={16} css={css`color: ${theme.colors.accent};`} />
              )}
              <Typography.SmallBody css={css`
                font-weight: ${theme.typography.fontWeight.medium};
              `}>
                {allComplete ? 'Downloads complete' : 'Downloading models...'}
              </Typography.SmallBody>
            </div>
            <button
              onClick={handleDismiss}
              css={css`
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

          {/* Download rows */}
          <div css={css`
            display: flex;
            flex-direction: column;
            gap: ${theme.spacing[3]};
          `}>
            {itemList.map((item) => (
              <DownloadRow key={item.assetId} item={item} />
            ))}
          </div>

          {/* Retry button for failed downloads */}
          {hasFailed && (
            <button
              onClick={handleRetry}
              disabled={retryMutation.isPending}
              css={css`
                display: flex;
                align-items: center;
                justify-content: center;
                gap: ${theme.spacing[1.5]};
                padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
                border: 1px solid ${theme.colors.border.default};
                border-radius: ${theme.borderRadius.default};
                background: ${theme.colors.background.elevated};
                color: ${theme.colors.text.primary};
                font-size: ${theme.typography.fontSize.sm};
                cursor: pointer;
                transition: all ${theme.transitions.micro};
                &:hover { background: ${theme.colors.background.paper}; }
                &:disabled { opacity: 0.5; cursor: not-allowed; }
              `}
            >
              <ArrowClockwise size={14} />
              Retry
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
