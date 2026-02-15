/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo, useRef, useEffect } from 'react';
import { Typography } from '../../components/ui';
import { ChannelIcon, useChannelPackages } from './useChannelPackages';
import { formatRelativeTime } from './helpers';
import { trpc } from '../../utils/trpc';

interface ConversationHistoryProps {
  contactId: string;
}

export function ConversationHistory({ contactId }: ConversationHistoryProps) {
  const theme = useTheme();
  const { packages } = useChannelPackages();
  const [channelFilter, setChannelFilter] = useState<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch messages
  const { data: messages, isLoading } = trpc.messages.getByContact.useQuery({
    contactId,
    limit: 100,
    channel: channelFilter,
  });

  // Determine unique channels from messages for filter pills
  const messageChannels = useMemo(() => {
    if (!messages) return [];
    const channels = new Set<string>();
    for (const msg of messages) {
      if (msg.channel) channels.add(msg.channel);
    }
    return Array.from(channels).sort();
  }, [messages]);

  // Build channel display names
  const channelDisplayNames = useMemo(() => {
    const names: Record<string, string> = { web: 'Web' };
    for (const pkg of packages) {
      names[pkg.channelType] = pkg.displayName;
    }
    return names;
  }, [packages]);

  // Scroll to bottom on initial load
  useEffect(() => {
    if (messages && messages.length > 0) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
      });
    }
  }, [contactId]); // Only on contact change, not every re-render

  if (isLoading) {
    return (
      <Typography.Body
        color="hint"
        css={css`text-align: center; padding: ${theme.spacing[8]};`}
      >
        Loading messages...
      </Typography.Body>
    );
  }

  if (!messages || messages.length === 0) {
    return (
      <Typography.Body
        color="hint"
        css={css`text-align: center; padding: ${theme.spacing[16]} 0;`}
      >
        No messages yet.
      </Typography.Body>
    );
  }

  return (
    <div>
      {/* Channel filter pills */}
      {messageChannels.length > 1 && (
        <div css={css`
          display: flex;
          gap: ${theme.spacing[2]};
          margin-bottom: ${theme.spacing[4]};
          flex-wrap: wrap;
        `}>
          <FilterPill
            label="All"
            active={channelFilter === undefined}
            onClick={() => setChannelFilter(undefined)}
          />
          {messageChannels.map((ch) => (
            <FilterPill
              key={ch}
              label={channelDisplayNames[ch] ?? ch}
              channelType={ch}
              active={channelFilter === ch}
              onClick={() => setChannelFilter(ch)}
            />
          ))}
        </div>
      )}

      {/* Message list */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        {/* Messages are returned newest-first, reverse for chronological display */}
        {[...messages].reverse().map((msg) => {
          const isInbound = msg.direction === 'inbound';
          return (
            <div
              key={msg.id}
              css={css`
                display: flex;
                justify-content: ${isInbound ? 'flex-end' : 'flex-start'};
              `}
            >
              <Typography.Body
                as="div"
                color="primary"
                css={css`
                  max-width: ${isInbound ? '80%' : '85%'};
                  ${isInbound
                    ? `
                    background: ${theme.mode === 'light' ? 'hsl(30, 20%, 92%)' : 'hsl(30, 15%, 22%)'};
                    border-radius: 16px;
                    padding: ${theme.spacing[3]} ${theme.spacing[4]};
                  `
                    : ''}
                  white-space: pre-wrap;
                `}
              >
                {msg.content}
                <Typography.Caption
                  as="div"
                  color="hint"
                  css={css`
                    margin-top: ${theme.spacing[0.5]};
                    display: flex;
                    align-items: center;
                    gap: ${theme.spacing[1]};
                  `}
                >
                  <span css={css`display: inline-flex;`}>
                    <ChannelIcon channelType={msg.channel} size={10} />
                  </span>
                  {formatRelativeTime(msg.createdAt)}
                </Typography.Caption>
              </Typography.Body>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/** Small filter pill button */
function FilterPill({
  label,
  channelType,
  active,
  onClick,
}: {
  label: string;
  channelType?: string;
  active: boolean;
  onClick: () => void;
}) {
  const theme = useTheme();
  return (
    <button
      onClick={onClick}
      css={css`
        display: inline-flex;
        align-items: center;
        gap: ${theme.spacing[1.5]};
        padding: ${theme.spacing[1]} ${theme.spacing[3]};
        border-radius: ${theme.borderRadius.full};
        font-size: ${theme.typography.fontSize.sm};
        cursor: pointer;
        transition: all ${theme.transitions.fast};
        ${active
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
      {channelType && <ChannelIcon channelType={channelType} size={12} />}
      {label}
    </button>
  );
}
