/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { motion } from 'motion/react';
import { useNavigate, useLocation } from 'react-router-dom';

export type MindSection = 'emotions' | 'thoughts' | 'memories' | 'goals' | 'agents';

const sections: { key: MindSection; label: string }[] = [
  { key: 'emotions', label: 'Emotions' },
  { key: 'thoughts', label: 'Thoughts' },
  { key: 'memories', label: 'Memories' },
  { key: 'goals', label: 'Goals' },
  { key: 'agents', label: 'Agents' },
];

export function MindSubNav() {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const activeSection = getActiveSection(location.pathname);

  return (
    <nav
      aria-label="Mind sections"
      css={css`
        display: flex;
        gap: ${theme.spacing[6]};
        overflow-x: auto;
        scrollbar-width: none;
        &::-webkit-scrollbar { display: none; }

        @media (max-width: ${theme.breakpoints.md}) {
          gap: ${theme.spacing[5]};
        }
      `}
    >
      {sections.map(({ key, label }) => {
        const isActive = key === activeSection;
        return (
          <button
            key={key}
            onClick={() => navigate(`/mind/${key}`)}
            css={css`
              position: relative;
              padding: 0 0 ${theme.spacing[2]} 0;
              font-size: ${theme.typography.fontSize.base};
              font-weight: ${isActive
                ? theme.typography.fontWeight.semibold
                : theme.typography.fontWeight.normal};
              color: ${isActive
                ? theme.colors.text.primary
                : theme.colors.text.secondary};
              transition: color ${theme.transitions.micro};
              white-space: nowrap;
              cursor: pointer;

              &:hover {
                color: ${isActive
                  ? theme.colors.text.primary
                  : theme.colors.text.hint};
                opacity: ${isActive ? 1 : 0.75};
              }
            `}
          >
            {label}
            {isActive && (
              <motion.div
                layoutId="mind-section-underline"
                css={css`
                  position: absolute;
                  bottom: 0;
                  left: 0;
                  right: 0;
                  height: 2px;
                  background: ${theme.colors.accent};
                  border-radius: 1px;
                  opacity: 0.6;
                `}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function getActiveSection(pathname: string): MindSection {
  if (pathname.includes('/mind/thoughts')) return 'thoughts';
  if (pathname.includes('/mind/memories')) return 'memories';
  if (pathname.includes('/mind/goals')) return 'goals';
  if (pathname.includes('/mind/agents')) return 'agents';
  return 'emotions';
}
