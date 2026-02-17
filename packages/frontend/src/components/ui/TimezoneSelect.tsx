/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CaretDown } from '@phosphor-icons/react';

export interface TimezoneSelectProps {
  value: string;
  onChange: (timezone: string) => void;
  label?: string;
  helperText?: string;
}

interface TimezoneEntry {
  tz: string;
  offset: string;
  region: string;
}

function getUtcOffset(tz: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(now);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    return tzPart?.value ?? '';
  } catch {
    return '';
  }
}

function buildTimezoneList(): TimezoneEntry[] {
  try {
    // Intl.supportedValuesOf exists in modern runtimes but is missing from older TS lib types
    const tzNames = (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf('timeZone');
    return tzNames.map((tz: string) => ({
      tz,
      offset: getUtcOffset(tz),
      region: tz.split('/')[0] ?? tz,
    }));
  } catch {
    // Fallback for older browsers
    return [];
  }
}

export function TimezoneSelect({ value, onChange, label, helperText }: TimezoneSelectProps) {
  const theme = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allTimezones = useMemo(() => buildTimezoneList(), []);

  const filtered = useMemo(() => {
    if (!filter) return allTimezones;
    const q = filter.toLowerCase();
    return allTimezones.filter(
      (entry) =>
        entry.tz.toLowerCase().includes(q) ||
        entry.offset.toLowerCase().includes(q)
    );
  }, [allTimezones, filter]);

  // Group by region
  const grouped = useMemo(() => {
    const groups: Record<string, TimezoneEntry[]> = {};
    for (const entry of filtered) {
      const region = entry.region;
      if (!groups[region]) groups[region] = [];
      groups[region].push(entry);
    }
    return groups;
  }, [filtered]);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => {
    const items: TimezoneEntry[] = [];
    for (const region of Object.keys(grouped).sort()) {
      const entries = grouped[region];
      if (entries) items.push(...entries);
    }
    return items;
  }, [grouped]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setActiveIndex((i) => Math.min(i + 1, flatList.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && isOpen && flatList[activeIndex]) {
      e.preventDefault();
      onChange(flatList[activeIndex].tz);
      setIsOpen(false);
      setFilter('');
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setFilter('');
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const active = listRef.current.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const displayValue = value || 'Select timezone...';
  const currentOffset = value ? getUtcOffset(value) : '';

  return (
    <div ref={containerRef} css={css`position: relative;`}>
      {label && (
        <label
          css={css`
            display: block;
            font-size: ${theme.typography.fontSize.sm};
            font-weight: ${theme.typography.fontWeight.medium};
            color: ${theme.colors.text.secondary};
            margin-bottom: ${theme.spacing[1.5]};
          `}
        >
          {label}
        </label>
      )}

      <button
        onClick={() => {
          setIsOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        css={css`
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: ${theme.spacing[3]};
          background: ${theme.colors.background.paper};
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid ${theme.colors.border.default};
          border-radius: ${theme.borderRadius.default};
          color: ${value ? theme.colors.text.primary : theme.colors.text.hint};
          font-size: ${theme.typography.fontSize.base};
          line-height: ${theme.typography.lineHeight.normal};
          cursor: pointer;
          text-align: left;
          transition: border-color ${theme.transitions.fast};

          &:focus {
            outline: none;
            border-color: ${theme.colors.border.focus};
          }
        `}
      >
        <span>
          {value ? `${value}` : displayValue}
          {currentOffset && (
            <span css={css`color: ${theme.colors.text.hint}; margin-left: ${theme.spacing[2]};`}>
              ({currentOffset})
            </span>
          )}
        </span>
        <CaretDown size={16} css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`} />
      </button>

      {helperText && (
        <span
          css={css`
            display: block;
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.text.hint};
            margin-top: ${theme.spacing[1.5]};
          `}
        >
          {helperText}
        </span>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            css={css`
              position: absolute;
              top: 100%;
              left: 0;
              right: 0;
              z-index: ${theme.zIndex.dropdown};
              margin-top: ${theme.spacing[1]};
              background: ${theme.colors.background.paper};
              backdrop-filter: blur(16px);
              -webkit-backdrop-filter: blur(16px);
              border: 1px solid ${theme.colors.border.default};
              border-radius: ${theme.borderRadius.default};
              overflow: hidden;
            `}
          >
            {/* Filter input */}
            <div css={css`padding: ${theme.spacing[2]};`}>
              <input
                ref={inputRef}
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search timezones..."
                css={css`
                  width: 100%;
                  padding: ${theme.spacing[2]} ${theme.spacing[3]};
                  background: ${theme.colors.background.elevated};
                  border: 1px solid ${theme.colors.border.light};
                  border-radius: ${theme.borderRadius.default};
                  color: ${theme.colors.text.primary};
                  font-size: ${theme.typography.fontSize.sm};
                  outline: none;
                  &::placeholder { color: ${theme.colors.text.hint}; }
                  &:focus { border-color: ${theme.colors.border.focus}; }
                `}
              />
            </div>

            {/* Timezone list */}
            <div
              ref={listRef}
              css={css`
                max-height: 280px;
                overflow-y: auto;
                padding-bottom: ${theme.spacing[1]};
              `}
            >
              {Object.keys(grouped).sort().map((region) => (
                <div key={region}>
                  <div
                    css={css`
                      padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
                      font-size: ${theme.typography.fontSize.xs};
                      font-weight: ${theme.typography.fontWeight.semibold};
                      color: ${theme.colors.text.hint};
                      text-transform: uppercase;
                      letter-spacing: 0.05em;
                    `}
                  >
                    {region}
                  </div>
                  {(grouped[region] ?? []).map((entry) => {
                    const idx = flatList.indexOf(entry);
                    const isActive = idx === activeIndex;
                    return (
                      <button
                        key={entry.tz}
                        data-active={isActive}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          onChange(entry.tz);
                          setIsOpen(false);
                          setFilter('');
                        }}
                        onMouseEnter={() => setActiveIndex(idx)}
                        css={css`
                          display: flex;
                          align-items: center;
                          justify-content: space-between;
                          width: 100%;
                          text-align: left;
                          padding: ${theme.spacing[2]} ${theme.spacing[3]} ${theme.spacing[2]} ${theme.spacing[5]};
                          background: ${isActive ? theme.colors.background.elevated : 'transparent'};
                          color: ${theme.colors.text.primary};
                          font-size: ${theme.typography.fontSize.sm};
                          border: none;
                          cursor: pointer;
                          transition: background ${theme.transitions.micro};
                        `}
                      >
                        <span>{entry.tz.split('/').slice(1).join('/').replace(/_/g, ' ') || entry.tz}</span>
                        <span css={css`color: ${theme.colors.text.hint}; font-size: ${theme.typography.fontSize.xs};`}>
                          {entry.offset}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {flatList.length === 0 && (
                <div
                  css={css`
                    padding: ${theme.spacing[6]};
                    text-align: center;
                    font-size: ${theme.typography.fontSize.sm};
                    color: ${theme.colors.text.hint};
                  `}
                >
                  No matching timezones
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
