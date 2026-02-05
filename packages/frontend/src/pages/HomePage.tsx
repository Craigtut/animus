/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Heart, Brain, Lightning } from '@phosphor-icons/react';

export function HomePage() {
  const theme = useTheme();

  return (
    <div
      css={css`
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: ${theme.spacing[8]};
        text-align: center;
      `}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <h1
          css={css`
            font-size: ${theme.typography.fontSize['4xl']};
            font-weight: ${theme.typography.fontWeight.bold};
            margin-bottom: ${theme.spacing[4]};
            background: linear-gradient(
              135deg,
              ${theme.colors.primary[400]} 0%,
              ${theme.colors.primary[600]} 100%
            );
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
          `}
        >
          Animus
        </h1>

        <p
          css={css`
            font-size: ${theme.typography.fontSize.lg};
            color: ${theme.colors.text.secondary};
            max-width: 600px;
            margin-bottom: ${theme.spacing[8]};
          `}
        >
          An agentic system with a mind, a spirit, and an inner will that moves
          with agency to act.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.3 }}
        css={css`
          display: flex;
          gap: ${theme.spacing[6]};
          margin-bottom: ${theme.spacing[8]};
        `}
      >
        <FeatureCard
          icon={<Heart size={32} weight="fill" />}
          title="Heartbeat"
          description="A continuous pulse that drives inner life"
        />
        <FeatureCard
          icon={<Brain size={32} weight="fill" />}
          title="Persistent Mind"
          description="Thoughts, memories, and emotions that persist"
        />
        <FeatureCard
          icon={<Lightning size={32} weight="fill" />}
          title="Agency"
          description="Autonomous action with guardrails"
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.6 }}
        css={css`
          display: flex;
          gap: ${theme.spacing[4]};
        `}
      >
        <Link
          to="/dashboard"
          css={css`
            display: inline-flex;
            align-items: center;
            padding: ${theme.spacing[3]} ${theme.spacing[6]};
            background: ${theme.colors.primary[600]};
            color: white;
            border-radius: ${theme.borderRadius.default};
            font-weight: ${theme.typography.fontWeight.medium};
            transition: background ${theme.transitions.fast};

            &:hover {
              background: ${theme.colors.primary[500]};
              color: white;
            }
          `}
        >
          Open Dashboard
        </Link>

        <Link
          to="/login"
          css={css`
            display: inline-flex;
            align-items: center;
            padding: ${theme.spacing[3]} ${theme.spacing[6]};
            background: transparent;
            color: ${theme.colors.text.primary};
            border: 1px solid ${theme.colors.border.light};
            border-radius: ${theme.borderRadius.default};
            font-weight: ${theme.typography.fontWeight.medium};
            transition: all ${theme.transitions.fast};

            &:hover {
              background: ${theme.colors.background.elevated};
              color: ${theme.colors.text.primary};
            }
          `}
        >
          Sign In
        </Link>
      </motion.div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  const theme = useTheme();

  return (
    <div
      css={css`
        padding: ${theme.spacing[6]};
        background: ${theme.colors.background.paper};
        border: 1px solid ${theme.colors.border.default};
        border-radius: ${theme.borderRadius.lg};
        width: 200px;
        text-align: center;
      `}
    >
      <div
        css={css`
          color: ${theme.colors.primary[400]};
          margin-bottom: ${theme.spacing[3]};
        `}
      >
        {icon}
      </div>
      <h3
        css={css`
          font-size: ${theme.typography.fontSize.lg};
          font-weight: ${theme.typography.fontWeight.semibold};
          margin-bottom: ${theme.spacing[2]};
        `}
      >
        {title}
      </h3>
      <p
        css={css`
          font-size: ${theme.typography.fontSize.sm};
          color: ${theme.colors.text.secondary};
        `}
      >
        {description}
      </p>
    </div>
  );
}
