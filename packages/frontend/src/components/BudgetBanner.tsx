/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { Link } from 'react-router-dom';
import { WarningCircle } from '@phosphor-icons/react';
import { trpc } from '../utils/trpc';

/**
 * Persistent banner shown across the app when the weekly budget has been exceeded
 * and the agent is hard-stopped. Includes a link to the Usage page to manage the budget.
 */
export function BudgetBanner() {
  const theme = useTheme();

  const budgetStatus = trpc.usage.getBudgetStatus.useQuery(undefined, {
    refetchInterval: 60_000, // re-check every minute
  });

  if (!budgetStatus.data?.isHardStopped) return null;

  const { currentSpendUsd, config, currentWindowEnd } = budgetStatus.data;
  const resetDate = new Date(currentWindowEnd).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });

  return (
    <div
      css={css`
        display: flex;
        align-items: center;
        justify-content: center;
        gap: ${theme.spacing[3]};
        padding: ${theme.spacing[2]} ${theme.spacing[4]};
        background: ${theme.colors.error.light}33;
        border-bottom: 1px solid ${theme.colors.error.main}44;
        font-size: ${theme.typography.fontSize.sm};
        color: ${theme.mode === 'light' ? theme.colors.error.dark : theme.colors.error.light};
        text-align: center;
        flex-wrap: wrap;
      `}
    >
      <WarningCircle size={16} weight="fill" />
      <span>
        Weekly budget reached (${currentSpendUsd.toFixed(2)} / ${config.weeklyBudgetUsd.toFixed(2)}).
        Agent paused until {resetDate} or increase budget.
      </span>
      <Link
        to="/settings/usage"
        css={css`
          color: inherit;
          font-weight: ${theme.typography.fontWeight.medium};
          text-decoration: underline;
          text-underline-offset: 2px;
          transition: opacity ${theme.transitions.fast};
          &:hover {
            opacity: 0.8;
          }
        `}
      >
        Manage Budget
      </Link>
    </div>
  );
}
