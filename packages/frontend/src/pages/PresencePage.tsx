/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useNavigate } from 'react-router-dom';
import { useRef, useState, useCallback } from 'react';
import { FluidBackground } from '../components/effects/FluidBackground';
import { trpc } from '../utils/trpc';
import { useHeartbeatStore } from '../store/heartbeat-store';
import { Conversation } from '../components/presence/Conversation';
import { MessageInput } from '../components/presence/MessageInput';
import { ThoughtStream, DotsDivider, SleepIndicator } from '../components/presence/ThoughtStream';
import type { MessageData } from '../components/presence/Conversation';
import type { MessageInputHandle } from '../components/presence/MessageInput';

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
  const messageInputRef = useRef<MessageInputHandle>(null);
  const [isDragOver, setIsDragOver] = useState(false);

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
  const messages: MessageData[] = (messagesData ?? []).map((m) => {
    const mapped: MessageData = {
      id: m.id,
      content: m.content,
      role: mapDirectionToRole(m.direction),
      createdAt: m.createdAt,
    };
    if (m.attachments && m.attachments.length > 0) {
      mapped.attachments = m.attachments.map((a) => ({
        id: a.id,
        type: a.type,
        mimeType: a.mimeType,
        originalFilename: a.originalFilename,
        sizeBytes: a.sizeBytes,
      }));
    }
    return mapped;
  });

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
  const handleSend = (content: string, attachmentIds?: string[]) => {
    sendMutation.mutate({
      content,
      channel: 'web',
      ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
    });
  };

  const handleReplyStreamClear = () => {
    useHeartbeatStore.getState().clearReplyStream();
  };

  const handleThoughtClick = () => {
    navigate('/mind/journal');
  };

  // ── Page-level drag & drop ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the page entirely (not entering a child)
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      messageInputRef.current?.addFiles(files);
    }
  }, []);

  // ── Render ──
  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      css={css`min-height: 100vh;`}
    >
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

      {/* Drag overlay */}
      {isDragOver && (
        <div
          css={css`
            position: fixed;
            inset: 0;
            z-index: ${theme.zIndex.modal};
            background: ${theme.mode === 'light'
              ? 'rgba(250, 249, 244, 0.7)'
              : 'rgba(28, 26, 24, 0.7)'};
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
          `}
        >
          <div
            css={css`
              padding: 24px 48px;
              border-radius: 16px;
              border: 2px dashed ${theme.colors.accent};
              color: ${theme.colors.text.secondary};
              font-size: ${theme.typography.fontSize.lg};
            `}
          >
            Drop files to attach
          </div>
        </div>
      )}

      {/* Floating Message Input */}
      <MessageInput
        ref={messageInputRef}
        onSend={handleSend}
        disabled={sendMutation.isPending}
        isDragOver={isDragOver}
      />
    </div>
  );
}
