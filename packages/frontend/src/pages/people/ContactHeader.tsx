/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useEffect } from 'react';
import { PencilSimple } from '@phosphor-icons/react';
import { Button, Input, Typography } from '../../components/ui';
import { trpc } from '../../utils/trpc';
import { getInitials, nameToHue } from './helpers';

interface ContactHeaderProps {
  contactId: string;
  fullName: string;
  isPrimary: boolean;
}

export function ContactHeader({ contactId, fullName, isPrimary }: ContactHeaderProps) {
  const theme = useTheme();
  const utils = trpc.useUtils();
  const hue = nameToHue(fullName);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(fullName);

  useEffect(() => {
    setEditName(fullName);
  }, [fullName]);

  const updateMutation = trpc.contacts.update.useMutation({
    onSuccess: () => {
      utils.contacts.getById.invalidate({ id: contactId });
      utils.contacts.list.invalidate();
      setEditing(false);
    },
  });

  const handleSave = () => {
    if (!editName.trim()) return;
    updateMutation.mutate({ id: contactId, fullName: editName.trim() });
  };

  if (editing) {
    return (
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <Input
          value={editName}
          onChange={(e) => setEditName((e.target as HTMLInputElement).value)}
          label="Name"
        />
        <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
          <Button size="sm" onClick={handleSave} loading={updateMutation.isPending}>
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setEditName(fullName); }}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div css={css`display: flex; align-items: center; gap: ${theme.spacing[4]};`}>
      {/* 56px avatar */}
      <div
        css={css`
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: hsl(${hue}, 30%, ${theme.mode === 'light' ? '85%' : '30%'});
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        `}
      >
        <Typography.BodyAlt
          as="span"
          color={`hsl(${hue}, 40%, ${theme.mode === 'light' ? '40%' : '75%'})`}
        >
          {getInitials(fullName)}
        </Typography.BodyAlt>
      </div>

      {/* Name + tier */}
      <div css={css`flex: 1; min-width: 0;`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <Typography.Title3 as="h1">
            {fullName}
          </Typography.Title3>
          <button
            onClick={() => setEditing(true)}
            css={css`
              color: ${theme.colors.text.hint};
              cursor: pointer;
              padding: 0;
              &:hover { color: ${theme.colors.text.primary}; }
            `}
          >
            <PencilSimple size={16} />
          </button>
        </div>
        <Typography.SmallBody color="secondary">
          {isPrimary ? 'Primary contact' : 'Standard contact'}
        </Typography.SmallBody>
      </div>
    </div>
  );
}
