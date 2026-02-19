/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useRef, useEffect, useCallback, useState } from 'react';
import { useScroll, useTransform, motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { File as FileIcon, DownloadSimple } from '@phosphor-icons/react';
import { Typography } from '../ui';

// ============================================================================
// Types
// ============================================================================

export interface AttachmentData {
  id: string;
  type: 'image' | 'audio' | 'video' | 'file';
  mimeType: string;
  originalFilename: string | null;
  sizeBytes: number;
}

export interface MessageData {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  createdAt: string;
  attachments?: AttachmentData[];
}

export interface ReplyStreamState {
  isStreaming: boolean;
  accumulated: string;
}

export interface ConversationProps {
  messages: MessageData[];
  replyStream: ReplyStreamState;
  isThinking: boolean;
  onReplyStreamClear: () => void;
}

// ============================================================================
// Media rendering helpers
// ============================================================================

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mediaUrl(attachmentId: string): string {
  return `/api/media/${attachmentId}`;
}

function ImageAttachment({ attachment }: { attachment: AttachmentData }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <img
        src={mediaUrl(attachment.id)}
        alt={attachment.originalFilename || 'Image'}
        loading="lazy"
        onClick={() => setExpanded(true)}
        css={css`
          max-width: 100%;
          max-height: 300px;
          border-radius: 8px;
          cursor: pointer;
          object-fit: contain;
          transition: opacity 0.15s ease;
          &:hover { opacity: 0.9; }
        `}
      />
      {/* Lightbox overlay */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setExpanded(false)}
            css={css`
              position: fixed;
              inset: 0;
              z-index: ${theme.zIndex.modal};
              background: rgba(0, 0, 0, 0.85);
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: zoom-out;
              padding: 24px;
            `}
          >
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              src={mediaUrl(attachment.id)}
              alt={attachment.originalFilename || 'Image'}
              css={css`
                max-width: 90vw;
                max-height: 90vh;
                object-fit: contain;
                border-radius: 8px;
              `}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function AudioAttachment({ attachment }: { attachment: AttachmentData }) {
  const theme = useTheme();
  return (
    <div css={css`width: 100%;`}>
      {attachment.originalFilename && (
        <Typography.Caption color="secondary" css={css`margin-bottom: 4px;`}>
          {attachment.originalFilename}
        </Typography.Caption>
      )}
      <audio
        controls
        preload="metadata"
        css={css`
          width: 100%;
          max-width: 400px;
          height: 36px;
          border-radius: 8px;
        `}
      >
        <source src={mediaUrl(attachment.id)} type={attachment.mimeType} />
      </audio>
    </div>
  );
}

function VideoAttachment({ attachment }: { attachment: AttachmentData }) {
  return (
    <video
      controls
      preload="metadata"
      css={css`
        max-width: 100%;
        max-height: 360px;
        border-radius: 8px;
      `}
    >
      <source src={mediaUrl(attachment.id)} type={attachment.mimeType} />
    </video>
  );
}

function FileAttachment({ attachment }: { attachment: AttachmentData }) {
  const theme = useTheme();
  return (
    <a
      href={mediaUrl(attachment.id)}
      download={attachment.originalFilename || 'file'}
      css={css`
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 8px;
        background: ${theme.mode === 'light'
          ? 'rgba(26, 24, 22, 0.04)'
          : 'rgba(250, 249, 244, 0.06)'};
        color: ${theme.colors.text.secondary};
        text-decoration: none;
        font-size: 0.875rem;
        transition: background 0.15s ease;
        &:hover {
          background: ${theme.mode === 'light'
            ? 'rgba(26, 24, 22, 0.08)'
            : 'rgba(250, 249, 244, 0.1)'};
        }
      `}
    >
      <FileIcon size={18} />
      <span css={css`
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 200px;
      `}>
        {attachment.originalFilename || 'File'}
      </span>
      <Typography.Caption color="hint">
        {formatFileSize(attachment.sizeBytes)}
      </Typography.Caption>
      <DownloadSimple size={14} />
    </a>
  );
}

function MessageAttachments({ attachments }: { attachments: AttachmentData[] }) {
  const theme = useTheme();
  if (attachments.length === 0) return null;

  return (
    <div
      css={css`
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 6px;
      `}
    >
      {attachments.map((att) => {
        switch (att.type) {
          case 'image':
            return <ImageAttachment key={att.id} attachment={att} />;
          case 'audio':
            return <AudioAttachment key={att.id} attachment={att} />;
          case 'video':
            return <VideoAttachment key={att.id} attachment={att} />;
          case 'file':
            return <FileAttachment key={att.id} attachment={att} />;
        }
      })}
    </div>
  );
}

// ============================================================================
// Scroll-linked message fade (per-message viewport tracking)
// ============================================================================

function FadingMessage({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Track the element's position through the viewport:
  // scrollYProgress goes 0->1 as the element's top moves from 30vh to 50vh
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

function useMarkdownComponents(): Components {
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
// Conversation Component
// ============================================================================

export function Conversation({ messages, replyStream, isThinking, onReplyStreamClear }: ConversationProps) {
  const theme = useTheme();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const hasMountedRef = useRef(false);

  // Sort chronologically -- newest at bottom
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
        // First render -- jump to bottom instantly
        el.scrollTop = el.scrollHeight;
        hasMountedRef.current = true;
      } else if (isNearBottomRef.current) {
        // New message while user is near bottom -- smooth scroll
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
      const timer = setTimeout(() => onReplyStreamClear(), 300);
      return () => clearTimeout(timer);
    }
  }, [replyStream.isStreaming, messages.length, onReplyStreamClear]);

  // Hide the streaming bubble if the early-reply message already arrived in the DB.
  // This happens because the backend persists the reply to messages.db (triggering
  // onMessage -> cache invalidation) before the rest of the structured output finishes
  // parsing (which is when reply:complete fires to set isStreaming=false).
  const replyAlreadyPersisted = replyStream.isStreaming && replyStream.accumulated
    && sorted.some(
      (m) => m.role === 'assistant' && m.content === replyStream.accumulated
    );

  // If early reply is already in the DB, clear the stream state immediately
  useEffect(() => {
    if (replyAlreadyPersisted) {
      onReplyStreamClear();
    }
  }, [replyAlreadyPersisted, onReplyStreamClear]);

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
                    {msg.attachments && msg.attachments.length > 0 && (
                      <MessageAttachments attachments={msg.attachments} />
                    )}
                  </Typography.Body>
                </div>
              </FadingMessage>
            ))}

            {/* Thinking indicator -- shows while mind is processing before reply starts */}
            {isThinking && (
              <div css={css`display: flex; justify-content: flex-start;`}>
                <ThinkingDots />
              </div>
            )}

            {/* Streaming reply bubble -- shows reply text as it arrives */}
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
