/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { Link } from 'react-router-dom';
import { Gear, House } from '@phosphor-icons/react';

export function DashboardPage() {
  const theme = useTheme();

  return (
    <div
      css={css`
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      `}
    >
      {/* Header */}
      <header
        css={css`
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: ${theme.spacing[4]} ${theme.spacing[6]};
          border-bottom: 1px solid ${theme.colors.border.default};
          background: ${theme.colors.background.paper};
        `}
      >
        <Link
          to="/"
          css={css`
            display: flex;
            align-items: center;
            gap: ${theme.spacing[2]};
            font-size: ${theme.typography.fontSize.xl};
            font-weight: ${theme.typography.fontWeight.bold};
            color: ${theme.colors.text.primary};
          `}
        >
          <House size={24} />
          Animus
        </Link>

        <Link
          to="/settings"
          css={css`
            display: flex;
            align-items: center;
            padding: ${theme.spacing[2]};
            color: ${theme.colors.text.secondary};
            border-radius: ${theme.borderRadius.default};
            transition: all ${theme.transitions.fast};

            &:hover {
              color: ${theme.colors.text.primary};
              background: ${theme.colors.background.elevated};
            }
          `}
        >
          <Gear size={24} />
        </Link>
      </header>

      {/* Main Content */}
      <main
        css={css`
          flex: 1;
          padding: ${theme.spacing[6]};
        `}
      >
        <h1
          css={css`
            font-size: ${theme.typography.fontSize['2xl']};
            font-weight: ${theme.typography.fontWeight.semibold};
            margin-bottom: ${theme.spacing[6]};
          `}
        >
          Dashboard
        </h1>

        <div
          css={css`
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: ${theme.spacing[6]};
          `}
        >
          {/* Heartbeat Status Card */}
          <div
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
              Heartbeat Status
            </h2>
            <p
              css={css`
                color: ${theme.colors.text.secondary};
              `}
            >
              Heartbeat monitoring will appear here once the backend is connected.
            </p>
          </div>

          {/* Recent Thoughts Card */}
          <div
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
              Recent Thoughts
            </h2>
            <p
              css={css`
                color: ${theme.colors.text.secondary};
              `}
            >
              Animus's recent thoughts will appear here.
            </p>
          </div>

          {/* Agent Activity Card */}
          <div
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
              Agent Activity
            </h2>
            <p
              css={css`
                color: ${theme.colors.text.secondary};
              `}
            >
              Active agent sessions and recent actions will appear here.
            </p>
          </div>

          {/* Tasks Card */}
          <div
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
              Tasks
            </h2>
            <p
              css={css`
                color: ${theme.colors.text.secondary};
              `}
            >
              Pending and active tasks will appear here.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
