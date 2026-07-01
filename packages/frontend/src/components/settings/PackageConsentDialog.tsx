/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import {
  ShieldCheck,
  ShieldWarning,
  Warning,
  CheckCircle,
  XCircle,
  Package,
  Wrench,
  Globe,
  FolderSimple,
  AddressBook,
  Brain,
  Plugs,
} from '@phosphor-icons/react';
import { useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Modal, Button, Badge, Typography } from '../ui';
import type { Theme } from '../../styles/theme';
import type { McpToolPreview, ToolPermissionMode, RiskTier } from '@animus-labs/shared';

// ============================================================================
// Types
// ============================================================================

interface VerificationResult {
  valid: boolean;
  manifest: {
    packageType: 'plugin' | 'channel';
    name: string;
    displayName?: string;
    version: string;
    description: string;
    author: { name: string; url?: string };
    license?: string;
    engineVersion?: string;
    permissions?: {
      tools?: string[];
      network?: string[] | boolean;
      filesystem?: string;
      contacts?: boolean;
      memory?: string;
    };
  } | null;
  signature: {
    status: 'valid' | 'invalid' | 'unsigned';
    signedBy: string | null;
    signedAt: string | null;
  };
  checksums: {
    verified: number;
    total: number;
    failures: string[];
  };
  errors: string[];
  warnings: string[];
  /**
   * For plugin packages: the MCP tool permission rows this plugin would
   * create, with their default modes. Drives the install-time consent
   * picker. Empty/absent for plugins with no MCP server.
   */
  toolPreview?: McpToolPreview[];
}

interface PackageConsentDialogProps {
  open: boolean;
  onClose: () => void;
  verification: VerificationResult | null;
  onConfirm: (grantedPermissions: string[]) => void;
  isInstalling: boolean;
}

// ============================================================================
// Tool permission picker (mirrors ToolsSection visual language)
// ============================================================================

const TOOL_MODE_LABELS: Record<ToolPermissionMode, string> = {
  off: 'Off',
  ask: 'Ask First',
  always_allow: 'Always Allow',
};

const TOOL_MODES: ToolPermissionMode[] = ['off', 'ask', 'always_allow'];

function riskTierColor(theme: Theme, tier: RiskTier): string {
  switch (tier) {
    case 'safe':
      return theme.colors.success.main;
    case 'communicates':
      return theme.colors.accent;
    case 'acts':
      return theme.colors.warning.main;
    case 'sensitive':
      return theme.colors.error.main;
  }
}

const RISK_TIER_LABELS: Record<RiskTier, string> = {
  safe: 'Safe',
  communicates: 'Communicates',
  acts: 'Acts',
  sensitive: 'Sensitive',
};

/**
 * Segmented Off / Ask First / Always Allow control. Visual parity with the
 * ToolModeSelector in ToolsSection (same border, mode colors, sizing). That
 * component is module-private to ToolsSection, so it is mirrored here rather
 * than exported, keeping a single visual language without touching settings.
 */
function ToolModeSelector({
  value,
  onChange,
  theme,
}: {
  value: ToolPermissionMode;
  onChange: (mode: ToolPermissionMode) => void;
  theme: Theme;
}) {
  const getModeColor = (mode: ToolPermissionMode) => {
    switch (mode) {
      case 'off':
        return theme.colors.error.main;
      case 'ask':
        return theme.colors.warning.main;
      case 'always_allow':
        return theme.colors.success.main;
    }
  };

  return (
    <div css={css`
      display: inline-flex;
      border-radius: ${theme.borderRadius.default};
      border: 1px solid ${theme.colors.border.default};
      overflow: hidden;
      flex-shrink: 0;
    `}>
      {TOOL_MODES.map((mode) => {
        const isActive = value === mode;
        const activeColor = getModeColor(mode);
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            css={css`
              padding: ${theme.spacing[1]} ${theme.spacing[2]};
              font-size: ${theme.typography.fontSize.xs};
              font-weight: ${isActive ? theme.typography.fontWeight.semibold : theme.typography.fontWeight.normal};
              cursor: pointer;
              transition: all ${theme.transitions.micro};
              white-space: nowrap;
              border-right: 1px solid ${theme.colors.border.default};
              &:last-child { border-right: none; }
              ${isActive
                ? css`background: ${activeColor}1a; color: ${activeColor};`
                : css`
                    background: transparent;
                    color: ${theme.colors.text.hint};
                    &:hover {
                      color: ${theme.colors.text.secondary};
                      background: ${theme.colors.background.elevated};
                    }
                  `}
            `}
          >
            {TOOL_MODE_LABELS[mode]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Sensitive-tier confirmation. Mirrors ToolsSection's
 * SensitiveToolWarningDialog pattern (icon chip, bulleted risks, error-tinted
 * footer, "I understand" affordance) so raising a sensitive MCP tool to
 * Always Allow at install time uses the same warning language users see in
 * Settings later.
 */
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
              {isBulk ? `Always allow ${toolNames.length} sensitive tools?` : 'Always allow a sensitive tool?'}
            </Typography.Subtitle>
            <Typography.Caption color="hint">
              This change has serious security implications
            </Typography.Caption>
          </div>
        </div>

        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {isBulk && (
            <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[1.5]};`}>
              {toolNames.map((name) => (
                <span key={name} css={css`
                  display: inline-flex; align-items: center;
                  padding: ${theme.spacing[0.5]} ${theme.spacing[2]};
                  font-size: ${theme.typography.fontSize.tiny};
                  font-family: ${theme.typography.fontFamily.mono};
                  background: ${theme.colors.error.main}0d;
                  border: 1px solid ${theme.colors.error.main}26;
                  border-radius: ${theme.borderRadius.full};
                  color: ${theme.colors.text.secondary};
                `}>
                  {name}
                </span>
              ))}
            </div>
          )}
          {[
            'This tool is classified as sensitive because it can perform actions with significant security implications.',
            'Setting it to "Always Allow" means the agent will never ask for your confirmation before using it, even in unexpected or potentially harmful situations.',
            'Only enable unrestricted access if you fully understand what this tool does and accept the risks.',
          ].map((risk, i) => (
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
            Only change this setting if you fully understand the risks. You can always change it back to "Ask First" later in settings.
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

function ToolPreviewRow({
  tool,
  mode,
  onChange,
  theme,
}: {
  tool: McpToolPreview;
  mode: ToolPermissionMode;
  onChange: (mode: ToolPermissionMode) => void;
  theme: Theme;
}) {
  const tierColor = riskTierColor(theme, tool.riskTier);

  return (
    <div css={css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing[3]};
      padding: ${theme.spacing[2]} 0;
      border-bottom: 1px solid ${theme.colors.border.light};
      &:last-child { border-bottom: none; }

      @media (max-width: ${theme.breakpoints.md}) {
        flex-direction: column;
        align-items: flex-start;
        gap: ${theme.spacing[2]};
      }
    `}>
      <div css={css`
        width: 6px; height: 6px; border-radius: 50%;
        background: ${tierColor};
        flex-shrink: 0;
        margin-top: 6px;
        align-self: flex-start;
      `} title={`${RISK_TIER_LABELS[tool.riskTier]} risk`} />
      <div css={css`flex: 1; min-width: 0;`}>
        <Typography.SmallBody as="div" css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
          {tool.dynamic
            ? `All tools from ${tool.displayName}`
            : tool.displayName}
        </Typography.SmallBody>
        <Typography.Caption as="div" color="hint" css={css`
          line-height: ${theme.typography.lineHeight.relaxed};
        `}>
          {tool.description}
        </Typography.Caption>
        {tool.dynamic && (
          <Typography.Caption as="div" color="hint" css={css`
            margin-top: ${theme.spacing[1]};
            font-style: italic;
            opacity: 0.85;
          `}>
            This applies to all of the plugin's tools.
          </Typography.Caption>
        )}
      </div>
      <ToolModeSelector value={mode} onChange={onChange} theme={theme} />
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================

export function PackageConsentDialog({
  open,
  onClose,
  verification,
  onConfirm,
  isInstalling,
}: PackageConsentDialogProps) {
  const theme = useTheme();

  const toolPreview = verification?.toolPreview ?? [];

  // Per-tool selected modes, initialized from each tool's manifest default.
  const [toolModes, setToolModes] = useState<Record<string, ToolPermissionMode>>({});
  // Pending sensitive raise awaiting explicit confirmation.
  const [pendingSensitive, setPendingSensitive] = useState<string | null>(null);

  const resolvedToolModes = useMemo(() => {
    const out: Record<string, ToolPermissionMode> = {};
    for (const t of toolPreview) {
      out[t.toolName] = toolModes[t.toolName] ?? t.defaultMode;
    }
    return out;
  }, [toolPreview, toolModes]);

  const sensitiveByName = useMemo(() => {
    const m = new Map<string, McpToolPreview>();
    for (const t of toolPreview) {
      if (t.riskTier === 'sensitive') m.set(t.toolName, t);
    }
    return m;
  }, [toolPreview]);

  if (!verification || !verification.manifest) return null;

  const { manifest, signature, checksums, errors, warnings } = verification;
  const permissions = manifest.permissions;

  const handleToolModeChange = (toolName: string, mode: ToolPermissionMode) => {
    if (mode === 'always_allow' && sensitiveByName.has(toolName)) {
      setPendingSensitive(toolName);
      return;
    }
    setToolModes((prev) => ({ ...prev, [toolName]: mode }));
  };

  const signatureBadge = {
    valid: { variant: 'success' as const, label: 'Signed', icon: ShieldCheck },
    invalid: { variant: 'error' as const, label: 'Invalid Signature', icon: XCircle },
    unsigned: { variant: 'warning' as const, label: 'Unsigned', icon: ShieldWarning },
  }[signature.status];

  // Build the list of permission strings for granting
  const permissionList: string[] = [];
  if (permissions?.tools?.length) permissionList.push(...permissions.tools.map(t => `tool:${t}`));
  if (permissions?.network) {
    if (typeof permissions.network === 'boolean') {
      permissionList.push('network:*');
    } else {
      permissionList.push(...permissions.network.map(h => `network:${h}`));
    }
  }
  if (permissions?.filesystem && permissions.filesystem !== 'none') permissionList.push(`filesystem:${permissions.filesystem}`);
  if (permissions?.contacts) permissionList.push('contacts:read');
  if (permissions?.memory && permissions.memory !== 'none') permissionList.push(`memory:${permissions.memory}`);

  const handleConfirm = () => {
    // Emit one toolmode token for EVERY previewed tool (even unchanged), so the
    // user's reviewed choices become authoritative locked overrides in the
    // seeder. Pre-existing tokens (tool:, network:, etc.) are preserved.
    const toolModeTokens = toolPreview.map(
      (t) => `toolmode:${t.toolName}=${resolvedToolModes[t.toolName] ?? t.defaultMode}`,
    );
    onConfirm([...permissionList, ...toolModeTokens]);
  };

  // Block install if signature is invalid
  const canInstall = verification.valid && signature.status !== 'invalid';

  // Filter out redundant signature warnings already shown by the inline banner
  const filteredWarnings = signature.status === 'unsigned'
    ? warnings.filter(w => !w.toLowerCase().includes('not signed'))
    : warnings;

  return (
    <Modal open={open} onClose={onClose}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
        {/* Header */}
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
          <Package size={24} css={css`color: ${theme.colors.accent};`} />
          <div css={css`flex: 1;`}>
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              Install "{manifest.displayName || manifest.name}"?
            </Typography.Subtitle>
            <Typography.Caption css={css`
              font-size: ${theme.typography.fontSize.tiny};
              opacity: 0.7;
            `} color="hint">
              v{manifest.version} by {manifest.author.name}
            </Typography.Caption>
          </div>
          <Badge variant={signatureBadge.variant}>
            <signatureBadge.icon size={12} css={css`margin-right: 4px;`} />
            {signatureBadge.label}
          </Badge>
        </div>

        {/* Description */}
        <Typography.SmallBody color="secondary">
          {manifest.description}
        </Typography.SmallBody>

        {/* Signature warning for unsigned packages */}
        {signature.status === 'unsigned' && (
          <div css={css`
            padding: ${theme.spacing[3]} ${theme.spacing[4]};
            background: ${theme.colors.warning.main}1a;
            border: 1px solid ${theme.colors.warning.main}33;
            border-radius: ${theme.borderRadius.default};
            display: flex;
            align-items: flex-start;
            gap: ${theme.spacing[2]};
          `}>
            <Warning size={16} weight="fill" css={css`color: ${theme.colors.warning.main}; flex-shrink: 0; margin-top: 2px;`} />
            <Typography.SmallBody color={theme.colors.warning.main}>
              This package is not signed and may not be from a trusted publisher. Only install packages you trust.
            </Typography.SmallBody>
          </div>
        )}

        {/* Signature error for invalid packages */}
        {signature.status === 'invalid' && (
          <div css={css`
            padding: ${theme.spacing[3]} ${theme.spacing[4]};
            background: ${theme.colors.error.main}1a;
            border: 1px solid ${theme.colors.error.main}33;
            border-radius: ${theme.borderRadius.default};
            display: flex;
            align-items: flex-start;
            gap: ${theme.spacing[2]};
          `}>
            <XCircle size={16} weight="fill" css={css`color: ${theme.colors.error.main}; flex-shrink: 0; margin-top: 2px;`} />
            <Typography.SmallBody color={theme.colors.error.main}>
              This package has an invalid signature. It may have been tampered with. Installation is blocked.
            </Typography.SmallBody>
          </div>
        )}

        {/* Permissions */}
        {permissions && (
          <div css={css`
            padding: ${theme.spacing[3]} ${theme.spacing[4]};
            background: ${theme.colors.background.paper};
            border-radius: ${theme.borderRadius.default};
            display: flex;
            flex-direction: column;
            gap: ${theme.spacing[3]};
          `}>
            <Typography.SmallBodyAlt css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
              Requested Permissions
            </Typography.SmallBodyAlt>
            <div css={css`display: flex; flex-direction: column;`}>
              <PermissionCategory
                icon={<Wrench size={13} />}
                label="Tools"
                values={permissions.tools?.length ? permissions.tools : null}
                theme={theme}
              />
              <PermissionCategory
                icon={<Globe size={13} />}
                label="Network"
                values={
                  typeof permissions.network === 'boolean'
                    ? (permissions.network ? ['Unrestricted'] : null)
                    : (permissions.network?.length ? permissions.network : null)
                }
                theme={theme}
              />
              <PermissionCategory
                icon={<FolderSimple size={13} />}
                label="Filesystem"
                values={permissions.filesystem && permissions.filesystem !== 'none' ? [permissions.filesystem] : null}
                theme={theme}
              />
              <PermissionCategory
                icon={<AddressBook size={13} />}
                label="Contacts"
                values={permissions.contacts ? ['Read access'] : null}
                theme={theme}
              />
              <PermissionCategory
                icon={<Brain size={13} />}
                label="Memory"
                values={permissions.memory && permissions.memory !== 'none' ? [permissions.memory] : null}
                theme={theme}
              />
            </div>
          </div>
        )}

        {/* Tool permissions (only when the plugin ships an MCP server) */}
        {toolPreview.length > 0 && (
          <div css={css`
            padding: ${theme.spacing[3]} ${theme.spacing[4]};
            background: ${theme.colors.background.paper};
            border-radius: ${theme.borderRadius.default};
            display: flex;
            flex-direction: column;
            gap: ${theme.spacing[2]};
          `}>
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
              <Plugs size={14} css={css`color: ${theme.colors.text.hint};`} />
              <Typography.SmallBodyAlt css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
                Tool permissions
              </Typography.SmallBodyAlt>
            </div>
            <Typography.Caption color="hint" css={css`
              line-height: ${theme.typography.lineHeight.relaxed};
            `}>
              Choose how Animus may use this plugin's tools. You can change these
              later in settings.
            </Typography.Caption>
            <div css={css`display: flex; flex-direction: column; margin-top: ${theme.spacing[1]};`}>
              {toolPreview.map((tool) => (
                <ToolPreviewRow
                  key={tool.toolName}
                  tool={tool}
                  mode={resolvedToolModes[tool.toolName] ?? tool.defaultMode}
                  onChange={(mode) => handleToolModeChange(tool.toolName, mode)}
                  theme={theme}
                />
              ))}
            </div>
          </div>
        )}

        {/* Checksums */}
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <CheckCircle size={14} weight="fill" css={css`color: ${theme.colors.success.main};`} />
          <Typography.Caption color="hint">
            {checksums.verified}/{checksums.total} files verified
          </Typography.Caption>
        </div>

        {/* Errors */}
        {errors.length > 0 && (
          <div css={css`
            padding: ${theme.spacing[2]} ${theme.spacing[3]};
            background: ${theme.colors.error.main}1a;
            border-radius: ${theme.borderRadius.default};
          `}>
            {errors.map((err, i) => (
              <Typography.SmallBody key={i} color={theme.colors.error.main}>
                {err}
              </Typography.SmallBody>
            ))}
          </div>
        )}

        {/* Warnings (filtered to avoid duplicating the signature banner) */}
        {filteredWarnings.length > 0 && (
          <div css={css`
            padding: ${theme.spacing[2]} ${theme.spacing[3]};
            background: ${theme.colors.warning.main}1a;
            border-radius: ${theme.borderRadius.default};
          `}>
            {filteredWarnings.map((warn, i) => (
              <Typography.SmallBody key={i} color={theme.colors.warning.main}>
                {warn}
              </Typography.SmallBody>
            ))}
          </div>
        )}

        {/* Actions */}
        <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!canInstall}
            loading={isInstalling}
          >
            {signature.status === 'unsigned' ? 'Install Anyway' : 'Install'}
          </Button>
        </div>
      </div>

      <SensitiveToolWarningDialog
        open={pendingSensitive !== null}
        onClose={() => setPendingSensitive(null)}
        onConfirm={() => {
          if (pendingSensitive) {
            setToolModes((prev) => ({ ...prev, [pendingSensitive]: 'always_allow' }));
          }
        }}
        toolNames={pendingSensitive ? [pendingSensitive] : []}
      />
    </Modal>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function PermissionCategory({
  icon,
  label,
  values,
  theme,
}: {
  icon: ReactNode;
  label: string;
  values: string[] | null;
  theme: Theme;
}) {
  const hasValues = values && values.length > 0;

  return (
    <div css={css`
      display: flex;
      align-items: ${hasValues && values.length > 1 ? 'flex-start' : 'center'};
      gap: ${theme.spacing[2]};
      padding: ${theme.spacing[1.5]} 0;
      border-bottom: 1px solid ${theme.colors.border.light};
      &:last-child { border-bottom: none; }
    `}>
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[1.5]};
        min-width: 100px;
        flex-shrink: 0;
        color: ${theme.colors.text.hint};
      `}>
        {icon}
        <Typography.Caption color="hint">{label}</Typography.Caption>
      </div>
      <div css={css`
        flex: 1;
        display: flex;
        flex-wrap: wrap;
        gap: ${theme.spacing[1]};
        justify-content: flex-end;
      `}>
        {hasValues ? (
          values.map((val, i) => (
            <span key={i} css={css`
              display: inline-flex;
              align-items: center;
              padding: ${theme.spacing[0.5]} ${theme.spacing[2]};
              font-size: ${theme.typography.fontSize.tiny};
              font-family: ${theme.typography.fontFamily.mono};
              background: ${theme.colors.accent}08;
              border: 1px solid ${theme.colors.border.default};
              border-radius: ${theme.borderRadius.full};
              color: ${theme.colors.text.secondary};
              line-height: ${theme.typography.lineHeight.tight};
              white-space: nowrap;
            `}>
              {val}
            </span>
          ))
        ) : (
          <Typography.Caption color="disabled">None</Typography.Caption>
        )}
      </div>
    </div>
  );
}
