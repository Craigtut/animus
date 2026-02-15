/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo } from 'react';
import { Button, Input, Typography } from '../../components/ui';
import { ChannelIcon, useChannelPackages } from './useChannelPackages';
import { trpc } from '../../utils/trpc';

interface AddChannelFormProps {
  contactId: string;
  existingChannels: string[];
  onAdded: () => void;
  onCancel: () => void;
}

export function AddChannelForm({
  contactId,
  existingChannels,
  onAdded,
  onCancel,
}: AddChannelFormProps) {
  const theme = useTheme();
  const { packages } = useChannelPackages();

  // Available channel types: web + installed packages, minus already-connected
  const availableTypes = useMemo(() => {
    const types: { type: string; displayName: string; identifierLabel: string; identifierPlaceholder?: string | undefined; identifierValidation?: string | undefined; identifierHelpText?: string | undefined }[] = [];

    // Web is always available
    if (!existingChannels.includes('web')) {
      types.push({
        type: 'web',
        displayName: 'Web',
        identifierLabel: 'Username',
        identifierPlaceholder: 'username',
      });
    }

    // Add installed package types
    for (const pkg of packages) {
      if (!existingChannels.includes(pkg.channelType)) {
        types.push({
          type: pkg.channelType,
          displayName: pkg.displayName,
          identifierLabel: pkg.identity.identifierLabel,
          identifierPlaceholder: pkg.identity.identifierPlaceholder,
          identifierValidation: pkg.identity.identifierValidation,
          identifierHelpText: pkg.identity.identifierHelpText,
        });
      }
    }

    return types;
  }, [packages, existingChannels]);

  const [selectedType, setSelectedType] = useState<string | null>(
    availableTypes.length > 0 ? availableTypes[0]!.type : null,
  );
  const [identifier, setIdentifier] = useState('');
  const [validationError, setValidationError] = useState('');

  const selectedMeta = availableTypes.find((t) => t.type === selectedType);

  const addMutation = trpc.contacts.addChannel.useMutation({
    onSuccess: () => {
      setIdentifier('');
      setSelectedType(null);
      onAdded();
    },
  });

  const handleSubmit = () => {
    if (!selectedType || !identifier.trim()) return;

    // Validate against regex if provided
    if (selectedMeta?.identifierValidation) {
      try {
        const regex = new RegExp(selectedMeta.identifierValidation);
        if (!regex.test(identifier.trim())) {
          setValidationError(`Invalid format for ${selectedMeta.identifierLabel.toLowerCase()}`);
          return;
        }
      } catch {
        // Invalid regex in manifest — skip validation
      }
    }

    setValidationError('');
    addMutation.mutate({
      contactId,
      channel: selectedType,
      identifier: identifier.trim(),
    });
  };

  if (availableTypes.length === 0) {
    return (
      <div css={css`padding: ${theme.spacing[3]} 0;`}>
        <Typography.SmallBody color="hint">
          All available channel types are already connected.
        </Typography.SmallBody>
        <button
          onClick={onCancel}
          css={css`
            font-size: ${theme.typography.fontSize.sm};
            color: ${theme.colors.text.secondary};
            cursor: pointer;
            margin-top: ${theme.spacing[2]};
            &:hover { color: ${theme.colors.text.primary}; }
          `}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div css={css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing[3]};
      padding: ${theme.spacing[3]};
      border: 1px solid ${theme.colors.border.light};
      border-radius: ${theme.borderRadius.default};
    `}>
      {/* Channel type pills */}
      <div>
        <Typography.SmallBody color="secondary" css={css`margin-bottom: ${theme.spacing[2]};`}>
          Channel type
        </Typography.SmallBody>
        <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[2]};`}>
          {availableTypes.map((t) => (
            <button
              key={t.type}
              onClick={() => { setSelectedType(t.type); setIdentifier(''); setValidationError(''); }}
              css={css`
                display: inline-flex;
                align-items: center;
                gap: ${theme.spacing[1.5]};
                padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
                border-radius: ${theme.borderRadius.full};
                font-size: ${theme.typography.fontSize.sm};
                cursor: pointer;
                transition: all ${theme.transitions.fast};
                ${selectedType === t.type
                  ? `
                    background: ${theme.colors.accent};
                    color: ${theme.colors.accentForeground};
                  `
                  : `
                    background: ${theme.colors.background.elevated};
                    color: ${theme.colors.text.secondary};
                    &:hover {
                      color: ${theme.colors.text.primary};
                    }
                  `}
              `}
            >
              <ChannelIcon channelType={t.type} size={14} />
              {t.displayName}
            </button>
          ))}
        </div>
      </div>

      {/* Identifier input */}
      {selectedMeta && (
        <Input
          label={selectedMeta.identifierLabel}
          value={identifier}
          onChange={(e) => { setIdentifier((e.target as HTMLInputElement).value); setValidationError(''); }}
          placeholder={selectedMeta.identifierPlaceholder}
          error={validationError || (addMutation.error?.message)}
          helperText={selectedMeta.identifierHelpText}
        />
      )}

      {/* Actions */}
      <div css={css`display: flex; gap: ${theme.spacing[2]}; justify-content: flex-end;`}>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!selectedType || !identifier.trim()}
          loading={addMutation.isPending}
          onClick={handleSubmit}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
