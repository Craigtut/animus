/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, CaretDown } from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { Typography } from '../ui';
import { Badge } from './HeartbeatsSection';
import type { ContextSection, ContextSectionCategory } from '@animus-labs/shared';

// ============================================================================
// Category colors
// ============================================================================

function categoryColor(category: ContextSectionCategory, theme: ReturnType<typeof useTheme>): string {
  switch (category) {
    case 'identity':  return '#8B7EC8';
    case 'trigger':   return theme.colors.accent;
    case 'state':     return '#C4943A';
    case 'memory':    return '#4A9B6E';
    case 'goals':     return '#5B8DEF';
    case 'system':    return theme.colors.text.hint;
    case 'plugins':   return '#2D8A6E';
    default:          return theme.colors.text.secondary;
  }
}

// Badge imported from HeartbeatsSection (shared component)

// ============================================================================
// Tab Bar
// ============================================================================

type TabId = 'system' | 'user';

function TabBar({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  const theme = useTheme();
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'system', label: 'System Prompt' },
    { id: 'user', label: 'User Message' },
  ];

  return (
    <div css={css`
      display: flex;
      gap: ${theme.spacing[4]};
      border-bottom: 1px solid ${theme.colors.border.light};
      margin-bottom: ${theme.spacing[4]};
    `}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          css={css`
            font-size: ${theme.typography.fontSize.sm};
            font-weight: ${active === tab.id
              ? theme.typography.fontWeight.semibold
              : theme.typography.fontWeight.normal};
            color: ${active === tab.id
              ? theme.colors.text.primary
              : theme.colors.text.secondary};
            padding: ${theme.spacing[2]} 0;
            border-bottom: 2px solid ${active === tab.id
              ? theme.colors.accent
              : 'transparent'};
            cursor: pointer;
            transition: all ${theme.transitions.micro};

            &:hover {
              color: ${theme.colors.text.primary};
            }
          `}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Token Summary
// ============================================================================

function TokenSummary({ sections }: { sections: ContextSection[] }) {
  const theme = useTheme();

  const includedSections = sections.filter((s) => s.included);
  const totalTokens = includedSections.reduce((sum, s) => sum + s.tokenCount, 0);
  const includedCount = includedSections.length;
  const excludedCount = sections.length - includedCount;

  return (
    <div css={css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing[4]};
      margin-bottom: ${theme.spacing[4]};
      flex-wrap: wrap;
    `}>
      <div>
        <Typography.Caption color="hint" css={css`display: block;`}>Total Tokens</Typography.Caption>
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: ${theme.typography.fontSize.sm};
          font-weight: ${theme.typography.fontWeight.semibold};
          color: ${theme.colors.text.primary};
        `}>
          ~{totalTokens.toLocaleString()}
        </span>
      </div>
      <div>
        <Typography.Caption color="hint" css={css`display: block;`}>Sections</Typography.Caption>
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: ${theme.typography.fontSize.sm};
          color: ${theme.colors.text.primary};
        `}>
          {includedCount} included
        </span>
        {excludedCount > 0 && (
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: ${theme.typography.fontSize.sm};
            color: ${theme.colors.text.hint};
            margin-left: ${theme.spacing[1]};
          `}>
            / {excludedCount} excluded
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Section Card
// ============================================================================

function SectionCard({ section }: { section: ContextSection }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const canExpand = section.included && section.content != null;

  return (
    <div
      role={canExpand ? 'button' : undefined}
      tabIndex={canExpand ? 0 : undefined}
      onClick={canExpand ? () => setExpanded((e) => !e) : undefined}
      onKeyDown={canExpand ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded((v) => !v);
        }
      } : undefined}
      css={css`
        border: 1px solid ${theme.colors.border.light};
        border-radius: ${theme.borderRadius.md};
        margin-bottom: ${theme.spacing[2]};
        opacity: ${section.included ? 1 : 0.5};
        cursor: ${canExpand ? 'pointer' : 'default'};
        transition: background ${theme.transitions.micro};
        overflow: hidden;

        ${canExpand ? `&:hover {
          background: ${theme.mode === 'light'
            ? 'rgba(0, 0, 0, 0.02)'
            : 'rgba(255, 255, 255, 0.02)'};
        }` : ''}
      `}
    >
      {/* Header row */}
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        padding: ${theme.spacing[2]} ${theme.spacing[3]};
      `}>
        <Badge label={section.category} color={categoryColor(section.category, theme)} />
        <span css={css`
          font-size: ${theme.typography.fontSize.sm};
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${section.included ? theme.colors.text.primary : theme.colors.text.secondary};
        `}>
          {section.title}
        </span>
        <span css={css`flex: 1;`} />
        {section.included && (
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.text.hint};
          `}>
            ~{section.tokenCount.toLocaleString()} tok
          </span>
        )}
        {canExpand && (
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.15 }}
            css={css`
              display: flex;
              align-items: center;
              color: ${theme.colors.text.hint};
            `}
          >
            <CaretDown size={12} />
          </motion.span>
        )}
      </div>

      {/* Excluded reason */}
      {!section.included && section.reason && (
        <div css={css`
          padding: 0 ${theme.spacing[3]} ${theme.spacing[2]};
        `}>
          <Typography.Caption color="hint" css={css`font-style: italic;`}>
            {section.reason}
          </Typography.Caption>
        </div>
      )}

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && section.content && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            css={css`overflow: hidden;`}
          >
            <div css={css`
              border-top: 1px solid ${theme.colors.border.light};
              padding: ${theme.spacing[3]};
            `}>
              <pre css={css`
                font-family: ${theme.typography.fontFamily.mono};
                font-size: 0.8rem;
                line-height: 1.5;
                white-space: pre-wrap;
                word-break: break-word;
                color: ${theme.colors.text.primary};
                margin: 0;
              `}>
                {section.content}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ContextInspector({
  tickNumber,
  onBack,
}: {
  tickNumber: number;
  onBack: () => void;
}) {
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState<TabId>('user');

  const { data, isLoading } = trpc.heartbeat.getTickDetail.useQuery(
    { tickNumber },
    { retry: false },
  );

  const systemSections = useMemo<ContextSection[]>(() => {
    if (!data) return [];
    const manifest = data.systemPromptManifest as ContextSection[] | null;
    return manifest ?? [];
  }, [data]);

  const userSections = useMemo<ContextSection[]>(() => {
    if (!data) return [];
    const manifest = data.userMessageManifest as ContextSection[] | null;
    return manifest ?? [];
  }, [data]);

  const activeSections = activeTab === 'system' ? systemSections : userSections;
  const isWarmSession = data?.sessionState === 'warm';
  const noSystemManifest = activeTab === 'system' && systemSections.length === 0;

  if (isLoading) {
    return (
      <Typography.Body serif italic color="hint" css={css`text-align: center; padding: 4rem 0;`}>
        Loading context...
      </Typography.Body>
    );
  }

  if (!data) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <Typography.Body serif italic color="hint" css={css`text-align: center; padding: 4rem 0;`}>
          Tick #{tickNumber} not found.
        </Typography.Body>
      </div>
    );
  }

  return (
    <div>
      <BackButton onBack={onBack} />

      {/* Header */}
      <div css={css`margin-bottom: ${theme.spacing[4]};`}>
        <Typography.Subtitle color="primary">
          Context Inspector: Tick #{tickNumber}
        </Typography.Subtitle>
      </div>

      <TabBar active={activeTab} onChange={setActiveTab} />

      {noSystemManifest ? (
        <Typography.Body serif italic color="hint" css={css`text-align: center; padding: 2rem 0;`}>
          {isWarmSession
            ? 'System prompt not available for warm sessions. It was sent during the initial cold session.'
            : 'No system prompt manifest available for this tick. This tick was recorded before the context inspector feature was added.'}
        </Typography.Body>
      ) : activeSections.length === 0 ? (
        <Typography.Body serif italic color="hint" css={css`text-align: center; padding: 2rem 0;`}>
          No manifest available for this tick. This tick was recorded before the context inspector feature was added.
        </Typography.Body>
      ) : (
        <>
          <TokenSummary sections={activeSections} />
          {activeSections.map((section) => (
            <SectionCard key={section.id} section={section} />
          ))}
        </>
      )}
    </div>
  );
}

// ============================================================================
// Back Button
// ============================================================================

function BackButton({ onBack }: { onBack: () => void }) {
  const theme = useTheme();
  return (
    <button
      onClick={onBack}
      css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[1]};
        font-size: ${theme.typography.fontSize.sm};
        color: ${theme.colors.text.secondary};
        cursor: pointer;
        padding: ${theme.spacing[1]} 0;
        margin-bottom: ${theme.spacing[4]};
        transition: color ${theme.transitions.micro};

        &:hover { color: ${theme.colors.text.primary}; }
      `}
    >
      <ArrowLeft size={14} />
      Back to timeline
    </button>
  );
}
