/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PaperPlaneRight, Moon } from '@phosphor-icons/react';
import { motion, AnimatePresence, useScroll, useTransform } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { Typography } from '../components/ui';
import { FluidBackground } from '../components/effects/FluidBackground';
import { trpc } from '../utils/trpc';
import { useHeartbeatStore } from '../store/heartbeat-store';

// ============================================================================
// Thought Stream (reworked — 3 thoughts, receding upward)
// ============================================================================

interface ThoughtData {
  id: string;
  content: string;
  importance: number;
  createdAt: string;
}

function ThoughtStream() {
  const theme = useTheme();
  const navigate = useNavigate();

  const { data: thoughts } = trpc.heartbeat.getRecentThoughts.useQuery(undefined, {
    retry: false,
  });

  const storeThoughts = useHeartbeatStore(s => s.recentThoughts);
  const allThoughts = storeThoughts.length > 0 ? storeThoughts : (thoughts ?? []);
  const displayThoughts: ThoughtData[] = allThoughts.slice(0, 3);

  if (displayThoughts.length === 0) return null;

  // Visual treatment per layer (bottom = newest = index 0 in reversed display)
  const layers = [
    { opacity: 1, blur: 0, scale: 1 },         // newest (bottom)
    { opacity: 0.56, blur: 1.5, scale: 0.92 },  // second
    { opacity: 0.25, blur: 3, scale: 0.84 },     // third (top)
  ];

  return (
    <div
      role="log"
      aria-live="polite"
      css={css`
        display: flex;
        flex-direction: column-reverse;
        align-items: center;
        gap: ${theme.spacing[3]};
        padding: 0 ${theme.spacing[6]};

        @media (max-width: ${theme.breakpoints.md}) {
          padding: 0 ${theme.spacing[4]};
        }
      `}
    >
      <AnimatePresence>
        {displayThoughts.map((thought, i) => {
          const layer = (layers[i] ?? layers[layers.length - 1])!;
          return (
            <Typography.Body
              key={thought.id}
              as={motion.p}
              serif
              initial={{ opacity: 0, y: 12 }}
              animate={{
                opacity: layer.opacity,
                y: 0,
                filter: layer.blur > 0 ? `blur(${layer.blur}px)` : 'blur(0px)',
                scale: layer.scale,
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              color="primary"
              onClick={() => navigate('/mind/journal')}
              css={css`
                text-align: center;
                max-width: 520px;
                line-height: ${theme.typography.lineHeight.relaxed};
                cursor: pointer;

                /* 2-line clamp with ellipsis */
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
              `}
            >
              {thought.content}
            </Typography.Body>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Three Dots Divider
// ============================================================================

function DotsDivider() {
  const theme = useTheme();
  return (
    <div
      aria-hidden="true"
      css={css`
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 8px;
        padding: ${theme.spacing[4]} 0;
      `}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          css={css`
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background: ${theme.colors.text.hint};
            opacity: 0.4;
          `}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Scroll-linked message fade (per-message viewport tracking)
// ============================================================================

function FadingMessage({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Track the element's position through the viewport:
  // scrollYProgress goes 0→1 as the element's top moves from 30vh to 50vh
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.3', 'start 0.5'],
  });
  const opacity = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <motion.div ref={ref} style={{ opacity }}>
      {children}
    </motion.div>
  );
}

// ============================================================================
// Streaming indicators
// ============================================================================

function BlinkingCursor() {
  const theme = useTheme();
  return (
    <span
      css={css`
        display: inline-block;
        width: 2px;
        height: 1em;
        background: ${theme.colors.text.primary};
        margin-left: 1px;
        vertical-align: text-bottom;
        animation: blink 1s step-end infinite;
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}
    />
  );
}

function ThinkingDots() {
  const theme = useTheme();
  return (
    <div
      css={css`
        display: flex;
        gap: 4px;
        padding: ${theme.spacing[2]} 0;
      `}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          css={css`
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: ${theme.colors.text.hint};
            animation: thinkFade 1.4s ease-in-out ${i * 0.2}s infinite;
            @keyframes thinkFade {
              0%, 80%, 100% { opacity: 0.2; }
              40% { opacity: 1; }
            }
          `}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Markdown message renderer
// ============================================================================

function useMarkdownComponents(): import('react-markdown').Components {
  const theme = useTheme();

  return {
    p: ({ children }) => (
      <p css={css`margin: 0.6em 0; &:first-child { margin-top: 0; } &:last-child { margin-bottom: 0; }`}>
        {children}
      </p>
    ),
    strong: ({ children }) => (
      <strong css={css`font-weight: 700;`}>{children}</strong>
    ),
    em: ({ children }) => (
      <em css={css`font-style: italic; font-synthesis: style;`}>{children}</em>
    ),
    code: ({ children, className }) => {
      const isBlock = className?.startsWith('language-');
      if (isBlock) {
        return (
          <code
            className={className}
            css={css`
              font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
              font-size: 0.85em;
              padding: 0;
              background: none;
            `}
          >
            {children}
          </code>
        );
      }
      return (
        <code
          css={css`
            font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
            font-size: 0.88em;
            padding: 0.15em 0.35em;
            border-radius: 4px;
            background: ${theme.mode === 'light'
              ? 'rgba(26, 24, 22, 0.06)'
              : 'rgba(250, 249, 244, 0.08)'};
          `}
        >
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre
        css={css`
          margin: 0.6em 0;
          padding: ${theme.spacing[3]};
          border-radius: 8px;
          overflow-x: auto;
          background: ${theme.mode === 'light'
            ? 'rgba(26, 24, 22, 0.04)'
            : 'rgba(250, 249, 244, 0.06)'};
        `}
      >
        {children}
      </pre>
    ),
    ul: ({ children }) => (
      <ul css={css`margin: 0.6em 0; padding-left: 1.4em; list-style: disc;`}>
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol css={css`margin: 0.6em 0; padding-left: 1.4em; list-style: decimal;`}>
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li css={css`margin: 0.2em 0;`}>{children}</li>
    ),
    blockquote: ({ children }) => (
      <blockquote
        css={css`
          margin: 0.6em 0;
          padding-left: ${theme.spacing[3]};
          border-left: 2px solid ${theme.colors.border.default};
          color: ${theme.colors.text.secondary};
        `}
      >
        {children}
      </blockquote>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        css={css`
          color: ${theme.colors.accent};
          text-decoration: underline;
          text-underline-offset: 2px;
        `}
      >
        {children}
      </a>
    ),
    hr: () => (
      <hr css={css`border: none; border-top: 1px solid ${theme.colors.border.light}; margin: 0.8em 0;`} />
    ),
    h1: ({ children }) => <h1 css={css`font-size: 1.25em; font-weight: 600; margin: 0.6em 0 0.3em; &:first-child { margin-top: 0; }`}>{children}</h1>,
    h2: ({ children }) => <h2 css={css`font-size: 1.15em; font-weight: 600; margin: 0.6em 0 0.3em; &:first-child { margin-top: 0; }`}>{children}</h2>,
    h3: ({ children }) => <h3 css={css`font-size: 1.05em; font-weight: 600; margin: 0.6em 0 0.3em; &:first-child { margin-top: 0; }`}>{children}</h3>,
  };
}

function MessageMarkdown({ content }: { content: string }) {
  const components = useMarkdownComponents();
  return <ReactMarkdown components={components}>{content}</ReactMarkdown>;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const hasMountedRef = useRef(false);
  const replyStream = useHeartbeatStore((s) => s.replyStream);
  const heartbeatState = useHeartbeatStore((s) => s.heartbeatState);

  const { data: messagesData } = trpc.messages.getRecent.useQuery(
    { limit: 50 },
    { retry: false }
  );

  const messages: MessageData[] = (messagesData ?? []).map((m: any) => ({
    id: m.id,
    content: m.content,
    role: m.direction ? mapDirectionToRole(m.direction) : (m.role ?? 'assistant'),
    createdAt: m.createdAt,
  }));

  // Sort chronologically — newest at bottom
  const sorted = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // Track whether user is near the bottom of the scroll container
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 100;
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // Auto-scroll: instant on mount, smooth for new messages, only if near bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || sorted.length === 0) return;

    requestAnimationFrame(() => {
      if (!hasMountedRef.current) {
        // First render — jump to bottom instantly
        el.scrollTop = el.scrollHeight;
        hasMountedRef.current = true;
      } else if (isNearBottomRef.current) {
        // New message while user is near bottom — smooth scroll
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
      // If user has scrolled up, do nothing
    });
  }, [sorted.length]);

  // Auto-scroll when streaming chunks arrive
  useEffect(() => {
    if (replyStream.isStreaming && isNearBottomRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [replyStream.accumulated]);

  // Clear streaming state after the persisted message arrives in the query cache
  useEffect(() => {
    if (!replyStream.isStreaming && replyStream.accumulated && messages.length > 0) {
      const timer = setTimeout(() => useHeartbeatStore.getState().clearReplyStream(), 300);
      return () => clearTimeout(timer);
    }
  }, [replyStream.isStreaming, messages.length]);

  // Hide the streaming bubble if the early-reply message already arrived in the DB.
  // This happens because the backend persists the reply to messages.db (triggering
  // onMessage → cache invalidation) before the rest of the structured output finishes
  // parsing (which is when reply:complete fires to set isStreaming=false).
  const replyAlreadyPersisted = replyStream.isStreaming && replyStream.accumulated
    && sorted.some(
      (m) => m.role === 'assistant' && m.content === replyStream.accumulated
    );

  // If early reply is already in the DB, clear the stream state immediately
  useEffect(() => {
    if (replyAlreadyPersisted) {
      useHeartbeatStore.getState().clearReplyStream();
    }
  }, [replyAlreadyPersisted]);

  const isThinking = heartbeatState?.currentStage === 'mind' && !replyStream.isStreaming;

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      css={css`
        height: 100%;
        overflow-y: auto;
        scrollbar-width: none;
        &::-webkit-scrollbar { display: none; }
      `}
    >
      {/* Inner wrapper: fills height, pushes sparse messages to bottom */}
      <div
        css={css`
          max-width: 720px;
          margin: 0 auto;
          min-height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
        `}
      >
        {sorted.length === 0 && !isThinking && !replyStream.isStreaming ? (
          <Typography.Body
            color="hint"
            css={css`
              text-align: center;
              padding: ${theme.spacing[16]} 0;
            `}
          >
            Say something.
          </Typography.Body>
        ) : (
          <div
            role="log"
            aria-live="polite"
            css={css`
              display: flex;
              flex-direction: column;
              gap: ${theme.spacing[3]};
              padding: ${theme.spacing[4]} ${theme.spacing[6]};
              padding-bottom: 120px;

              @media (max-width: ${theme.breakpoints.md}) {
                padding: ${theme.spacing[4]};
                padding-bottom: 140px;
              }
            `}
          >
            {sorted.map((msg) => (
              <FadingMessage key={msg.id}>
                <div
                  css={css`
                    display: flex;
                    justify-content: ${msg.role === 'user' ? 'flex-end' : 'flex-start'};
                  `}
                >
                  <Typography.Body
                    as="div"
                    color="primary"
                    css={css`
                      max-width: ${msg.role === 'user' ? '80%' : '85%'};
                      ${msg.role === 'user'
                        ? `
                          background: ${theme.mode === 'light' ? 'rgba(26, 24, 22, 0.06)' : 'rgba(250, 249, 244, 0.08)'};
                          border-radius: 16px;
                          padding: ${theme.spacing[3]} ${theme.spacing[4]};
                        `
                        : ''}
                    `}
                  >
                    <MessageMarkdown content={msg.content} />
                  </Typography.Body>
                </div>
              </FadingMessage>
            ))}

            {/* Thinking indicator — shows while mind is processing before reply starts */}
            {isThinking && (
              <div css={css`display: flex; justify-content: flex-start;`}>
                <ThinkingDots />
              </div>
            )}

            {/* Streaming reply bubble — shows reply text as it arrives */}
            {replyStream.isStreaming && replyStream.accumulated && !replyAlreadyPersisted && (
              <div css={css`display: flex; justify-content: flex-start;`}>
                <Typography.Body
                  as="div"
                  color="primary"
                  css={css`max-width: 85%;`}
                >
                  <MessageMarkdown content={replyStream.accumulated} />
                  <BlinkingCursor />
                </Typography.Body>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Floating Message Input (pill capsule)
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
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: ${theme.zIndex.sticky};
        width: min(600px, calc(100vw - 48px));

        @media (max-width: ${theme.breakpoints.md}) {
          bottom: calc(56px + 12px + env(safe-area-inset-bottom, 0px));
        }
      `}
    >
      <div
        css={css`
          display: flex;
          align-items: flex-end;
          gap: ${theme.spacing[2]};
          padding: ${theme.spacing[1.5]} ${theme.spacing[1.5]} ${theme.spacing[1.5]} ${theme.spacing[4]};
          border-radius: ${theme.borderRadius.full};
          background: ${theme.mode === 'light'
            ? 'rgba(250, 249, 244, 0.85)'
            : 'rgba(28, 26, 24, 0.85)'};
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid ${theme.colors.border.light};
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
            padding: ${theme.spacing[1.5]} 0;
            background: transparent;
            border: none;
            color: ${theme.colors.text.primary};
            font-size: ${theme.typography.fontSize.base};
            font-family: ${theme.typography.fontFamily.sans};
            line-height: ${theme.typography.lineHeight.normal};
            resize: none;
            outline: none;
            max-height: 120px;
            overflow-y: auto;

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
            width: 36px;
            height: 36px;
            border-radius: 50%;
            flex-shrink: 0;
            cursor: ${hasContent ? 'pointer' : 'default'};
            padding: 0;
            border: none;
            background: ${hasContent ? theme.colors.accent : 'transparent'};
            color: ${hasContent ? theme.colors.accentForeground : theme.colors.text.hint};
            transition: all ${theme.transitions.fast};

            &:hover:not(:disabled) {
              opacity: 0.85;
            }

            &:disabled {
              cursor: default;
            }
          `}
        >
          <PaperPlaneRight size={18} weight={hasContent ? 'fill' : 'regular'} />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Presence Page
// ============================================================================

// ============================================================================
// Sleep Indicator
// ============================================================================

function SleepIndicator() {
  const theme = useTheme();
  const energyBand = useHeartbeatStore((s) => s.energyBand);

  const { data: energyState } = trpc.heartbeat.getEnergyState.useQuery(undefined, {
    retry: false,
  });
  const { data: persona } = trpc.persona.get.useQuery(undefined, { retry: false });

  const isSleeping = energyBand === 'sleeping' || (!energyBand && energyState?.energyBand === 'sleeping');
  const name = persona?.name;

  if (!isSleeping || !name) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      css={css`
        display: flex;
        align-items: center;
        justify-content: center;
        gap: ${theme.spacing[2]};
        padding: ${theme.spacing[2]} ${theme.spacing[4]};
      `}
    >
      <Moon size={14} css={css`opacity: 0.4; color: #818cf8;`} />
      <Typography.Caption
        serif
        italic
        css={css`
          opacity: 0.45;
          color: ${theme.colors.text.secondary};
        `}
      >
        {name} is sleeping
      </Typography.Caption>
    </motion.div>
  );
}

// ============================================================================
// Presence Page
// ============================================================================

export function PresencePage() {
  const theme = useTheme();

  return (
    <div css={css`min-height: 100vh;`}>
      {/* ── The Being (fixed top half) ── */}
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
            /* Fade to transparent at bottom edge */
            mask-image: linear-gradient(to bottom, black 65%, transparent 100%);
            -webkit-mask-image: linear-gradient(to bottom, black 65%, transparent 100%);
          `}
        >
          <FluidBackground mode={theme.mode} />
        </div>

        {/* Thought stream + divider (positioned at bottom of the being section) */}
        <div
          css={css`
            position: relative;
            z-index: 1;
            padding-bottom: ${theme.spacing[1]};
          `}
        >
          <SleepIndicator />
          <ThoughtStream />
          <DotsDivider />
        </div>
      </div>

      {/* ── The Conversation (fixed scroll container) ── */}
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
        <Conversation />
      </div>

      {/* ── Floating Message Input ── */}
      <MessageInput />
    </div>
  );
}
