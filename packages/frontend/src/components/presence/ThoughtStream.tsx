/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { motion, AnimatePresence } from 'motion/react';
import { Moon } from '@phosphor-icons/react';
import { Typography } from '../ui';

// ============================================================================
// Types
// ============================================================================

export interface ThoughtData {
  id: string;
  content: string;
  importance: number;
  createdAt: string;
}

export interface ThoughtStreamProps {
  thoughts: ThoughtData[];
  onThoughtClick?: () => void;
}

export interface SleepIndicatorProps {
  isSleeping: boolean;
  name: string | undefined;
}

// ============================================================================
// Sleep Indicator
// ============================================================================

export function SleepIndicator({ isSleeping, name }: SleepIndicatorProps) {
  const theme = useTheme();

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
// Three Dots Divider
// ============================================================================

export function DotsDivider() {
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
// Thought Stream (reworked -- 3 thoughts, receding upward)
// ============================================================================

export function ThoughtStream({ thoughts, onThoughtClick }: ThoughtStreamProps) {
  const theme = useTheme();

  const displayThoughts = thoughts.slice(0, 3);

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
              onClick={onThoughtClick}
              css={css`
                text-align: center;
                max-width: 520px;
                line-height: ${theme.typography.lineHeight.relaxed};
                cursor: ${onThoughtClick ? 'pointer' : 'default'};

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
