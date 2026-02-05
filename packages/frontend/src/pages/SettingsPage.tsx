/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from '@phosphor-icons/react';

export function SettingsPage() {
  const theme = useTheme();

  return (
    <div
      css={css`
        min-height: 100vh;
        padding: ${theme.spacing[6]};
      `}
    >
      <Link
        to="/dashboard"
        css={css`
          display: inline-flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          color: ${theme.colors.text.secondary};
          margin-bottom: ${theme.spacing[6]};
          transition: color ${theme.transitions.fast};

          &:hover {
            color: ${theme.colors.text.primary};
          }
        `}
      >
        <ArrowLeft size={20} />
        Back to Dashboard
      </Link>

      <h1
        css={css`
          font-size: ${theme.typography.fontSize['2xl']};
          font-weight: ${theme.typography.fontWeight.semibold};
          margin-bottom: ${theme.spacing[6]};
        `}
      >
        Settings
      </h1>

      <div
        css={css`
          display: flex;
          flex-direction: column;
          gap: ${theme.spacing[6]};
          max-width: 600px;
        `}
      >
        {/* System Settings */}
        <section
          css={css`
            padding: ${theme.spacing[6]};
            background: ${theme.colors.background.paper};
            border: 1px solid ${theme.colors.border.default};
            border-radius: ${theme.borderRadius.lg};
          `}
        >
          <h2
            css={css`
              font-size: ${theme.typography.fontSize.lg};
              font-weight: ${theme.typography.fontWeight.semibold};
              margin-bottom: ${theme.spacing[4]};
            `}
          >
            System Settings
          </h2>
          <p
            css={css`
              color: ${theme.colors.text.secondary};
            `}
          >
            System configuration options will appear here.
          </p>
        </section>

        {/* Personality Settings */}
        <section
          css={css`
            padding: ${theme.spacing[6]};
            background: ${theme.colors.background.paper};
            border: 1px solid ${theme.colors.border.default};
            border-radius: ${theme.borderRadius.lg};
          `}
        >
          <h2
            css={css`
              font-size: ${theme.typography.fontSize.lg};
              font-weight: ${theme.typography.fontWeight.semibold};
              margin-bottom: ${theme.spacing[4]};
            `}
          >
            Personality
          </h2>
          <p
            css={css`
              color: ${theme.colors.text.secondary};
            `}
          >
            Configure Animus's personality, communication style, and values.
          </p>
        </section>

        {/* API Keys */}
        <section
          css={css`
            padding: ${theme.spacing[6]};
            background: ${theme.colors.background.paper};
            border: 1px solid ${theme.colors.border.default};
            border-radius: ${theme.borderRadius.lg};
          `}
        >
          <h2
            css={css`
              font-size: ${theme.typography.fontSize.lg};
              font-weight: ${theme.typography.fontWeight.semibold};
              margin-bottom: ${theme.spacing[4]};
            `}
          >
            API Keys
          </h2>
          <p
            css={css`
              color: ${theme.colors.text.secondary};
            `}
          >
            Configure API keys for Claude, Codex, and OpenCode.
          </p>
        </section>
      </div>
    </div>
  );
}
