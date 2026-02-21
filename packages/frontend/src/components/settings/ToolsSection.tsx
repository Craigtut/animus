/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wrench,
  CaretRight,
  CaretDown,
  ShieldCheck,
  ChatCircle,
  Lightning,
  Warning,
} from '@phosphor-icons/react';
import { Typography, Badge, Button } from '../ui';
import { trpc } from '../../utils/trpc';
import type { Theme } from '../../styles/theme';
import type { ToolPermission, ToolPermissionMode, RiskTier } from '@animus/shared';

// ============================================================================
// Risk tier visual config
// ============================================================================

const riskTierConfig: Record<RiskTier, { color: (t: Theme) => string; icon: React.ElementType; label: string }> = {
  safe: { color: (t) => t.colors.success.main, icon: ShieldCheck, label: 'Safe' },
  communicates: { color: (t) => t.colors.info.main, icon: ChatCircle, label: 'Communicates' },
  acts: { color: (t) => t.colors.warning.main, icon: Lightning, label: 'Acts' },
  sensitive: { color: (t) => t.colors.error.main, icon: Warning, label: 'Sensitive' },
};

const modeLabels: Record<ToolPermissionMode, string> = {
  off: 'Off',
  ask: 'Ask First',
  always_allow: 'Always Allow',
};

// ============================================================================
// ToolModeSelector — segmented control for permission mode
// ============================================================================

function ToolModeSelector({
  value,
  onChange,
  disabled,
}: {
  value: ToolPermissionMode;
  onChange: (mode: ToolPermissionMode) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const modes: ToolPermissionMode[] = ['off', 'ask', 'always_allow'];

  const getModeColor = (mode: ToolPermissionMode) => {
    switch (mode) {
      case 'off': return theme.colors.error.main;
      case 'ask': return theme.colors.warning.main;
      case 'always_allow': return theme.colors.success.main;
    }
  };

  return (
    <div
      css={css`
        display: inline-flex;
        border-radius: ${theme.borderRadius.default};
        border: 1px solid ${theme.colors.border.default};
        overflow: hidden;
      `}
    >
      {modes.map((mode) => {
        const isActive = value === mode;
        const activeColor = getModeColor(mode);
        return (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            disabled={disabled}
            css={css`
              padding: ${theme.spacing[1]} ${theme.spacing[2]};
              font-size: ${theme.typography.fontSize.xs};
              font-weight: ${isActive ? theme.typography.fontWeight.semibold : theme.typography.fontWeight.normal};
              cursor: ${disabled ? 'not-allowed' : 'pointer'};
              transition: all ${theme.transitions.micro};
              white-space: nowrap;
              border-right: 1px solid ${theme.colors.border.default};
              &:last-child { border-right: none; }

              ${isActive
                ? css`
                    background: ${activeColor}1a;
                    color: ${activeColor};
                  `
                : css`
                    background: transparent;
                    color: ${theme.colors.text.hint};
                    &:hover:not(:disabled) {
                      color: ${theme.colors.text.secondary};
                      background: ${theme.colors.background.elevated};
                    }
                  `}

              &:disabled {
                opacity: 0.5;
              }
            `}
          >
            {modeLabels[mode]}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// ToolRow — single tool with risk indicator, name, description, and selector
// ============================================================================

function ToolRow({ tool }: { tool: ToolPermission }) {
  const theme = useTheme();
  const utils = trpc.useUtils();
  const mutation = trpc.tools.updatePermission.useMutation({
    onSuccess: () => utils.tools.listTools.invalidate(),
  });
  const tierConfig = riskTierConfig[tool.riskTier];

  const formatLastUsed = (ts: string | null) => {
    if (!ts) return null;
    const diff = Date.now() - new Date(ts).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'Used just now';
    if (hours < 24) return `Used ${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `Used ${days}d ago`;
  };

  const usageText = [
    tool.usageCount > 0 ? `Used ${tool.usageCount} time${tool.usageCount !== 1 ? 's' : ''}` : null,
    formatLastUsed(tool.lastUsedAt),
  ]
    .filter(Boolean)
    .join(' \u00b7 ');

  return (
    <div
      css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[3]};
        padding: ${theme.spacing[2]} 0;

        @media (max-width: ${theme.breakpoints.md}) {
          flex-direction: column;
          align-items: flex-start;
          gap: ${theme.spacing[2]};
        }
      `}
    >
      {/* Risk tier dot */}
      <div
        css={css`
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${tierConfig.color(theme)};
          flex-shrink: 0;
        `}
        title={tierConfig.label}
      />

      {/* Tool info */}
      <div css={css`flex: 1; min-width: 0;`}>
        <Typography.SmallBody as="div" css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
          {tool.displayName}
        </Typography.SmallBody>
        <Typography.Caption as="div" color="hint" css={css`
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        `}>
          {tool.description}
        </Typography.Caption>
        {usageText && (
          <Typography.Caption as="div" color="hint" css={css`margin-top: 2px;`}>
            {usageText}
          </Typography.Caption>
        )}
      </div>

      {/* Mode selector */}
      <ToolModeSelector
        value={tool.mode}
        onChange={(mode) => mutation.mutate({ toolName: tool.toolName, mode })}
        disabled={mutation.isPending}
      />
    </div>
  );
}

// ============================================================================
// ToolGroup — collapsible group with header and "Set all to" actions
// ============================================================================

function ToolGroup({ source, tools }: { source: string; tools: ToolPermission[] }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(true);
  const [showSetAll, setShowSetAll] = useState(false);
  const utils = trpc.useUtils();
  const groupMutation = trpc.tools.updateGroupPermission.useMutation({
    onSuccess: () => {
      utils.tools.listTools.invalidate();
      setShowSetAll(false);
    },
  });

  const displayName = useMemo(() => {
    if (source === 'core') return 'Core Tools';
    if (source.startsWith('sdk:')) return `SDK: ${source.slice(4)}`;
    if (source.startsWith('plugin:')) return `Plugin: ${source.slice(7)}`;
    return source;
  }, [source]);

  return (
    <div css={css`margin-bottom: ${theme.spacing[4]};`}>
      {/* Group header */}
      <div
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          padding: ${theme.spacing[1.5]} 0;
          cursor: pointer;
          user-select: none;
        `}
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
        <Typography.SmallBody as="span" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          {displayName}
        </Typography.SmallBody>
        <Badge variant="default">{tools.length}</Badge>

        {/* Set all button */}
        <div
          css={css`margin-left: auto;`}
          onClick={(e) => e.stopPropagation()}
        >
          {showSetAll ? (
            <div css={css`display: flex; gap: ${theme.spacing[1]};`}>
              {(['off', 'ask', 'always_allow'] as ToolPermissionMode[]).map((mode) => (
                <Button
                  key={mode}
                  variant="ghost"
                  size="sm"
                  onClick={() => groupMutation.mutate({ source, mode })}
                  disabled={groupMutation.isPending}
                >
                  {modeLabels[mode]}
                </Button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setShowSetAll(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setShowSetAll(true)}>
              Set all to...
            </Button>
          )}
        </div>
      </div>

      {/* Tool rows */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            css={css`overflow: hidden;`}
          >
            <div
              css={css`
                padding-left: ${theme.spacing[3]};
                border-left: 1px solid ${theme.colors.border.light};
                margin-left: ${theme.spacing[1]};
              `}
            >
              {tools.map((tool) => (
                <ToolRow key={tool.toolName} tool={tool} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// ToolsSection — main settings section
// ============================================================================

export function ToolsSection() {
  const theme = useTheme();
  const { data: tools, isLoading } = trpc.tools.listTools.useQuery();

  // Group tools by source
  const groups = useMemo(() => {
    if (!tools) return [];
    const map = new Map<string, ToolPermission[]>();
    for (const tool of tools) {
      const existing = map.get(tool.toolSource) ?? [];
      existing.push(tool);
      map.set(tool.toolSource, existing);
    }
    // Sort: core first, then sdk:*, then plugin:*
    const entries = Array.from(map.entries());
    entries.sort(([a], [b]) => {
      const order = (s: string) => (s === 'core' ? 0 : s.startsWith('sdk:') ? 1 : 2);
      return order(a) - order(b) || a.localeCompare(b);
    });
    return entries;
  }, [tools]);

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* Header */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <Wrench size={20} css={css`color: ${theme.colors.text.secondary};`} />
          <Typography.Subtitle as="h2" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            Tools
          </Typography.Subtitle>
        </div>
        <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
          Control which tools Animus can use and when it needs your permission.
        </Typography.SmallBody>
      </div>

      {/* Risk tier legend */}
      <div css={css`
        display: flex;
        flex-wrap: wrap;
        gap: ${theme.spacing[4]};
        padding: ${theme.spacing[3]} ${theme.spacing[4]};
        border-radius: ${theme.borderRadius.default};
        background: ${theme.colors.background.paper};
        border: 1px solid ${theme.colors.border.light};
      `}>
        {(Object.entries(riskTierConfig) as [RiskTier, typeof riskTierConfig[RiskTier]][]).map(([tier, config]) => (
          <div key={tier} css={css`display: flex; align-items: center; gap: ${theme.spacing[1.5]};`}>
            <div css={css`
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background: ${config.color(theme)};
            `} />
            <Typography.Caption as="span" color="secondary">{config.label}</Typography.Caption>
          </div>
        ))}
      </div>

      {/* Tool groups */}
      {isLoading ? (
        <Typography.SmallBody color="hint">Loading tools...</Typography.SmallBody>
      ) : groups.length === 0 ? (
        <Typography.SmallBody color="hint">
          No tools registered yet. Tools will appear here as they are discovered.
        </Typography.SmallBody>
      ) : (
        <div>
          {groups.map(([source, groupTools]) => (
            <ToolGroup key={source} source={source} tools={groupTools} />
          ))}
        </div>
      )}
    </div>
  );
}
