/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import {
  ShieldCheck,
  Plus,
  Trash,
  GearFine,
  Eye,
  EyeSlash,
  Warning,
  CircleNotch,
} from '@phosphor-icons/react';
import { Button, Input, Modal, Typography, Card } from '../ui';
import { trpc } from '../../utils/trpc';

// ============================================================================
// Helpers
// ============================================================================

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ============================================================================
// Types
// ============================================================================

interface FormState {
  label: string;
  service: string;
  identity: string;
  password: string;
  notes: string;
}

const emptyForm: FormState = {
  label: '',
  service: '',
  identity: '',
  password: '',
  notes: '',
};

// ============================================================================
// PasswordsSection
// ============================================================================

export function PasswordsSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  // Data
  const { data: entries, isLoading } = trpc.vault.list.useQuery();
  const createMutation = trpc.vault.create.useMutation({
    onSuccess: () => utils.vault.list.invalidate(),
  });
  const updateMutation = trpc.vault.update.useMutation({
    onSuccess: () => utils.vault.list.invalidate(),
  });
  const deleteMutation = trpc.vault.delete.useMutation({
    onSuccess: () => utils.vault.list.invalidate(),
  });

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  // Handlers
  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowPassword(false);
    setFormOpen(true);
  };

  const openEdit = (entry: { id: string; label: string; service: string; identity: string | null; notes: string | null }) => {
    setEditingId(entry.id);
    setForm({
      label: entry.label,
      service: entry.service,
      identity: entry.identity ?? '',
      password: '',
      notes: entry.notes ?? '',
    });
    setShowPassword(false);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setShowPassword(false);
  };

  const handleSave = () => {
    if (!form.label.trim() || !form.service.trim()) return;

    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        label: form.label.trim(),
        service: form.service.trim(),
        identity: form.identity.trim() || null,
        notes: form.notes.trim() || null,
        ...(form.password ? { password: form.password } : {}),
      }, {
        onSuccess: closeForm,
      });
    } else {
      if (!form.password) return;
      createMutation.mutate(
        {
          label: form.label.trim(),
          service: form.service.trim(),
          identity: form.identity.trim() || null,
          password: form.password,
          notes: form.notes.trim() || null,
        },
        { onSuccess: closeForm },
      );
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate({ id: deleteTarget.id }, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  const isFormValid = form.label.trim() && form.service.trim() && (editingId || form.password);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* Header */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <div css={css`
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: ${theme.spacing[3]};
        `}>
          <div>
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              Passwords
            </Typography.Subtitle>
            <Typography.SmallBody color="secondary" css={css`margin-top: ${theme.spacing[1]};`}>
              Accounts your Animus can use. Store credentials here and your Animus can access them when it needs to log in or authenticate. It never sees the actual passwords, only enough to know which account to use.
            </Typography.SmallBody>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={openCreate}
          >
            <Plus size={16} />
            Add account
          </Button>
        </div>
      </div>

      {/* Security trust banner */}
      <div css={css`
        display: flex;
        flex-direction: column;
        gap: ${theme.spacing[2]};
        padding: ${theme.spacing[4]};
        background: ${theme.colors.background.paper};
        border: 1px solid ${theme.colors.border.default};
        border-radius: ${theme.borderRadius.default};
      `}>
        <div css={css`display: flex; align-items: flex-start; gap: ${theme.spacing[3]};`}>
          <ShieldCheck size={20} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0; margin-top: 1px;`} />
          <Typography.SmallBody color="secondary">
            Passwords are encrypted at rest. Your Animus sees only the account name and a hint of the last few characters. Raw values never appear in thoughts, logs, or transcripts.
          </Typography.SmallBody>
        </div>
        <Typography.Caption color="hint" css={css`padding-left: 30px;`}>
          We recommend creating dedicated accounts for your Animus rather than sharing your personal credentials.
        </Typography.Caption>
      </div>

      {/* Entry list */}
      {isLoading ? (
        <div css={css`
          display: flex;
          align-items: center;
          justify-content: center;
          padding: ${theme.spacing[10]} 0;
          color: ${theme.colors.text.secondary};
        `}>
          <CircleNotch size={24} css={css`animation: spin 800ms linear infinite; @keyframes spin { to { transform: rotate(360deg); } }`} />
        </div>
      ) : !entries?.length ? (
        <Card variant="outlined" padding="lg">
          <div css={css`
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: ${theme.spacing[3]};
            text-align: center;
            padding: ${theme.spacing[4]} 0;
          `}>
            <ShieldCheck size={40} weight="light" css={css`color: ${theme.colors.text.disabled};`} />
            <Typography.SmallBody color="secondary">
              No accounts stored yet. Add your first account to give your Animus access to external services.
            </Typography.SmallBody>
          </div>
        </Card>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {entries.map((entry) => (
            <Card key={entry.id} variant="outlined" padding="md">
              <div css={css`
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: ${theme.spacing[4]};

                @media (max-width: ${theme.breakpoints.sm}) {
                  flex-direction: column;
                }
              `}>
                {/* Entry info */}
                <div css={css`flex: 1; min-width: 0;`}>
                  <Typography.SmallBodyAlt css={css`
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                  `}>
                    {entry.label}
                  </Typography.SmallBodyAlt>
                  <Typography.Caption color="secondary" css={css`margin-top: ${theme.spacing[0.5]};`}>
                    {entry.service}
                  </Typography.Caption>
                  {entry.identity && (
                    <Typography.Caption color="hint" css={css`margin-top: ${theme.spacing[0.5]};`}>
                      {entry.identity}
                    </Typography.Caption>
                  )}
                  <div css={css`
                    display: flex;
                    flex-wrap: wrap;
                    align-items: center;
                    gap: ${theme.spacing[3]};
                    margin-top: ${theme.spacing[2]};
                  `}>
                    <Typography.Caption css={css`
                      font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
                      color: ${theme.colors.text.hint};
                      letter-spacing: 0.05em;
                    `}>
                      {entry.hint}
                    </Typography.Caption>
                    {entry.notes && (
                      <Typography.Caption color="hint" css={css`
                        display: -webkit-box;
                        -webkit-line-clamp: 1;
                        -webkit-box-orient: vertical;
                        overflow: hidden;
                      `}>
                        {entry.notes}
                      </Typography.Caption>
                    )}
                    <Typography.Caption color="hint">
                      {formatDate(entry.updatedAt)}
                    </Typography.Caption>
                  </div>
                </div>

                {/* Actions */}
                <div css={css`
                  display: flex;
                  gap: ${theme.spacing[1]};
                  flex-shrink: 0;
                `}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(entry)}
                    title="Edit"
                  >
                    <GearFine size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget({ id: entry.id, label: entry.label })}
                    title="Delete"
                  >
                    <Trash size={16} />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal open={formOpen} onClose={closeForm}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
          <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            {editingId ? 'Edit account' : 'Add account'}
          </Typography.Subtitle>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            {/* Account name */}
            <div>
              <Typography.SmallBodyAlt as="label" css={css`display: block; margin-bottom: ${theme.spacing[1.5]};`}>
                Account name
              </Typography.SmallBodyAlt>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. GitHub Bot, Work Email"
                maxLength={100}
                autoFocus
              />
            </div>

            {/* Website */}
            <div>
              <Typography.SmallBodyAlt as="label" css={css`display: block; margin-bottom: ${theme.spacing[1.5]};`}>
                Website
              </Typography.SmallBodyAlt>
              <Input
                value={form.service}
                onChange={(e) => setForm({ ...form, service: e.target.value })}
                placeholder="e.g. github.com"
                maxLength={200}
              />
            </div>

            {/* Identity */}
            <div>
              <Typography.SmallBodyAlt as="label" css={css`display: block; margin-bottom: ${theme.spacing[1.5]};`}>
                Username or email
                <Typography.Caption as="span" color="hint" style={{ marginLeft: 6 }}>optional</Typography.Caption>
              </Typography.SmallBodyAlt>
              <Input
                value={form.identity}
                onChange={(e) => setForm({ ...form, identity: e.target.value })}
                placeholder="e.g. animus-bot@example.com"
                maxLength={200}
              />
            </div>

            {/* Password */}
            <div>
              <Typography.SmallBodyAlt as="label" css={css`display: block; margin-bottom: ${theme.spacing[1.5]};`}>
                Password
                {editingId && (
                  <Typography.Caption as="span" color="hint" style={{ marginLeft: 6 }}>leave blank to keep current</Typography.Caption>
                )}
              </Typography.SmallBodyAlt>
              <div css={css`position: relative;`}>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editingId ? 'Enter new password to change' : 'Password or API key'}
                  css={css`padding-right: 40px;`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  css={css`
                    position: absolute;
                    right: 8px;
                    top: 50%;
                    transform: translateY(-50%);
                    background: none;
                    border: none;
                    cursor: pointer;
                    color: ${theme.colors.text.hint};
                    padding: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;

                    &:hover {
                      color: ${theme.colors.text.secondary};
                    }
                  `}
                >
                  {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Notes */}
            <div>
              <Typography.SmallBodyAlt as="label" css={css`display: block; margin-bottom: ${theme.spacing[1.5]};`}>
                Notes
                <Typography.Caption as="span" color="hint" style={{ marginLeft: 6 }}>optional</Typography.Caption>
              </Typography.SmallBodyAlt>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Notes on when or how to use this account"
                maxLength={500}
                rows={2}
                css={css`
                  width: 100%;
                  padding: ${theme.spacing[2]} ${theme.spacing[3]};
                  border: 1px solid ${theme.colors.border.default};
                  border-radius: ${theme.borderRadius.default};
                  background: ${theme.colors.background.paper};
                  color: ${theme.colors.text.primary};
                  font-family: inherit;
                  font-size: ${theme.typography.fontSize.sm};
                  line-height: ${theme.typography.lineHeight.normal};
                  resize: vertical;
                  outline: none;
                  transition: border-color ${theme.transitions.fast};

                  &:focus {
                    border-color: ${theme.colors.border.focus};
                  }

                  &::placeholder {
                    color: ${theme.colors.text.hint};
                  }
                `}
              />
            </div>
          </div>
          <div css={css`display: flex; justify-content: flex-end; gap: ${theme.spacing[2]};`}>
            <Button variant="ghost" size="sm" onClick={closeForm}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={!isFormValid}
              loading={isSaving}
            >
              {editingId ? 'Save' : 'Add account'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            <Warning size={24} css={css`color: ${theme.colors.warning.main}; flex-shrink: 0;`} />
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              Remove account
            </Typography.Subtitle>
          </div>
          <Typography.SmallBody color="secondary">
            This will permanently remove the stored credentials for <strong>{deleteTarget?.label}</strong>. Your Animus will no longer be able to use this account.
          </Typography.SmallBody>
          <div css={css`display: flex; justify-content: flex-end; gap: ${theme.spacing[2]};`}>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              loading={deleteMutation.isPending}
            >
              Remove
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
