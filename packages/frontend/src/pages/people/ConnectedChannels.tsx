/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { Trash } from '@phosphor-icons/react';
import { Badge, Button, Modal, Typography } from '../../components/ui';
import { ChannelIcon } from './useChannelPackages';
import { trpc } from '../../utils/trpc';
import { AddChannelForm } from './AddChannelForm';

interface ChannelData {
  id: string;
  channel: string;
  identifier: string;
  isVerified: boolean;
  displayName?: string | null;
}

interface ConnectedChannelsProps {
  contactId: string;
  isPrimary: boolean;
  channels: ChannelData[];
  onChannelsChanged: () => void;
}

export function ConnectedChannels({
  contactId,
  isPrimary,
  channels,
  onChannelsChanged,
}: ConnectedChannelsProps) {
  const theme = useTheme();
  const [showAddForm, setShowAddForm] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ChannelData | null>(null);

  const removeMutation = trpc.contacts.removeChannel.useMutation({
    onSuccess: () => {
      setRemoveTarget(null);
      onChannelsChanged();
    },
  });

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
      <Typography.BodyAlt as="h3">Connected channels</Typography.BodyAlt>

      {/* Channel list */}
      {channels.map((ch) => {
        // Web channel on primary contact cannot be removed
        const canRemove = !(isPrimary && ch.channel === 'web');

        return (
          <div
            key={ch.id}
            css={css`
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: ${theme.spacing[2]} ${theme.spacing[3]};
              border: 1px solid ${theme.colors.border.light};
              border-radius: ${theme.borderRadius.default};
            `}
          >
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; min-width: 0;`}>
              <span css={css`color: ${theme.colors.text.secondary}; display: inline-flex; flex-shrink: 0;`}>
                <ChannelIcon channelType={ch.channel} size={16} />
              </span>
              <Typography.SmallBody as="span" css={css`
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              `}>
                {ch.identifier}
              </Typography.SmallBody>
              {ch.isVerified && <Badge variant="success">Verified</Badge>}
            </div>
            {canRemove && (
              <button
                onClick={() => setRemoveTarget(ch)}
                css={css`
                  color: ${theme.colors.text.hint};
                  cursor: pointer;
                  padding: ${theme.spacing[1]};
                  flex-shrink: 0;
                  &:hover { color: ${theme.colors.error.main}; }
                `}
              >
                <Trash size={14} />
              </button>
            )}
          </div>
        );
      })}

      {/* Add channel toggle */}
      {showAddForm ? (
        <AddChannelForm
          contactId={contactId}
          existingChannels={channels.map((ch) => ch.channel)}
          onAdded={() => {
            setShowAddForm(false);
            onChannelsChanged();
          }}
          onCancel={() => setShowAddForm(false)}
        />
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          css={css`
            font-size: ${theme.typography.fontSize.sm};
            color: ${theme.colors.text.secondary};
            cursor: pointer;
            padding: ${theme.spacing[2]} 0;
            text-align: left;
            &:hover { color: ${theme.colors.text.primary}; }
          `}
        >
          + Add channel
        </button>
      )}

      {/* Remove confirmation modal */}
      <Modal open={!!removeTarget} onClose={() => setRemoveTarget(null)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <Typography.Subtitle as="h3">
            Remove channel?
          </Typography.Subtitle>
          <Typography.SmallBody color="secondary">
            Remove <strong>{removeTarget?.identifier}</strong> ({removeTarget?.channel}) from this contact?
            Message history will be preserved.
          </Typography.SmallBody>
          <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
            <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={removeMutation.isPending}
              onClick={() => removeTarget && removeMutation.mutate({ id: removeTarget.id })}
            >
              Remove
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
