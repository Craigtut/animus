/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { MagnifyingGlass, Pulse, Brain, User, GearSix } from '@phosphor-icons/react';
import { useShellStore } from '../../store';

interface CommandItem {
  id: string;
  label: string;
  secondaryLabel: string;
  icon: React.ElementType;
  path: string;
}

const commands: CommandItem[] = [
  { id: 'presence', label: 'Presence', secondaryLabel: 'Space', icon: Pulse, path: '/' },
  { id: 'mind', label: 'Mind', secondaryLabel: 'Space', icon: Brain, path: '/mind' },
  { id: 'people', label: 'People', secondaryLabel: 'Space', icon: User, path: '/people' },
  { id: 'settings', label: 'Settings', secondaryLabel: 'Space', icon: GearSix, path: '/settings' },
  { id: 'persona', label: 'Persona Settings', secondaryLabel: 'Settings', icon: GearSix, path: '/settings/persona' },
  { id: 'heartbeat', label: 'Heartbeat Settings', secondaryLabel: 'Settings', icon: GearSix, path: '/settings/heartbeat' },
  { id: 'channels', label: 'Channel Settings', secondaryLabel: 'Settings', icon: GearSix, path: '/settings/channels' },
  { id: 'provider', label: 'Provider Settings', secondaryLabel: 'Settings', icon: GearSix, path: '/settings/provider' },
];

export function CommandPalette() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { isCommandPaletteOpen, closeCommandPalette } = useShellStore();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query
    ? commands.filter(
        (cmd) =>
          cmd.label.toLowerCase().includes(query.toLowerCase()) ||
          cmd.secondaryLabel.toLowerCase().includes(query.toLowerCase())
      )
    : commands.slice(0, 6);

  const select = useCallback(
    (item: CommandItem) => {
      closeCommandPalette();
      setQuery('');
      navigate(item.path);
    },
    [closeCommandPalette, navigate]
  );

  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isCommandPaletteOpen]);

  // Global Cmd/Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isCommandPaletteOpen) {
          closeCommandPalette();
        } else {
          useShellStore.getState().openCommandPalette();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isCommandPaletteOpen, closeCommandPalette]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[activeIndex]) {
      select(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      closeCommandPalette();
    }
  };

  return (
    <AnimatePresence>
      {isCommandPaletteOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            onClick={closeCommandPalette}
            css={css`
              position: fixed;
              inset: 0;
              background: rgba(0, 0, 0, 0.4);
              z-index: ${theme.zIndex.commandPalette - 1};
            `}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            css={css`
              position: fixed;
              top: 20%;
              left: 50%;
              transform: translateX(-50%);
              z-index: ${theme.zIndex.commandPalette};
              width: calc(100% - ${theme.spacing[8]});
              max-width: 560px;
              background: ${theme.colors.background.paper};
              border-radius: ${theme.borderRadius.xl};
              border: 1px solid ${theme.colors.border.light};
              overflow: hidden;

              @media (max-width: ${theme.breakpoints.md}) {
                top: 0;
                left: 0;
                transform: none;
                width: 100%;
                max-width: none;
                height: 100vh;
                border-radius: 0;
              }
            `}
          >
            {/* Search input */}
            <div
              css={css`
                display: flex;
                align-items: center;
                gap: ${theme.spacing[3]};
                padding: ${theme.spacing[4]} ${theme.spacing[5]};
                border-bottom: 1px solid ${theme.colors.border.light};
              `}
            >
              <MagnifyingGlass
                size={20}
                css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`}
              />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Go to..."
                css={css`
                  flex: 1;
                  background: none;
                  border: none;
                  outline: none;
                  color: ${theme.colors.text.primary};
                  font-size: ${theme.typography.fontSize.lg};
                  &::placeholder { color: ${theme.colors.text.hint}; }
                `}
              />
            </div>

            {/* Results */}
            <div
              css={css`
                max-height: 320px;
                overflow-y: auto;
                padding: ${theme.spacing[2]};
              `}
            >
              {filtered.map((item, i) => {
                const Icon = item.icon;
                const isActive = i === activeIndex;
                return (
                  <button
                    key={item.id}
                    onClick={() => select(item)}
                    onMouseEnter={() => setActiveIndex(i)}
                    css={css`
                      display: flex;
                      align-items: center;
                      gap: ${theme.spacing[3]};
                      width: 100%;
                      padding: ${theme.spacing[3]} ${theme.spacing[3]};
                      border-radius: ${theme.borderRadius.default};
                      background: ${isActive ? theme.colors.background.elevated : 'transparent'};
                      color: ${theme.colors.text.primary};
                      cursor: pointer;
                      border: none;
                      text-align: left;
                      transition: background ${theme.transitions.micro};
                    `}
                  >
                    <Icon size={18} css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`} />
                    <span css={css`flex: 1; font-size: ${theme.typography.fontSize.base};`}>
                      {item.label}
                    </span>
                    <span css={css`
                      font-size: ${theme.typography.fontSize.xs};
                      color: ${theme.colors.text.hint};
                    `}>
                      {item.secondaryLabel}
                    </span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div css={css`
                  padding: ${theme.spacing[8]};
                  text-align: center;
                  color: ${theme.colors.text.hint};
                  font-size: ${theme.typography.fontSize.sm};
                `}>
                  No results
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
