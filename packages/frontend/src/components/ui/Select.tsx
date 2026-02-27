/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useRef, useEffect, useCallback, useId } from 'react';
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

  const selectedOption = options.find((o) => o.value === value);

  // Reset active index when opening
  useEffect(() => {
    if (isOpen) {
      const idx = options.findIndex((o) => o.value === value);
      setActiveIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen, options, value]);

  // Scroll active item into view
  useEffect(() => {
    if (!isOpen || !listRef.current || activeIndex < 0) return;
    const active = listRef.current.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
          setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
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
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (isOpen) {
          e.preventDefault();
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

      {/* Dropdown panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            css={css`
              position: absolute;
              top: 100%;
              left: 0;
              right: 0;
              z-index: ${theme.zIndex.dropdown};
              margin-top: ${theme.spacing[1]};
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
                max-height: 240px;
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
    </div>
  );
}
