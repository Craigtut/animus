/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { Pulse, Brain, User, GearSix } from '@phosphor-icons/react';
import { useShellStore } from '../../store';
import { Typography } from '../ui';

const spaces = [
  { name: 'presence' as const, label: 'Presence', icon: Pulse, path: '/' },
  { name: 'mind' as const, label: 'Mind', icon: Brain, path: '/mind' },
  { name: 'people' as const, label: 'People', icon: User, path: '/people' },
  { name: 'settings' as const, label: 'Settings', icon: GearSix, path: '/settings' },
] as const;

export function NavigationPill() {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { activeSpace, setActiveSpace, connectionStatus } = useShellStore();

  // Determine active space from URL
  const getActiveFromPath = () => {
    const path = location.pathname;
    if (path.startsWith('/mind')) return 'mind';
    if (path.startsWith('/people')) return 'people';
    if (path.startsWith('/settings')) return 'settings';
    return 'presence';
  };

  const currentActive = getActiveFromPath();

  const handleClick = (space: typeof spaces[number]) => {
    setActiveSpace(space.name);
    navigate(space.path);
  };

  return (
    <>
      {/* Desktop pill (top center) */}
      <nav
        aria-label="Main navigation"
        css={css`
          position: fixed;
          top: ${theme.spacing[3]};
          left: 50%;
          transform: translateX(-50%);
          z-index: ${theme.zIndex.navPill};
          display: flex;
          align-items: center;
          gap: ${theme.spacing[1]};
          padding: ${theme.spacing[1.5]} ${theme.spacing[4]};
          border-radius: ${theme.borderRadius.full};
          background: ${theme.mode === 'light'
            ? 'rgba(250, 249, 244, 0.85)'
            : 'rgba(28, 26, 24, 0.85)'};
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid ${theme.colors.border.light};

          @media (max-width: ${theme.breakpoints.md}) {
            display: none;
          }
        `}
      >
        {spaces.map((space) => {
          const isActive = currentActive === space.name;

          return (
            <button
              key={space.name}
              onClick={() => handleClick(space)}
              css={css`
                position: relative;
                display: flex;
                align-items: center;
                padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
                border-radius: ${theme.borderRadius.full};
                font-size: ${theme.typography.fontSize.sm};
                font-weight: ${isActive
                  ? theme.typography.fontWeight.semibold
                  : theme.typography.fontWeight.normal};
                color: ${theme.colors.text.primary};
                opacity: ${isActive ? 1 : 0.55};
                transition: opacity ${theme.transitions.fast};
                cursor: pointer;
                background: none;
                border: none;

                &:hover {
                  opacity: ${isActive ? 1 : 0.8};
                }
              `}
            >
              {space.label}
              {isActive && (
                <motion.div
                  layoutId="nav-dot"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  css={css`
                    position: absolute;
                    bottom: -2px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 4px;
                    height: 4px;
                    border-radius: 50%;
                    background: ${theme.colors.accent};
                  `}
                />
              )}
            </button>
          );
        })}

        {/* Connection status */}
        {connectionStatus !== 'connected' && (
          <div
            css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[1]};
              margin-left: ${theme.spacing[2]};
            `}
          >
            <div
              css={css`
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: ${theme.colors.warning.main};
                opacity: ${connectionStatus === 'reconnecting' ? 0.5 : 0.8};
                animation: ${connectionStatus === 'reconnecting'
                  ? 'pulse 2s ease-in-out infinite'
                  : 'none'};
                @keyframes pulse {
                  0%, 100% { opacity: 0.2; }
                  50% { opacity: 0.5; }
                }
              `}
            />
            {connectionStatus === 'disconnected' && (
              <Typography.Caption color="hint">
                Offline
              </Typography.Caption>
            )}
          </div>
        )}
      </nav>

      {/* Mobile bottom bar */}
      <nav
        aria-label="Main navigation"
        css={css`
          display: none;

          @media (max-width: ${theme.breakpoints.md}) {
            display: flex;
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: ${theme.zIndex.navPill};
            justify-content: space-around;
            align-items: center;
            height: 56px;
            padding-bottom: env(safe-area-inset-bottom, 0);
            background: ${theme.mode === 'light'
              ? 'rgba(250, 249, 244, 0.85)'
              : 'rgba(28, 26, 24, 0.85)'};
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border-top: 1px solid ${theme.colors.border.light};
          }
        `}
      >
        {spaces.map((space) => {
          const isActive = currentActive === space.name;
          const Icon = space.icon;

          return (
            <button
              key={space.name}
              onClick={() => handleClick(space)}
              aria-label={space.label}
              css={css`
                position: relative;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 2px;
                padding: ${theme.spacing[2]};
                min-width: 44px;
                min-height: 44px;
                color: ${theme.colors.text.primary};
                opacity: ${isActive ? 1 : 0.45};
                transition: opacity ${theme.transitions.fast};
                cursor: pointer;
                background: none;
                border: none;
              `}
            >
              <Icon size={24} weight={isActive ? 'fill' : 'regular'} />
              {isActive && (
                <motion.div
                  layoutId="mobile-nav-dot"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  css={css`
                    width: 4px;
                    height: 4px;
                    border-radius: 50%;
                    background: ${theme.colors.accent};
                  `}
                />
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}
