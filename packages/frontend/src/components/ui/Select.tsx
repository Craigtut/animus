/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useRef, useEffect, useCallback, useId, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { CaretDown, Check } from '@phosphor-icons/react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  label?: string | undefined;
  error?: string | undefined;
  helperText?: string | undefined;
  disabled?: boolean | undefined;
  /** Max width constraint for the trigger (e.g. '160px') */
  maxWidth?: string | undefined;
}

const DROPDOWN_MAX_HEIGHT = 240;
const DROPDOWN_GAP = 4;

export function Select({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  label,
  error,
  helperText,
  disabled = false,
  maxWidth,
}: SelectProps) {
  const theme = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const isKeyboardNav = useRef(false);

  // Portal positioning state
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
    flipUp: boolean;
  }>({ top: 0, left: 0, width: 0, flipUp: false });

  const selectedOption = options.find((o) => o.value === value);

  // Compute dropdown position from trigger rect
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - DROPDOWN_GAP;
    const spaceAbove = rect.top - DROPDOWN_GAP;
    const flipUp = spaceBelow < DROPDOWN_MAX_HEIGHT && spaceAbove > spaceBelow;

    setDropdownPos({
      top: flipUp
        ? rect.top + window.scrollY - DROPDOWN_GAP
        : rect.bottom + window.scrollY + DROPDOWN_GAP,
      left: rect.left + window.scrollX,
      width: rect.width,
      flipUp,
    });
  }, []);

  // Update position when opening and on scroll/resize while open
  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();

    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);

  // Reset active index when opening
  useEffect(() => {
    if (isOpen) {
      const idx = options.findIndex((o) => o.value === value);
      setActiveIndex(idx >= 0 ? idx : 0);
      // Scroll selected item into view on open
      requestAnimationFrame(() => {
        if (listRef.current) {
          const active = listRef.current.querySelector('[data-active="true"]');
          active?.scrollIntoView({ block: 'nearest' });
        }
      });
    }
  }, [isOpen, options, value]);

  // Scroll active item into view only for keyboard navigation
  useEffect(() => {
    if (!isOpen || !listRef.current || activeIndex < 0 || !isKeyboardNav.current) return;
    const active = listRef.current.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
    isKeyboardNav.current = false;
  }, [activeIndex, isOpen]);

  // Close on click outside (portal-aware: check both container and list)
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        listRef.current && !listRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const selectOption = useCallback((opt: SelectOption) => {
    onChange(opt.value);
    setIsOpen(false);
    // Return focus to trigger after selection
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, [onChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          isKeyboardNav.current = true;
          setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          isKeyboardNav.current = true;
          setActiveIndex((i) => Math.max(i - 1, 0));
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (isOpen && options[activeIndex]) {
          selectOption(options[activeIndex]);
        } else {
          setIsOpen(true);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;
      case 'Home':
        if (isOpen) {
          e.preventDefault();
          isKeyboardNav.current = true;
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (isOpen) {
          e.preventDefault();
          isKeyboardNav.current = true;
          setActiveIndex(options.length - 1);
        }
        break;
      case 'Tab':
        if (isOpen) {
          setIsOpen(false);
        }
        break;
    }
  };

  // Dropdown rendered via portal
  const dropdown = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: dropdownPos.flipUp ? 4 : -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: dropdownPos.flipUp ? 4 : -4, scale: 0.98 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          css={css`
            position: absolute;
            z-index: ${theme.zIndex.dropdown};
            top: ${dropdownPos.top}px;
            left: ${dropdownPos.left}px;
            width: ${dropdownPos.width}px;
            ${dropdownPos.flipUp ? `transform-origin: bottom;` : `transform-origin: top;`}
            ${dropdownPos.flipUp ? `transform: translateY(-100%);` : ''}
            background: ${theme.mode === 'light'
              ? 'rgba(255, 255, 255, 0.82)'
              : 'rgba(40, 38, 36, 0.88)'};
            backdrop-filter: blur(20px) saturate(1.2);
            -webkit-backdrop-filter: blur(20px) saturate(1.2);
            border: 1px solid ${theme.colors.border.default};
            border-radius: ${theme.borderRadius.default};
            box-shadow: ${theme.shadows.lg};
            overflow: hidden;
          `}
        >
          <div
            ref={listRef}
            role="listbox"
            id={listboxId}
            css={css`
              max-height: ${DROPDOWN_MAX_HEIGHT}px;
              overflow-y: auto;
              padding: ${theme.spacing[1]} 0;

              /* Custom scrollbar */
              &::-webkit-scrollbar { width: 6px; }
              &::-webkit-scrollbar-track { background: transparent; }
              &::-webkit-scrollbar-thumb {
                background: ${theme.colors.border.default};
                border-radius: 3px;
              }
            `}
          >
            {options.map((opt, idx) => {
              const isActive = idx === activeIndex;
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  id={`${listboxId}-opt-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  data-active={isActive}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(opt);
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  css={css`
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: ${theme.spacing[2]} ${theme.spacing[3]};
                    color: ${theme.colors.text.primary};
                    font-size: ${theme.typography.fontSize.sm};
                    cursor: pointer;
                    transition: background ${theme.transitions.micro};
                    background: ${isActive ? theme.colors.background.elevated : 'transparent'};
                    user-select: none;
                  `}
                >
                  <span>{opt.label}</span>
                  {isSelected && (
                    <Check
                      size={14}
                      weight="bold"
                      css={css`
                        color: ${theme.colors.text.secondary};
                        flex-shrink: 0;
                      `}
                    />
                  )}
                </div>
              );
            })}
            {options.length === 0 && (
              <div
                css={css`
                  padding: ${theme.spacing[4]} ${theme.spacing[3]};
                  text-align: center;
                  font-size: ${theme.typography.fontSize.sm};
                  color: ${theme.colors.text.hint};
                `}
              >
                No options
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div
      ref={containerRef}
      css={css`
        position: relative;
        ${maxWidth ? `max-width: ${maxWidth};` : ''}
      `}
    >
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

      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        css={css`
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: ${theme.spacing[2]};
          width: 100%;
          padding: ${theme.spacing[3]};
          background: ${theme.colors.background.paper};
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid ${error ? theme.colors.error.main : isOpen ? theme.colors.border.focus : theme.colors.border.default};
          border-radius: ${theme.borderRadius.default};
          color: ${selectedOption ? theme.colors.text.primary : theme.colors.text.hint};
          font-family: inherit;
          font-size: ${theme.typography.fontSize.base};
          line-height: ${theme.typography.lineHeight.normal};
          text-align: left;
          cursor: ${disabled ? 'not-allowed' : 'pointer'};
          transition: border-color ${theme.transitions.fast};
          outline: none;

          &:focus-visible {
            border-color: ${error ? theme.colors.error.main : theme.colors.border.focus};
          }

          &:disabled {
            opacity: 0.5;
          }
        `}
      >
        <span css={css`
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        `}>
          {selectedOption?.label ?? placeholder}
        </span>
        <CaretDown
          size={14}
          weight="bold"
          css={css`
            color: ${theme.colors.text.hint};
            flex-shrink: 0;
            transition: transform ${theme.transitions.fast};
            ${isOpen ? 'transform: rotate(180deg);' : ''}
          `}
        />
      </button>

      {/* Error / helper text */}
      {error && (
        <span css={css`
          display: block;
          font-size: ${theme.typography.fontSize.xs};
          color: ${theme.colors.error.main};
          margin-top: ${theme.spacing[1.5]};
        `}>
          {error}
        </span>
      )}
      {helperText && !error && (
        <span css={css`
          display: block;
          font-size: ${theme.typography.fontSize.xs};
          color: ${theme.colors.text.hint};
          margin-top: ${theme.spacing[1.5]};
        `}>
          {helperText}
        </span>
      )}

      {/* Dropdown portalled to body to escape overflow clipping */}
      {createPortal(dropdown, document.body)}
    </div>
  );
}
