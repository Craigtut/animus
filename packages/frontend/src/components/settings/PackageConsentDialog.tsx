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
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Modal, Button, Badge, Typography } from '../ui';
import type { Theme } from '../../styles/theme';

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
}

interface PackageConsentDialogProps {
  open: boolean;
  onClose: () => void;
  verification: VerificationResult | null;
  onConfirm: (grantedPermissions: string[]) => void;
  isInstalling: boolean;
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

  if (!verification || !verification.manifest) return null;

  const { manifest, signature, checksums, errors, warnings } = verification;
  const permissions = manifest.permissions;

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
    onConfirm(permissionList);
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
