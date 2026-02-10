/** @jsxImportSource @emotion/react */
import { css, useTheme, keyframes } from '@emotion/react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { PaperPlaneRight } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'motion/react';
import { emotionColors } from '../styles/theme';
import { trpc } from '../utils/trpc';
import type { EmotionState } from '@animus/shared';

// ============================================================================
// Emotional Field
// ============================================================================

function EmotionalField() {
  const theme = useTheme();
  const mode = theme.mode;
  const colors = emotionColors[mode];

  // Load initial emotion data, then update via subscription
  const { data: emotions } = trpc.heartbeat.getEmotions.useQuery(undefined, {
    retry: false,
  });

  const [liveEmotions, setLiveEmotions] = useState<EmotionState[]>([]);

  // Subscribe to real-time emotion updates
  trpc.heartbeat.onEmotionChange.useSubscription(undefined, {
    onData: (emotion: EmotionState) => {
      setLiveEmotions((prev) => {
        const idx = prev.findIndex((e) => e.emotion === emotion.emotion);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = emotion;
          return next;
        }
        return [...prev, emotion];
      });
    },
  });

  const currentEmotions = liveEmotions.length > 0 ? liveEmotions : emotions;

  // Determine dominant emotions for orb colors
  const getOrbColors = () => {
    if (!currentEmotions || currentEmotions.length === 0) {
      // Default calm state
      return [colors.contentment, colors.joy, colors.curiosity];
    }
    // Sort by intensity and pick top 3
    const sorted = [...currentEmotions].sort((a, b) => b.intensity - a.intensity);
    return sorted.slice(0, 3).map((e) => {
      const name = e.emotion as keyof typeof colors;
      return colors[name] || colors.contentment;
    });
  };

  const orbColors = getOrbColors();

  return (
    <div
      aria-hidden="true"
      css={css`
        position: relative;
        width: 100%;
        height: clamp(200px, 28vh, 360px);
        overflow: hidden;
        mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
        -webkit-mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
      `}
    >
      {orbColors.map((color, i) => (
        <div
          key={i}
          css={css`
            position: absolute;
            border-radius: 50%;
            filter: blur(${90 + i * 15}px);
            will-change: transform, opacity;
            background: ${color};
            opacity: 0.35;
            animation: orb-drift-${i} ${4200 + i * 1600}ms ease-in-out infinite alternate;

            ${i === 0
              ? `width: 55%; height: 80%; top: 10%; left: 20%;`
              : i === 1
                ? `width: 45%; height: 70%; top: 20%; left: 40%;`
                : `width: 50%; height: 60%; top: 5%; left: 10%;`}

            @keyframes orb-drift-${i} {
              0% { transform: translate(0, 0) scale(1); }
              100% { transform: translate(${15 - i * 10}px, ${8 - i * 5}px) scale(${1.03 + i * 0.01}); }
            }

            @media (prefers-reduced-motion: reduce) {
              animation: none;
            }
          `}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Thought Stream
// ============================================================================

interface ThoughtData {
  id: string;
  content: string;
  importance: number;
  createdAt: string;
}

function ThoughtStream() {
  const theme = useTheme();

  const { data: thoughts } = trpc.heartbeat.getRecentThoughts.useQuery(undefined, {
    retry: false,
  });

  const [liveThoughts, setLiveThoughts] = useState<ThoughtData[]>([]);

  // Subscribe to real-time thought updates
  trpc.heartbeat.onThoughts.useSubscription(undefined, {
    onData: (thought) => {
      setLiveThoughts((prev) => [thought as ThoughtData, ...prev].slice(0, 4));
    },
  });

  const allThoughts = liveThoughts.length > 0 ? liveThoughts : (thoughts ?? []);
  const displayThoughts: ThoughtData[] = allThoughts.slice(0, 4);
  const opacities = [1, 0.6, 0.3, 0.12];

  if (displayThoughts.length === 0) return null;

  return (
    <div
      role="log"
      aria-live="polite"
      css={css`
        display: flex;
        flex-direction: column;
        gap: ${theme.spacing[4]};
        padding: ${theme.spacing[6]} 0;
      `}
    >
      <AnimatePresence>
        {displayThoughts.map((thought, i) => (
          <motion.p
            key={thought.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: opacities[i] ?? 0.12, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            css={css`
              font-size: ${theme.typography.fontSize.base};
              line-height: ${theme.typography.lineHeight.relaxed};
              font-weight: ${thought.importance > 0.7
                ? theme.typography.fontWeight.semibold
                : theme.typography.fontWeight.normal};
              color: ${theme.colors.text.primary};
            `}
          >
            {thought.content}
          </motion.p>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Conversation
// ============================================================================

interface MessageData {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  createdAt: string;
}

function mapDirectionToRole(direction: string): 'user' | 'assistant' {
  return direction === 'inbound' ? 'user' : 'assistant';
}

function Conversation() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: messagesData } = trpc.messages.getRecent.useQuery(
    { limit: 50 },
    { retry: false }
  );

  // Subscribe to new messages in real-time
  trpc.messages.onMessage.useSubscription(undefined, {
    onData: () => {
      // Invalidate the query to get the latest messages
      utils.messages.getRecent.invalidate();
    },
  });

  const messages: MessageData[] = (messagesData ?? []).map((m: any) => ({
    id: m.id,
    content: m.content,
    role: m.direction ? mapDirectionToRole(m.direction) : (m.role ?? 'assistant'),
    createdAt: m.createdAt,
  }));

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Defer scroll to next frame to ensure DOM is updated
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div css={css`
        text-align: center;
        padding: ${theme.spacing[16]} 0;
        color: ${theme.colors.text.hint};
        font-size: ${theme.typography.fontSize.base};
      `}>
        Say something.
      </div>
    );
  }

  return (
    <div
      role="log"
      aria-live="polite"
      css={css`
        display: flex;
        flex-direction: column;
        gap: ${theme.spacing[3]};
        padding: ${theme.spacing[4]} 0;
        padding-bottom: ${theme.spacing[20]};
      `}
    >
      {messages.map((msg) => (
        <div
          key={msg.id}
          css={css`
            display: flex;
            justify-content: ${msg.role === 'user' ? 'flex-end' : 'flex-start'};
          `}
        >
          <div
            css={css`
              max-width: ${msg.role === 'user' ? '80%' : '85%'};
              ${msg.role === 'user'
                ? `
                  background: ${theme.mode === 'light' ? 'hsl(30, 20%, 92%)' : 'hsl(30, 15%, 22%)'};
                  border-radius: 16px;
                  padding: ${theme.spacing[3]} ${theme.spacing[4]};
                `
                : ''}
              font-size: ${theme.typography.fontSize.base};
              line-height: ${theme.typography.lineHeight.normal};
              color: ${theme.colors.text.primary};
              white-space: pre-wrap;
            `}
          >
            {msg.content}
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}

// ============================================================================
// Message Input
// ============================================================================

function MessageInput() {
  const theme = useTheme();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sendMutation = trpc.messages.send.useMutation({
    onSuccess: () => setValue(''),
  });

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate({ content: trimmed, channel: 'web' });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Focus on "/" key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement === document.body) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const hasContent = value.trim().length > 0;

  return (
    <div
      css={css`
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: ${theme.zIndex.sticky};
        padding: ${theme.spacing[3]} ${theme.spacing[4]};
        padding-bottom: max(${theme.spacing[3]}, env(safe-area-inset-bottom));
        background: ${theme.colors.background.default};
        border-top: 1px solid ${theme.colors.border.light};

        @media (max-width: ${theme.breakpoints.md}) {
          bottom: 56px;
        }
      `}
    >
      <div
        css={css`
          max-width: 720px;
          margin: 0 auto;
          display: flex;
          align-items: flex-end;
          gap: ${theme.spacing[2]};
        `}
      >
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message..."
          aria-label="Message input"
          rows={1}
          css={css`
            flex: 1;
            padding: ${theme.spacing[3]} ${theme.spacing[4]};
            background: ${theme.colors.background.paper};
            border: 1px solid ${theme.colors.border.default};
            border-radius: 20px;
            color: ${theme.colors.text.primary};
            font-size: ${theme.typography.fontSize.base};
            line-height: ${theme.typography.lineHeight.normal};
            resize: none;
            outline: none;
            max-height: 120px;
            overflow-y: auto;

            &:focus {
              border-color: ${theme.colors.border.focus};
            }

            &::placeholder {
              color: ${theme.colors.text.hint};
            }
          `}
        />
        <button
          onClick={handleSend}
          disabled={!hasContent || sendMutation.isPending}
          aria-label="Send message"
          css={css`
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            color: ${hasContent ? theme.colors.accent : theme.colors.text.hint};
            transition: all ${theme.transitions.fast};
            flex-shrink: 0;
            cursor: ${hasContent ? 'pointer' : 'default'};
            padding: 0;

            &:hover:not(:disabled) {
              background: ${theme.colors.background.elevated};
            }

            &:disabled {
              cursor: default;
            }
          `}
        >
          <PaperPlaneRight size={20} weight={hasContent ? 'fill' : 'regular'} />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Presence Page
// ============================================================================

export function PresencePage() {
  const theme = useTheme();

  return (
    <div css={css`min-height: 100vh;`}>
      <EmotionalField />

      <div
        css={css`
          max-width: 720px;
          margin: 0 auto;
          padding: 0 ${theme.spacing[6]};

          @media (max-width: ${theme.breakpoints.md}) {
            padding: 0 ${theme.spacing[4]};
          }
        `}
      >
        <ThoughtStream />
        <Conversation />
      </div>

      <MessageInput />
    </div>
  );
}
