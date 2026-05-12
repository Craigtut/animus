/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wrench,
  CaretRight,
  CaretDown,
  ShieldWarning,
  Warning,
  ChatCircleDots,
  Globe,
  FolderOpen,
  Terminal,
  Key,
  PuzzlePiece,
  Lock,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { Typography, Badge, Button, Modal, Toggle } from '../ui';
import { trpc } from '../../utils/trpc';
import type { Theme } from '../../styles/theme';
import type { ToolPermission, ToolPermissionMode } from '@animus-labs/shared';
import {
  TOOL_UI_CONFIG,
  TOOL_CATEGORY_META,
  getToolUIConfig,
  type ToolUICategory,
} from '@animus-labs/shared';

// ============================================================================
// Category visual config
// ============================================================================

const categoryIcons: Record<ToolUICategory, PhosphorIcon> = {
  messaging: ChatCircleDots,
  web: Globe,
  files: FolderOpen,
  shell: Terminal,
  credentials: Key,
  plugin: PuzzlePiece,
};

const modeLabels: Record<ToolPermissionMode, string> = {
  off: 'Off',
  ask: 'Ask First',
  always_allow: 'Always Allow',
};

// ============================================================================
// Sensitive tool warning descriptions
// ============================================================================

const sensitiveToolWarnings: Record<string, { title: string; risks: string[] }> = {
  run_with_credentials: {
    title: 'Run With Credentials',
    risks: [
      'This tool is used legitimately by plugins and channels that need API keys or tokens to function. The agent will ask to use it during normal operation, and that is expected. With "Ask First" enabled, you can verify each request is using the right credential for the right purpose.',
      'This tool injects your stored secrets (API keys, passwords, tokens) into the execution environment as plain-text environment variables.',
      'If set to "Always Allow," the agent can access any of your stored credentials at any time without asking, and could inadvertently expose them in logs, send them to external services, or include them in generated output.',
      'A single prompt injection or unexpected agent behavior could leak every secret you have stored.',
    ],
  },
  Bash: {
    title: 'Bash Shell',
    risks: [
      'This tool executes arbitrary shell commands on your machine with your user permissions. It can read, write, and delete any file you have access to.',
      'If set to "Always Allow," the agent can run any command without your review: install software, modify system files, access private data, make network requests, or execute downloaded scripts.',
      'A single malformed or malicious command could delete important files, exfiltrate data, install malware, or make irreversible changes to your system.',
    ],
  },
};

const defaultSensitiveWarning = {
  title: 'Sensitive Tool',
  risks: [
    'This tool is classified as sensitive because it can perform actions with significant security implications.',
    'Setting it to "Always Allow" means the agent will never ask for your confirmation before using it, even in unexpected or potentially harmful situations.',
    'Only enable unrestricted access if you fully understand what this tool does and accept the risks.',
  ],
};

// ============================================================================
// SensitiveToolWarningDialog
// ============================================================================

function SensitiveToolWarningDialog({
  open,
  onClose,
  onConfirm,
  toolNames,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  toolNames: string[];
}) {
  const theme = useTheme();
  const isBulk = toolNames.length > 1;

  return (
    <Modal open={open} onClose={onClose} maxWidth="520px">
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
          <div css={css`
            display: flex; align-items: center; justify-content: center;
            width: 40px; height: 40px;
            border-radius: ${theme.borderRadius.default};
            background: ${theme.colors.error.main}1a;
            flex-shrink: 0;
          `}>
            <ShieldWarning size={22} weight="fill" css={css`color: ${theme.colors.error.main};`} />
          </div>
          <div>
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              {isBulk ? `Unrestrict ${toolNames.length} sensitive tools?` : 'Remove safety gate?'}
            </Typography.Subtitle>
            <Typography.Caption color="hint">
              This change has serious security implications
            </Typography.Caption>
          </div>
        </div>

        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          {toolNames.map((toolName) => {
            const warning = sensitiveToolWarnings[toolName] ?? defaultSensitiveWarning;
            return (
              <div key={toolName}>
                {isBulk && (
                  <Typography.SmallBodyAlt css={css`
                    font-weight: ${theme.typography.fontWeight.medium};
                    margin-bottom: ${theme.spacing[2]};
                    display: flex; align-items: center; gap: ${theme.spacing[1.5]};
                  `}>
                    <Warning size={14} css={css`color: ${theme.colors.error.main};`} />
                    {warning.title}
                  </Typography.SmallBodyAlt>
                )}
                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                  {warning.risks.map((risk, i) => (
                    <div key={i} css={css`display: flex; gap: ${theme.spacing[2]}; align-items: flex-start;`}>
                      <div css={css`
                        width: 4px; min-height: 4px; border-radius: 50%;
                        background: ${theme.colors.error.main};
                        flex-shrink: 0; margin-top: 8px;
                      `} />
                      <Typography.SmallBody color="secondary" css={css`
                        line-height: ${theme.typography.lineHeight.relaxed};
                      `}>
                        {risk}
                      </Typography.SmallBody>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div css={css`
          padding: ${theme.spacing[3]} ${theme.spacing[4]};
          background: ${theme.colors.error.main}0d;
          border: 1px solid ${theme.colors.error.main}26;
          border-radius: ${theme.borderRadius.default};
          display: flex; align-items: flex-start; gap: ${theme.spacing[2]};
        `}>
          <Warning size={16} weight="fill" css={css`
            color: ${theme.colors.error.main}; flex-shrink: 0; margin-top: 2px;
          `} />
          <Typography.SmallBody css={css`color: ${theme.colors.error.main};`}>
            Only change this setting if you fully understand the risks. You can always change it back to "Ask First" later.
          </Typography.SmallBody>
        </div>

        <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
          <Button variant="ghost" size="sm" onClick={onClose}>Keep "Ask First"</Button>
          <Button
            size="sm"
            onClick={() => { onConfirm(); onClose(); }}
            css={css`background: ${theme.colors.error.main}; &:hover { background: ${theme.colors.error.dark}; }`}
          >
            I understand, allow always
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// ToolModeSelector — segmented control for Off / Ask / Always Allow
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
    <div css={css`
      display: inline-flex;
      border-radius: ${theme.borderRadius.default};
      border: 1px solid ${theme.colors.border.default};
      overflow: hidden;
    `}>
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
                ? css`background: ${activeColor}1a; color: ${activeColor};`
                : css`
                    background: transparent;
                    color: ${theme.colors.text.hint};
                    &:hover:not(:disabled) {
                      color: ${theme.colors.text.secondary};
                      background: ${theme.colors.background.elevated};
                    }
                  `}
              &:disabled { opacity: 0.5; }
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
// ToolRow — single tool with name, description, and mode selector
// ============================================================================

function ToolRow({ tool, compact }: { tool: ToolPermission; compact?: boolean }) {
  const theme = useTheme();
  const utils = trpc.useUtils();
  const [showWarning, setShowWarning] = useState(false);
  const mutation = trpc.tools.updatePermission.useMutation({
    onSuccess: () => utils.tools.listTools.invalidate(),
  });

  const handleModeChange = useCallback((mode: ToolPermissionMode) => {
    if (mode === 'always_allow' && tool.riskTier === 'sensitive') {
      setShowWarning(true);
      return;
    }
    mutation.mutate({ toolName: tool.toolName, mode });
  }, [tool.riskTier, tool.toolName, mutation]);

  return (
    <>
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[3]};
        padding: ${compact ? theme.spacing[1.5] : theme.spacing[2]} 0;

        @media (max-width: ${theme.breakpoints.md}) {
          flex-direction: column;
          align-items: flex-start;
          gap: ${theme.spacing[2]};
        }
      `}>
        <div css={css`flex: 1; min-width: 0;`}>
          <Typography.SmallBody as="div" css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
            {tool.displayName}
          </Typography.SmallBody>
          <Typography.Caption as="div" color="hint" css={css`
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          `}>
            {tool.description}
          </Typography.Caption>
        </div>
        <ToolModeSelector
          value={tool.mode}
          onChange={handleModeChange}
          disabled={mutation.isPending}
        />
      </div>
      <SensitiveToolWarningDialog
        open={showWarning}
        onClose={() => setShowWarning(false)}
        onConfirm={() => mutation.mutate({ toolName: tool.toolName, mode: 'always_allow' })}
        toolNames={[tool.toolName]}
      />
    </>
  );
}

// ============================================================================
// ProactiveToggle — simplified on/off for proactive messaging
// ============================================================================

function ProactiveToggle({ tool }: { tool: ToolPermission }) {
  const theme = useTheme();
  const utils = trpc.useUtils();
  const mutation = trpc.tools.updatePermission.useMutation({
    onSuccess: () => utils.tools.listTools.invalidate(),
  });

  const isOn = tool.mode === 'always_allow';

  return (
    <div css={css`
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: ${theme.spacing[2]} 0;
    `}>
      <div css={css`flex: 1; min-width: 0; margin-right: ${theme.spacing[4]};`}>
        <Typography.SmallBody as="div" css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
          Proactive messages
        </Typography.SmallBody>
        <Typography.Caption as="div" color="hint">
          Allow Animus to message you first, without waiting for you to start a conversation.
        </Typography.Caption>
      </div>
      <Toggle
        checked={isOn}
        onChange={(checked) => mutation.mutate({
          toolName: tool.toolName,
          mode: checked ? 'always_allow' : 'off',
        })}
        disabled={mutation.isPending}
      />
    </div>
  );
}

// ============================================================================
// CategorySection — a functional group of tools
// ============================================================================

function CategorySection({
  category,
  tools,
  pluginName,
}: {
  category: ToolUICategory;
  tools: ToolPermission[];
  pluginName?: string;
}) {
  const theme = useTheme();
  const meta = TOOL_CATEGORY_META[category];
  const Icon = categoryIcons[category];

  if (category === 'messaging') {
    const proactiveTool = tools.find((t) => t.toolName === 'send_proactive_message');
    if (!proactiveTool) return null;
    return (
      <div css={css`
        padding: ${theme.spacing[4]};
        border: 1px solid ${theme.colors.border.light};
        border-radius: ${theme.borderRadius.default};
        background: ${theme.colors.background.paper};
      `}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; margin-bottom: ${theme.spacing[2]};`}>
          <Icon size={18} css={css`color: ${theme.colors.text.secondary};`} />
          <Typography.SmallBody as="div" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            {meta.label}
          </Typography.SmallBody>
        </div>
        <Typography.Caption as="div" color="hint" css={css`margin-bottom: ${theme.spacing[2]};`}>
          {meta.description}
        </Typography.Caption>
        <ProactiveToggle tool={proactiveTool} />
      </div>
    );
  }

  return (
    <div css={css`
      padding: ${theme.spacing[4]};
      border: 1px solid ${theme.colors.border.light};
      border-radius: ${theme.borderRadius.default};
      background: ${theme.colors.background.paper};
    `}>
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; margin-bottom: ${theme.spacing[1]};`}>
        <Icon size={18} css={css`color: ${theme.colors.text.secondary};`} />
        <Typography.SmallBody as="div" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          {pluginName ?? meta.label}
        </Typography.SmallBody>
        {tools.length > 1 && <Badge variant="default">{tools.length}</Badge>}
      </div>
      <Typography.Caption as="div" color="hint" css={css`margin-bottom: ${theme.spacing[1]};`}>
        {pluginName ? `Tools provided by the ${pluginName} plugin.` : meta.description}
      </Typography.Caption>
      {tools.map((tool) => (
        <ToolRow key={tool.toolName} tool={tool} compact={tools.length > 3} />
      ))}
    </div>
  );
}

// ============================================================================
// LockedToolsDisclosure — expandable section showing infrastructure tools
// ============================================================================

function LockedToolsDisclosure({ tools }: { tools: ToolPermission[] }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  if (tools.length === 0) return null;

  return (
    <div css={css`
      border: 1px solid ${theme.colors.border.light};
      border-radius: ${theme.borderRadius.default};
      overflow: hidden;
    `}>
      <button
        onClick={() => setExpanded((e) => !e)}
        css={css`
          width: 100%;
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          padding: ${theme.spacing[3]} ${theme.spacing[4]};
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: left;
          &:hover { background: ${theme.colors.background.elevated}; }
        `}
      >
        {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
        <Lock size={14} css={css`color: ${theme.colors.text.hint};`} />
        <Typography.Caption as="span" color="secondary">
          Show all tools
        </Typography.Caption>
        <Badge variant="default">{tools.length}</Badge>
        <Typography.Caption as="span" color="hint" css={css`margin-left: auto;`}>
          Always allowed
        </Typography.Caption>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            css={css`overflow: hidden;`}
          >
            <div css={css`
              padding: 0 ${theme.spacing[4]} ${theme.spacing[3]};
              border-top: 1px solid ${theme.colors.border.light};
            `}>
              <Typography.Caption as="div" color="hint" css={css`
                padding: ${theme.spacing[3]} 0 ${theme.spacing[2]};
                line-height: ${theme.typography.lineHeight.relaxed};
              `}>
                Infrastructure tools that Animus needs to function. These are always allowed and
                typically do not need to be changed.
              </Typography.Caption>
              {tools.map((tool) => (
                <ToolRow key={tool.toolName} tool={tool} compact />
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

  const { visibleCategories, lockedTools, pluginGroups } = useMemo(() => {
    if (!tools) return { visibleCategories: [], lockedTools: [], pluginGroups: [] };

    const locked: ToolPermission[] = [];
    const categoryMap = new Map<ToolUICategory, ToolPermission[]>();
    const plugins = new Map<string, ToolPermission[]>();

    for (const tool of tools) {
      const config = getToolUIConfig(tool.toolName, tool.toolSource);

      if (config.visibility === 'locked') {
        locked.push(tool);
        continue;
      }

      if (tool.toolSource.startsWith('plugin:')) {
        const pluginName = tool.toolSource.slice(7);
        const existing = plugins.get(pluginName) ?? [];
        existing.push(tool);
        plugins.set(pluginName, existing);
        continue;
      }

      if (config.category) {
        const existing = categoryMap.get(config.category) ?? [];
        existing.push(tool);
        categoryMap.set(config.category, existing);
      }
    }

    const sortedCategories = Array.from(categoryMap.entries())
      .sort(([a], [b]) => (TOOL_CATEGORY_META[a]?.order ?? 99) - (TOOL_CATEGORY_META[b]?.order ?? 99));

    const sortedPlugins = Array.from(plugins.entries())
      .sort(([a], [b]) => a.localeCompare(b));

    return {
      visibleCategories: sortedCategories,
      lockedTools: locked,
      pluginGroups: sortedPlugins,
    };
  }, [tools]);

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
      {/* Header */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <Wrench size={20} css={css`color: ${theme.colors.text.secondary};`} />
          <Typography.Subtitle as="h2" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            Tools & Permissions
          </Typography.Subtitle>
        </div>
        <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
          Control what Animus can do and when it needs your permission.
        </Typography.SmallBody>
      </div>

      {/* Content */}
      {isLoading ? (
        <Typography.SmallBody color="hint">Loading tools...</Typography.SmallBody>
      ) : (
        <>
          {/* Visible category sections */}
          {visibleCategories.map(([category, categoryTools]) => (
            <CategorySection key={category} category={category} tools={categoryTools} />
          ))}

          {/* Plugin groups */}
          {pluginGroups.map(([pluginName, pluginTools]) => (
            <CategorySection
              key={pluginName}
              category="plugin"
              tools={pluginTools}
              pluginName={pluginName}
            />
          ))}

          {/* Locked tools disclosure */}
          <LockedToolsDisclosure tools={lockedTools} />
        </>
      )}
    </div>
  );
}
