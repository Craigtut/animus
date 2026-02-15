/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo } from 'react';
import { Button, Input, Modal, Typography } from '../../components/ui';
import { ChannelIcon, useChannelPackages } from './useChannelPackages';
import { trpc } from '../../utils/trpc';

interface AddContactModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddContactModal({ open, onClose, onSuccess }: AddContactModalProps) {
  const theme = useTheme();
  const { packages } = useChannelPackages();

  const [fullName, setFullName] = useState('');
  const [addChannel, setAddChannel] = useState(false);
  const [channelType, setChannelType] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [validationError, setValidationError] = useState('');

  const createMutation = trpc.contacts.create.useMutation();
  const addChannelMutation = trpc.contacts.addChannel.useMutation();

  // Available channel types from installed packages + web
  const channelTypes = useMemo(() => {
    const types: { type: string; displayName: string; identifierLabel: string; identifierPlaceholder?: string | undefined; identifierValidation?: string | undefined; identifierHelpText?: string | undefined }[] = [
      { type: 'web', displayName: 'Web', identifierLabel: 'Username', identifierPlaceholder: 'username' },
    ];
    for (const pkg of packages) {
      types.push({
        type: pkg.channelType,
        displayName: pkg.displayName,
        identifierLabel: pkg.identity.identifierLabel,
        identifierPlaceholder: pkg.identity.identifierPlaceholder,
        identifierValidation: pkg.identity.identifierValidation,
        identifierHelpText: pkg.identity.identifierHelpText,
      });
    }
    return types;
  }, [packages]);

  const selectedMeta = channelTypes.find((t) => t.type === channelType);

  const reset = () => {
    setFullName('');
    setAddChannel(false);
    setChannelType(null);
    setIdentifier('');
    setValidationError('');
  };

  const handleSubmit = async () => {
    if (!fullName.trim()) return;

    // Validate channel identifier if adding one
    if (addChannel && channelType && identifier.trim() && selectedMeta?.identifierValidation) {
      try {
        const regex = new RegExp(selectedMeta.identifierValidation);
        if (!regex.test(identifier.trim())) {
          setValidationError(`Invalid format for ${selectedMeta.identifierLabel.toLowerCase()}`);
          return;
        }
      } catch {
        // Invalid regex in manifest; skip validation
      }
    }

    try {
      const contact = await createMutation.mutateAsync({
        fullName: fullName.trim(),
      });

      // Optionally add channel
      if (addChannel && channelType && identifier.trim()) {
        await addChannelMutation.mutateAsync({
          contactId: contact.id,
          channel: channelType,
          identifier: identifier.trim(),
        });
      }

      reset();
      onSuccess();
      onClose();
    } catch {
      // Error handled by mutation state
    }
  };

  const isSubmitting = createMutation.isPending || addChannelMutation.isPending;

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <Typography.Subtitle as="h3">
          Add contact
        </Typography.Subtitle>

        <Input
          label="Full name"
          value={fullName}
          onChange={(e) => setFullName((e.target as HTMLInputElement).value)}
          placeholder="Name"
          error={createMutation.error?.message}
        />

        {/* Optional channel section */}
        {!addChannel ? (
          <button
            onClick={() => { setAddChannel(true); setChannelType(channelTypes[0]?.type ?? null); }}
            css={css`
              font-size: ${theme.typography.fontSize.sm};
              color: ${theme.colors.text.secondary};
              cursor: pointer;
              text-align: left;
              padding: 0;
              &:hover { color: ${theme.colors.text.primary}; }
            `}
          >
            + Add a channel
          </button>
        ) : (
          <div css={css`
            display: flex;
            flex-direction: column;
            gap: ${theme.spacing[3]};
            padding: ${theme.spacing[3]};
            border: 1px solid ${theme.colors.border.light};
            border-radius: ${theme.borderRadius.default};
          `}>
            <div css={css`display: flex; align-items: center; justify-content: space-between;`}>
              <Typography.SmallBody color="secondary">Channel</Typography.SmallBody>
              <button
                onClick={() => { setAddChannel(false); setChannelType(null); setIdentifier(''); setValidationError(''); }}
                css={css`
                  font-size: ${theme.typography.fontSize.xs};
                  color: ${theme.colors.text.hint};
                  cursor: pointer;
                  &:hover { color: ${theme.colors.text.primary}; }
                `}
              >
                Remove
              </button>
            </div>

            {/* Channel type pills */}
            <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[2]};`}>
              {channelTypes.map((t) => (
                <button
                  key={t.type}
                  onClick={() => { setChannelType(t.type); setIdentifier(''); setValidationError(''); }}
                  css={css`
                    display: inline-flex;
                    align-items: center;
                    gap: ${theme.spacing[1.5]};
                    padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
                    border-radius: ${theme.borderRadius.full};
                    font-size: ${theme.typography.fontSize.sm};
                    cursor: pointer;
                    transition: all ${theme.transitions.fast};
                    ${channelType === t.type
                      ? `
                        background: ${theme.colors.accent};
                        color: ${theme.colors.accentForeground};
                      `
                      : `
                        background: ${theme.colors.background.elevated};
                        color: ${theme.colors.text.secondary};
                        &:hover { color: ${theme.colors.text.primary}; }
                      `}
                  `}
                >
                  <ChannelIcon channelType={t.type} size={14} />
                  {t.displayName}
                </button>
              ))}
            </div>

            {/* Identifier input */}
            {selectedMeta && (
              <Input
                label={selectedMeta.identifierLabel}
                value={identifier}
                onChange={(e) => { setIdentifier((e.target as HTMLInputElement).value); setValidationError(''); }}
                placeholder={selectedMeta.identifierPlaceholder}
                error={validationError || addChannelMutation.error?.message}
                helperText={selectedMeta.identifierHelpText}
              />
            )}
          </div>
        )}

        <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
          <Button variant="ghost" size="sm" onClick={() => { reset(); onClose(); }}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!fullName.trim()}
            loading={isSubmitting}
            onClick={handleSubmit}
          >
            Add
          </Button>
        </div>
      </div>
    </Modal>
  );
}
