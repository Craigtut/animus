/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Input } from './Input';

interface CityResult {
  city: string;
  city_ascii: string;
  province: string;
  country: string;
  timezone: string;
  pop: number;
}

export interface CityAutocompleteProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onTimezoneDetected?: (timezone: string) => void;
  placeholder?: string;
  helperText?: string;
  error?: string;
}

// Lazy-loaded city-timezones to avoid blocking initial render
let findFromCityStateProvince: ((searchString: string) => CityResult[]) | null = null;
let loadPromise: Promise<void> | null = null;

function ensureLoaded(): Promise<void> {
  if (findFromCityStateProvince) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = import('city-timezones').then((mod) => {
      findFromCityStateProvince = mod.findFromCityStateProvince;
    });
  }
  return loadPromise;
}

export function CityAutocomplete({
  label,
  value,
  onChange,
  onTimezoneDetected,
  placeholder,
  helperText,
  error,
}: CityAutocompleteProps) {
  const theme = useTheme();
  const [suggestions, setSuggestions] = useState<CityResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loaded, setLoaded] = useState(!!findFromCityStateProvince);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Eagerly start loading
  useEffect(() => {
    ensureLoaded().then(() => setLoaded(true));
  }, []);

  const search = useCallback(
    (query: string) => {
      if (!findFromCityStateProvince || query.length < 3) {
        setSuggestions([]);
        setIsOpen(false);
        return;
      }
      const results = findFromCityStateProvince(query);
      // Sort by population descending, take top 8
      const sorted = results
        .filter((r) => r.timezone)
        .sort((a, b) => (b.pop || 0) - (a.pop || 0))
        .slice(0, 8);
      setSuggestions(sorted);
      setIsOpen(sorted.length > 0);
      setActiveIndex(0);
    },
    [loaded] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    search(val);
  };

  const selectCity = (city: CityResult) => {
    const display = [city.city, city.province, city.country].filter(Boolean).join(', ');
    onChange(display);
    if (city.timezone && onTimezoneDetected) {
      onTimezoneDetected(city.timezone);
    }
    setIsOpen(false);
    setSuggestions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && suggestions[activeIndex]) {
      e.preventDefault();
      selectCity(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} css={css`position: relative;`}>
      <Input
        ref={inputRef as React.Ref<HTMLInputElement>}
        label={label}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Delay so click on suggestion can fire first
          setTimeout(() => setIsOpen(false), 150);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setIsOpen(true);
        }}
        placeholder={placeholder}
        helperText={helperText}
        error={error}
        autoComplete="off"
      />

      <AnimatePresence>
        {isOpen && suggestions.length > 0 && (
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
              max-height: 320px;
              overflow-y: auto;
            `}
          >
            {suggestions.map((city, i) => {
              const display = [city.city, city.province, city.country].filter(Boolean).join(', ');
              const isActive = i === activeIndex;
              return (
                <button
                  key={`${city.city_ascii}-${city.province}-${city.country}-${i}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectCity(city);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  css={css`
                    display: block;
                    width: 100%;
                    text-align: left;
                    padding: ${theme.spacing[3]} ${theme.spacing[3]};
                    background: ${isActive ? theme.colors.background.elevated : 'transparent'};
                    color: ${theme.colors.text.primary};
                    font-size: ${theme.typography.fontSize.sm};
                    line-height: ${theme.typography.lineHeight.normal};
                    border: none;
                    cursor: pointer;
                    transition: background ${theme.transitions.micro};
                  `}
                >
                  {display}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
