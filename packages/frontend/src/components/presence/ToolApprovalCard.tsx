/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wrench,
  CheckCircle,
  XCircle,
  Clock,
  ShieldCheck,
  ChatCircle,
  Lightning,
  Warning,
} from '@phosphor-icons/react';
import { Typography, Badge, Button } from '../ui';
import { trpc } from '../../utils/trpc';
import type { Theme } from '../../styles/theme';
import type { ToolApprovalRequest, RiskTier } from '@animus-labs/shared';

// ============================================================================
// Risk tier colors
// ============================================================================

const riskTierBorderColor: Record<RiskTier, (t: Theme) => string> = {
  safe: (t) => t.colors.success.main,
  communicates: (t) => t.colors.info.main,
  acts: (t) => t.colors.warning.main,
  sensitive: (t) => t.colors.error.main,
};

// ============================================================================
// Single Approval Card
// ============================================================================

interface ToolApprovalCardProps {
  request: ToolApprovalRequest;
  /** Optional risk tier from the tool permissions — if not provided, defaults to 'acts' */
  riskTier?: RiskTier;
}

export function ToolApprovalCard({ request, riskTier = 'acts' }: ToolApprovalCardProps) {
  const theme = useTheme();
  const [resolving, setResolving] = useState(false);
  const resolveMutation = trpc.tools.resolveApproval.useMutation({
    onSettled: () => setResolving(false),
  });

  const borderColor = riskTierBorderColor[riskTier](theme);
  const isPending = request.status === 'pending';
  const isApproved = request.status === 'approved';
  const isDenied = request.status === 'denied';
  const isExpired = request.status === 'expired';

  const handleResolve = (approved: boolean, scope?: 'once' | 'always') => {
    setResolving(true);
    resolveMutation.mutate({
      requestId: request.id,
      approved,
      scope,
    });
  };

  // Resolved pill — compact inline feedback
  if (!isPending) {
    const label = isApproved ? 'Allowed' : isDenied ? 'Denied' : 'Expired';
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0, overflow: 'hidden' }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        css={css`
          display: inline-flex;
          align-items: center;
          gap: ${theme.spacing[1.5]};
          padding: ${theme.spacing[1]} ${theme.spacing[3]};
          border-radius: 999px;
          background: ${theme.mode === 'light'
            ? 'rgba(26, 24, 22, 0.04)'
            : 'rgba(250, 249, 244, 0.06)'};
          ${isExpired ? `opacity: 0.5;` : ''}
        `}
      >
        {isApproved && <CheckCircle size={14} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />}
        {isDenied && <XCircle size={14} weight="fill" css={css`color: ${theme.colors.error.main}; flex-shrink: 0;`} />}
        {isExpired && <Clock size={14} weight="fill" css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`} />}
        <Typography.Caption color="secondary" css={css`white-space: nowrap;`}>
          {request.toolName}
        </Typography.Caption>
        <Typography.Caption color="hint" css={css`
          white-space: nowrap;
          &::before { content: '—'; margin-right: ${theme.spacing[1.5]}; }
        `}>
          {label}
        </Typography.Caption>
      </motion.div>
    );
  }

  // Full pending card
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      css={css`
        border-radius: ${theme.borderRadius.md};
        background: ${theme.colors.background.paper};
        border: 1px solid ${theme.colors.border.default};
        border-left: 3px solid ${borderColor};
        padding: ${theme.spacing[4]};
        display: flex;
        flex-direction: column;
        gap: ${theme.spacing[3]};
      `}
    >
      {/* Header */}
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
        <Wrench size={16} css={css`color: ${theme.colors.text.secondary};`} />
        <Typography.SmallBody as="span" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          {request.toolName}
        </Typography.SmallBody>
        <Badge variant="default">{request.toolSource}</Badge>
      </div>

      {/* Context summary */}
      {request.triggerSummary && (
        <Typography.Caption as="div" color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
          {request.triggerSummary}
        </Typography.Caption>
      )}

      {/* Action buttons */}
      <div css={css`display: flex; gap: ${theme.spacing[2]}; flex-wrap: wrap;`}>
        <Button
          size="sm"
          onClick={() => handleResolve(true, 'once')}
          disabled={resolving}
          loading={resolving && resolveMutation.variables?.scope === 'once'}
        >
          Allow Once
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleResolve(true, 'always')}
          disabled={resolving}
          loading={resolving && resolveMutation.variables?.scope === 'always'}
        >
          Always Allow
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleResolve(false)}
          disabled={resolving}
          css={css`
            color: ${theme.colors.error.main};
            &:hover:not(:disabled) {
              color: ${theme.colors.error.dark};
            }
          `}
        >
          Deny
        </Button>
      </div>
    </motion.div>
  );
}

// ============================================================================
// Batch Approval Card — groups multiple tools under one batchId
// ============================================================================

interface BatchApprovalCardProps {
  requests: ToolApprovalRequest[];
  riskTiers?: Record<string, RiskTier>;
}

export function BatchApprovalCard({ requests, riskTiers = {} }: BatchApprovalCardProps) {
  const theme = useTheme();
  const [resolving, setResolving] = useState(false);
  const resolveMutation = trpc.tools.resolveApproval.useMutation();

  const allPending = requests.filter((r) => r.status === 'pending');
  if (allPending.length === 0) return null;

  const handleResolveAll = async (approved: boolean, scope?: 'once' | 'always') => {
    setResolving(true);
    try {
      for (const req of allPending) {
        await resolveMutation.mutateAsync({
          requestId: req.id,
          approved,
          scope,
        });
      }
    } finally {
      setResolving(false);
    }
  };

  // Determine the highest risk tier among the batch for the border color
  const tierOrder: RiskTier[] = ['safe', 'communicates', 'acts', 'sensitive'];
  const highestTier = allPending.reduce<RiskTier>((acc, r) => {
    const tier = riskTiers[r.toolName] ?? 'acts';
    return tierOrder.indexOf(tier) > tierOrder.indexOf(acc) ? tier : acc;
  }, 'safe');

  const borderColor = riskTierBorderColor[highestTier](theme);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      css={css`
        border-radius: ${theme.borderRadius.md};
        background: ${theme.colors.background.paper};
        border: 1px solid ${theme.colors.border.default};
        border-left: 3px solid ${borderColor};
        padding: ${theme.spacing[4]};
        display: flex;
        flex-direction: column;
        gap: ${theme.spacing[3]};
      `}
    >
      {/* Header */}
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
        <Wrench size={16} css={css`color: ${theme.colors.text.secondary};`} />
        <Typography.SmallBody as="span" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Tool Approvals
        </Typography.SmallBody>
        <Badge variant="default">{allPending.length} tools</Badge>
      </div>

      {/* Tool list */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        {allPending.map((req) => (
          <div
            key={req.id}
            css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[2]};
              padding: ${theme.spacing[1]} 0;
            `}
          >
            <div
              css={css`
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: ${riskTierBorderColor[riskTiers[req.toolName] ?? 'acts'](theme)};
              `}
            />
            <Typography.Caption as="span">{req.toolName}</Typography.Caption>
            <Typography.Caption as="span" color="hint">
              {req.triggerSummary}
            </Typography.Caption>
          </div>
        ))}
      </div>

      {/* Batch action buttons */}
      <div css={css`display: flex; gap: ${theme.spacing[2]}; flex-wrap: wrap;`}>
        <Button
          size="sm"
          onClick={() => handleResolveAll(true, 'once')}
          disabled={resolving}
          loading={resolving}
        >
          Allow All
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleResolveAll(false)}
          disabled={resolving}
          css={css`
            color: ${theme.colors.error.main};
            &:hover:not(:disabled) {
              color: ${theme.colors.error.dark};
            }
          `}
        >
          Deny All
        </Button>
      </div>
    </motion.div>
  );
}
