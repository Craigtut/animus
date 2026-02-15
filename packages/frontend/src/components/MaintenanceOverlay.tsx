/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { trpc } from '../utils/trpc';
import { Spinner } from './ui';
import { AnimatePresence, motion } from 'motion/react';

export function MaintenanceOverlay() {
  const { data } = trpc.saves.maintenanceStatus.useQuery(undefined, {
    refetchInterval: (query) => query.state.data?.active ? 1000 : 10000,
  });
  const theme = useTheme();

  if (!data?.active) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        css={css`
          position: fixed;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.6);
          z-index: ${theme.zIndex.modal + 10};
          gap: ${theme.spacing[4]};
        `}
      >
        <Spinner size={40} />
        <div css={css`
          color: white;
          font-size: ${theme.typography.fontSize.lg};
          font-weight: ${theme.typography.fontWeight.medium};
          text-align: center;
          max-width: 400px;
        `}>
          {data.reason || 'Maintenance in progress...'}
        </div>
        <div css={css`
          color: rgba(255, 255, 255, 0.6);
          font-size: ${theme.typography.fontSize.sm};
        `}>
          Please wait, this may take a moment.
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
