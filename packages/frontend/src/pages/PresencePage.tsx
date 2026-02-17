/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useNavigate } from 'react-router-dom';
import { FluidBackground } from '../components/effects/FluidBackground';
import { trpc } from '../utils/trpc';
import { useHeartbeatStore } from '../store/heartbeat-store';
import { Conversation } from '../components/presence/Conversation';
import { MessageInput } from '../components/presence/MessageInput';
import { ThoughtStream, DotsDivider, SleepIndicator } from '../components/presence/ThoughtStream';
import type { MessageData } from '../components/presence/Conversation';

// ============================================================================
// Direction-to-role mapping
// ============================================================================

function mapDirectionToRole(direction: string): 'user' | 'assistant' {
  return direction === 'inbound' ? 'user' : 'assistant';
}

// ============================================================================
// Presence Page
// ============================================================================

export function PresencePage() {
  const theme = useTheme();
  const navigate = useNavigate();

  // ── Data fetching ──
  const { data: messagesData } = trpc.messages.getRecent.useQuery(
    { limit: 50 },
    { retry: false },
  );
  const { data: thoughts } = trpc.heartbeat.getRecentThoughts.useQuery(undefined, {
    retry: false,
  });
  const { data: energyState } = trpc.heartbeat.getEnergyState.useQuery(undefined, {
    retry: false,
  });
  const { data: persona } = trpc.persona.get.useQuery(undefined, { retry: false });

  const sendMutation = trpc.messages.send.useMutation();

  // ── Store state ──
  const replyStream = useHeartbeatStore((s) => s.replyStream);
  const heartbeatState = useHeartbeatStore((s) => s.heartbeatState);
  const storeThoughts = useHeartbeatStore((s) => s.recentThoughts);
  const energyBand = useHeartbeatStore((s) => s.energyBand);

  // ── Derived state ──
  const isThinking = heartbeatState?.currentStage === 'mind' && !replyStream.isStreaming;

  // Map messages from tRPC shape to component shape
  const messages: MessageData[] = (messagesData ?? []).map((m) => ({
    id: m.id,
    content: m.content,
    role: mapDirectionToRole(m.direction),
    createdAt: m.createdAt,
  }));

  // Sort chronologically (newest at bottom)
  const sortedMessages = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  // Merge store thoughts with query thoughts (store takes priority when available)
  const allThoughts = storeThoughts.length > 0 ? storeThoughts : (thoughts ?? []);
  const displayThoughts = allThoughts.slice(0, 3);

  // Sleep state
  const isSleeping = energyBand === 'sleeping' || (!energyBand && energyState?.energyBand === 'sleeping');
  const name = persona?.name;

  // ── Handlers ──
  const handleSend = (content: string) => {
    sendMutation.mutate({ content, channel: 'web' });
  };

  const handleReplyStreamClear = () => {
    useHeartbeatStore.getState().clearReplyStream();
  };

  const handleThoughtClick = () => {
    navigate('/mind/journal');
  };

  // ── Render ──
  return (
    <div css={css`min-height: 100vh;`}>
      {/* The Being (fixed top half) */}
      <div
        css={css`
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 30vh;
          z-index: 2;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          overflow: hidden;
        `}
      >
        {/* WebGL gradient background */}
        <div
          css={css`
            position: absolute;
            inset: 0;
            mask-image: linear-gradient(to bottom, black 65%, transparent 100%);
            -webkit-mask-image: linear-gradient(to bottom, black 65%, transparent 100%);
          `}
        >
          <FluidBackground mode={theme.mode} />
        </div>

        {/* Thought stream + divider (at bottom of the being section) */}
        <div
          css={css`
            position: relative;
            z-index: 1;
            padding-bottom: ${theme.spacing[1]};
          `}
        >
          <SleepIndicator isSleeping={!!isSleeping} name={name} />
          <ThoughtStream thoughts={displayThoughts} onThoughtClick={handleThoughtClick} />
          <DotsDivider />
        </div>
      </div>

      {/* The Conversation (fixed scroll container) */}
      <div
        css={css`
          position: fixed;
          top: 30vh;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 1;
          background: ${theme.colors.background.default};
        `}
      >
        <Conversation
          messages={sortedMessages}
          replyStream={replyStream}
          isThinking={isThinking}
          onReplyStreamClear={handleReplyStreamClear}
        />
      </div>

      {/* Floating Message Input */}
      <MessageInput onSend={handleSend} disabled={sendMutation.isPending} />
    </div>
  );
}
