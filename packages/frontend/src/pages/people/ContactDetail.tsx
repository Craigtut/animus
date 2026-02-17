/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { Button, Modal, Typography } from '../../components/ui';
import { trpc } from '../../utils/trpc';
import { ContactHeader } from './ContactHeader';
import { ConversationHistory } from './ConversationHistory';
import { ConnectedChannels } from './ConnectedChannels';
import { ContactNotes } from './ContactNotes';

interface ContactDetailProps {
  contactId: string;
  onBack: () => void;
}

export function ContactDetail({ contactId, onBack }: ContactDetailProps) {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: contact } = trpc.contacts.getById.useQuery({ id: contactId });
  const { data: channels } = trpc.contacts.getChannels.useQuery({ contactId });

  const deleteMutation = trpc.contacts.delete.useMutation({
    onSuccess: () => {
      utils.contacts.list.invalidate();
      onBack();
    },
  });

  const [activeTab, setActiveTab] = useState<'conversations' | 'details'>('conversations');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleChannelsChanged = () => {
    utils.contacts.getChannels.invalidate({ contactId });
    utils.contacts.list.invalidate();
  };

  if (!contact) {
    return (
      <Typography.Body
        color="hint"
        css={css`padding: ${theme.spacing[8]}; text-align: center;`}
      >
        Loading...
      </Typography.Body>
    );
  }

  const channelList = (channels ?? []).map((ch) => ({
    id: ch.id,
    channel: ch.channel,
    identifier: ch.identifier,
    isVerified: ch.isVerified,
    displayName: ch.displayName,
  }));

  return (
    <div css={css`
      max-width: 720px;
      margin: 0 auto;
      padding: ${theme.spacing[4]} ${theme.spacing[6]};
      @media (max-width: ${theme.breakpoints.md}) {
        padding: ${theme.spacing[4]};
      }
    `}>
      {/* Back button */}
      <button
        onClick={onBack}
        css={css`
          display: flex; align-items: center; gap: ${theme.spacing[2]};
          color: ${theme.colors.text.secondary}; font-size: ${theme.typography.fontSize.sm};
          cursor: pointer; padding: 0; margin-bottom: ${theme.spacing[4]};
          &:hover { color: ${theme.colors.text.primary}; }
        `}
      >
        <ArrowLeft size={16} />
        People
      </button>

      {/* Header -- always visible */}
      <div css={css`margin-bottom: ${theme.spacing[5]};`}>
        <ContactHeader
          contactId={contactId}
          fullName={contact.fullName}
          isPrimary={contact.isPrimary}
        />
      </div>

      {/* Tabs */}
      <div css={css`
        display: flex; gap: ${theme.spacing[6]};
        border-bottom: 1px solid ${theme.colors.border.light};
        margin-bottom: ${theme.spacing[4]};
      `}>
        {(['conversations', 'details'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            css={css`
              padding: ${theme.spacing[2]} 0;
              font-size: ${theme.typography.fontSize.sm};
              font-weight: ${activeTab === tab ? theme.typography.fontWeight.semibold : theme.typography.fontWeight.normal};
              color: ${activeTab === tab ? theme.colors.text.primary : theme.colors.text.secondary};
              border-bottom: 2px solid ${activeTab === tab ? theme.colors.accent : 'transparent'};
              cursor: pointer;
              transition: all ${theme.transitions.micro};
              &:hover { color: ${theme.colors.text.primary}; }
            `}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'conversations' && (
        <ConversationHistory contactId={contactId} />
      )}

      {activeTab === 'details' && (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[8]};`}>
          {/* Connected Channels */}
          <ConnectedChannels
            contactId={contactId}
            isPrimary={contact.isPrimary}
            channels={channelList}
            onChannelsChanged={handleChannelsChanged}
          />

          {/* Divider */}
          <div css={css`border-top: 1px solid ${theme.colors.border.light};`} />

          {/* Notes */}
          <ContactNotes
            contactId={contactId}
            fullName={contact.fullName}
            isPrimary={contact.isPrimary}
            notes={contact.notes ?? null}
          />

          {/* Delete contact (non-primary only) */}
          {!contact.isPrimary && (
            <>
              <div css={css`border-top: 1px solid ${theme.colors.border.light};`} />
              <div>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  css={css`
                    font-size: ${theme.typography.fontSize.sm};
                    color: ${theme.colors.error.main};
                    cursor: pointer;
                    padding: 0;
                    text-decoration: underline;
                    text-underline-offset: 3px;
                    &:hover { opacity: 0.8; }
                  `}
                >
                  Delete contact
                </button>
              </div>
            </>
          )}

          <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
              <Typography.Subtitle as="h3">
                Delete {contact.fullName}?
              </Typography.Subtitle>
              <Typography.SmallBody color="secondary">
                This will remove the contact and all their channel associations. Message history will be preserved.
              </Typography.SmallBody>
              <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
                <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => deleteMutation.mutate({ id: contactId })}
                  loading={deleteMutation.isPending}
                >
                  Delete
                </Button>
              </div>
            </div>
          </Modal>
        </div>
      )}
    </div>
  );
}
