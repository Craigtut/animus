/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { Typography } from '../../components/ui';
import { ChannelIcon } from './useChannelPackages';
import { getInitials, nameToHue, formatRelativeTime } from './helpers';

export interface ContactListData {
  id: string;
  fullName: string;
  isPrimary: boolean;
  permissionTier: string;
  channels: { id: string; channel: string; identifier: string; isVerified: boolean }[];
  lastMessage: {
    content: string;
    direction: string;
    createdAt: string;
    channel: string;
  } | null;
}

export function ContactListItem({
  contact,
  onClick,
}: {
  contact: ContactListData;
  onClick: () => void;
}) {
  const theme = useTheme();
  const hue = nameToHue(contact.fullName);

  return (
    <div
      onClick={onClick}
      css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[4]};
        padding: ${theme.spacing[3]} ${theme.spacing[4]};
        border-radius: ${theme.borderRadius.md};
        cursor: pointer;
        transition: background ${theme.transitions.fast};
        &:hover {
          background: ${theme.colors.background.elevated};
        }
      `}
    >
      {/* Avatar */}
      <div
        css={css`
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: hsl(${hue}, 30%, ${theme.mode === 'light' ? '85%' : '30%'});
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        `}
      >
        <Typography.SmallBodyAlt
          as="span"
          color={`hsl(${hue}, 40%, ${theme.mode === 'light' ? '40%' : '75%'})`}
        >
          {getInitials(contact.fullName)}
        </Typography.SmallBodyAlt>
      </div>

      {/* Name + Last message */}
      <div css={css`flex: 1; min-width: 0;`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <Typography.BodyAlt as="span">
            {contact.fullName}
          </Typography.BodyAlt>
          <Typography.Caption color={contact.isPrimary ? theme.colors.accent : 'secondary'}>
            {contact.isPrimary ? 'Primary' : 'Standard'}
          </Typography.Caption>
        </div>
        {contact.lastMessage && (
          <Typography.SmallBody
            color="hint"
            css={css`
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              margin-top: 2px;
            `}
          >
            {contact.lastMessage.direction === 'outbound' ? 'You: ' : ''}
            {contact.lastMessage.content}
          </Typography.SmallBody>
        )}
      </div>

      {/* Right: channels + time */}
      <div css={css`display: flex; flex-direction: column; align-items: flex-end; gap: ${theme.spacing[1]}; flex-shrink: 0;`}>
        <div css={css`display: flex; gap: ${theme.spacing[1]};`}>
          {contact.channels.map((ch) => (
            <span
              key={ch.id}
              css={css`
                color: ${theme.colors.text.secondary};
                opacity: ${ch.isVerified ? 0.55 : 0.3};
                display: inline-flex;
              `}
            >
              <ChannelIcon channelType={ch.channel} size={14} />
            </span>
          ))}
        </div>
        {contact.lastMessage && (
          <Typography.Caption color="hint">
            {formatRelativeTime(contact.lastMessage.createdAt)}
          </Typography.Caption>
        )}
      </div>
    </div>
  );
}
