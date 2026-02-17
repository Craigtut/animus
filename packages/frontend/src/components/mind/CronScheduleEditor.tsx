/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CalendarBlank, X, Plus, WarningCircle } from '@phosphor-icons/react';
import { Input, Typography } from '../ui';
import {
  type Frequency,
  type CronVisualState,
  defaultVisualState,
  generateCron,
  parseCronToVisualState,
  humanizeCron,
  computeNextOccurrence,
  formatNextOccurrence,
} from '../../utils/cron';

// ============================================================================
// Props
// ============================================================================

interface CronScheduleEditorProps {
  value: string;
  onChange: (cron: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

const FREQUENCIES: { key: Frequency; label: string }[] = [
  { key: 'minutes', label: 'Minutes' },
  { key: 'hourly', label: 'Hourly' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MINUTE_PRESETS = [5, 10, 15, 20, 30];
const HOUR_PRESETS = [2, 3, 4, 6, 8, 12];

// ============================================================================
// Schedule Preview
// ============================================================================

function SchedulePreview({ cron }: { cron: string }) {
  const theme = useTheme();
  const text = humanizeCron(cron);
  const isValid = cron.trim().split(/\s+/).length === 5;

  // Compute next occurrence for interval-based schedules
  const [nextOccurrence, setNextOccurrence] = useState<string | null>(null);

  useEffect(() => {
    const compute = () => {
      const next = computeNextOccurrence(cron);
      setNextOccurrence(next ? formatNextOccurrence(next) : null);
    };
    compute();
    const timer = setInterval(compute, 30_000);
    return () => clearInterval(timer);
  }, [cron]);

  return (
    <div css={css`
      display: flex;
      align-items: flex-start;
      gap: ${theme.spacing[2]};
      min-height: 28px;
    `}>
      {isValid ? (
        <CalendarBlank size={14} weight="regular" css={css`
          color: ${theme.colors.text.hint};
          flex-shrink: 0;
          margin-top: 3px;
        `} />
      ) : (
        <WarningCircle size={14} weight="regular" css={css`
          color: ${theme.colors.error.main};
          flex-shrink: 0;
          margin-top: 3px;
        `} />
      )}
      <div>
        <AnimatePresence mode="wait">
          <motion.div
            key={text}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <Typography.Body serif css={css`
              color: ${isValid ? theme.colors.text.primary : theme.colors.error.main};
              line-height: ${theme.typography.lineHeight.snug};
            `}>
              {isValid ? text : 'Invalid schedule'}
            </Typography.Body>
          </motion.div>
        </AnimatePresence>
        {nextOccurrence && (
          <Typography.Caption color="hint" css={css`margin-top: ${theme.spacing[0.5]};`}>
            Next: {nextOccurrence}
          </Typography.Caption>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Frequency Selector
// ============================================================================

function FrequencySelector({ value, onChange }: { value: Frequency; onChange: (f: Frequency) => void }) {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const idx = FREQUENCIES.findIndex(f => f.key === value);
    const buttons = container.querySelectorAll<HTMLButtonElement>('[data-freq]');
    const btn = buttons[idx];
    if (btn) {
      setIndicatorStyle({
        left: btn.offsetLeft,
        width: btn.offsetWidth,
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      css={css`
        position: relative;
        display: flex;
        background: ${theme.colors.background.elevated};
        border: 1px solid ${theme.colors.border.default};
        border-radius: ${theme.borderRadius.default};
        padding: 2px;
        height: 36px;
      `}
    >
      {/* Sliding indicator */}
      <motion.div
        animate={{ left: indicatorStyle.left, width: indicatorStyle.width }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        css={css`
          position: absolute;
          top: 2px;
          bottom: 2px;
          background: ${theme.colors.accent};
          border-radius: calc(${theme.borderRadius.default} - 2px);
          z-index: 0;
          box-shadow: ${theme.shadows.sm};
        `}
      />
      {FREQUENCIES.map(({ key, label }) => (
        <button
          key={key}
          data-freq={key}
          onClick={() => onChange(key)}
          css={css`
            flex: 1;
            position: relative;
            z-index: 1;
            border: none;
            background: none;
            cursor: pointer;
            font-family: ${theme.typography.fontFamily.sans};
            font-size: 13px;
            font-weight: ${theme.typography.fontWeight.medium};
            color: ${value === key ? theme.colors.accentForeground : theme.colors.text.secondary};
            transition: color ${theme.transitions.fast};
            padding: 0 ${theme.spacing[1]};
            white-space: nowrap;

            &:hover {
              color: ${value === key ? theme.colors.accentForeground : theme.colors.text.primary};
            }
          `}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Time Picker
// ============================================================================

function TimePicker({ hour, minute, onChange, label }: {
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
  label?: string;
}) {
  const theme = useTheme();
  const isPM = hour >= 12;
  const display12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;

  const setHour12 = (h12: number, pm: boolean) => {
    let h24 = h12;
    if (pm && h12 !== 12) h24 = h12 + 12;
    if (!pm && h12 === 12) h24 = 0;
    onChange(h24, minute);
  };

  const toggleAmPm = () => {
    setHour12(display12, !isPM);
  };

  return (
    <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
      {label && (
        <Typography.SmallBody color="secondary" css={css`flex-shrink: 0;`}>
          {label}
        </Typography.SmallBody>
      )}
      <div css={css`
        display: flex;
        align-items: center;
        gap: 2px;
        background: ${theme.colors.background.paper};
        border: 1px solid ${theme.colors.border.default};
        border-radius: ${theme.borderRadius.default};
        padding: ${theme.spacing[1]} ${theme.spacing[2]};
      `}>
        <input
          type="number"
          min={1}
          max={12}
          value={display12}
          onChange={(e) => {
            let v = parseInt(e.target.value, 10);
            if (isNaN(v)) v = 12;
            v = Math.max(1, Math.min(12, v));
            setHour12(v, isPM);
          }}
          onFocus={(e) => e.target.select()}
          css={css`
            width: 28px;
            border: none;
            background: none;
            color: ${theme.colors.text.primary};
            font-size: ${theme.typography.fontSize.base};
            font-family: ${theme.typography.fontFamily.sans};
            text-align: center;
            outline: none;
            -moz-appearance: textfield;
            &::-webkit-outer-spin-button,
            &::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
          `}
        />
        <span css={css`color: ${theme.colors.text.primary}; font-size: ${theme.typography.fontSize.base};`}>:</span>
        <input
          type="number"
          min={0}
          max={59}
          value={minute.toString().padStart(2, '0')}
          onChange={(e) => {
            let v = parseInt(e.target.value, 10);
            if (isNaN(v)) v = 0;
            v = Math.max(0, Math.min(59, v));
            onChange(hour, v);
          }}
          onFocus={(e) => e.target.select()}
          css={css`
            width: 28px;
            border: none;
            background: none;
            color: ${theme.colors.text.primary};
            font-size: ${theme.typography.fontSize.base};
            font-family: ${theme.typography.fontFamily.sans};
            text-align: center;
            outline: none;
            -moz-appearance: textfield;
            &::-webkit-outer-spin-button,
            &::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
          `}
        />
        <button
          onClick={toggleAmPm}
          css={css`
            margin-left: ${theme.spacing[1]};
            padding: 2px ${theme.spacing[1.5]};
            border: 1px solid ${theme.colors.border.default};
            border-radius: ${theme.borderRadius.sm};
            background: ${theme.colors.background.elevated};
            color: ${theme.colors.text.secondary};
            font-size: ${theme.typography.fontSize.xs};
            font-weight: ${theme.typography.fontWeight.medium};
            font-family: ${theme.typography.fontFamily.sans};
            cursor: pointer;
            min-width: 36px;
            transition: all ${theme.transitions.fast};
            &:hover { color: ${theme.colors.text.primary}; }
          `}
        >
          {isPM ? 'PM' : 'AM'}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Interval Stepper
// ============================================================================

function IntervalStepper({ value, onChange, min, max, presets, unit }: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  presets: number[];
  unit: string;
}) {
  const theme = useTheme();

  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
        <Typography.SmallBody color="secondary">Every</Typography.SmallBody>
        <div css={css`
          display: flex;
          align-items: center;
          background: ${theme.colors.background.paper};
          border: 1px solid ${theme.colors.border.default};
          border-radius: ${theme.borderRadius.default};
          overflow: hidden;
        `}>
          <button
            onClick={() => onChange(clamp(value - 1))}
            disabled={value <= min}
            css={css`
              padding: ${theme.spacing[1]} ${theme.spacing[2]};
              border: none;
              background: none;
              color: ${value <= min ? theme.colors.text.disabled : theme.colors.text.secondary};
              cursor: ${value <= min ? 'not-allowed' : 'pointer'};
              font-size: ${theme.typography.fontSize.base};
              &:hover:not(:disabled) { background: ${theme.colors.background.elevated}; }
            `}
          >
            -
          </button>
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n)) onChange(clamp(n));
            }}
            onFocus={(e) => e.target.select()}
            css={css`
              width: 40px;
              border: none;
              border-left: 1px solid ${theme.colors.border.default};
              border-right: 1px solid ${theme.colors.border.default};
              background: none;
              color: ${theme.colors.text.primary};
              font-size: ${theme.typography.fontSize.base};
              font-family: ${theme.typography.fontFamily.sans};
              font-weight: ${theme.typography.fontWeight.medium};
              text-align: center;
              outline: none;
              padding: ${theme.spacing[1]} 0;
              -moz-appearance: textfield;
              &::-webkit-outer-spin-button,
              &::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
            `}
          />
          <button
            onClick={() => onChange(clamp(value + 1))}
            disabled={value >= max}
            css={css`
              padding: ${theme.spacing[1]} ${theme.spacing[2]};
              border: none;
              background: none;
              color: ${value >= max ? theme.colors.text.disabled : theme.colors.text.secondary};
              cursor: ${value >= max ? 'not-allowed' : 'pointer'};
              font-size: ${theme.typography.fontSize.base};
              &:hover:not(:disabled) { background: ${theme.colors.background.elevated}; }
            `}
          >
            +
          </button>
        </div>
        <Typography.SmallBody color="secondary">{unit}</Typography.SmallBody>
      </div>

      {/* Preset chips */}
      <div css={css`display: flex; gap: ${theme.spacing[1]}; flex-wrap: wrap;`}>
        {presets.map(p => (
          <button
            key={p}
            onClick={() => onChange(p)}
            css={css`
              padding: 2px ${theme.spacing[2]};
              border-radius: ${theme.borderRadius.full};
              border: 1px solid ${value === p ? theme.colors.accent : theme.colors.border.default};
              background: ${value === p ? theme.colors.accent : 'transparent'};
              color: ${value === p ? theme.colors.accentForeground : theme.colors.text.hint};
              font-size: ${theme.typography.fontSize.xs};
              font-family: ${theme.typography.fontFamily.sans};
              cursor: pointer;
              transition: all ${theme.transitions.fast};
              &:hover {
                border-color: ${theme.colors.text.hint};
                color: ${value === p ? theme.colors.accentForeground : theme.colors.text.secondary};
              }
            `}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Frequency Panels
// ============================================================================

function MinutesPanel({ state, onChange }: { state: CronVisualState; onChange: (s: Partial<CronVisualState>) => void }) {
  return (
    <IntervalStepper
      value={state.minuteInterval}
      onChange={(n) => onChange({ minuteInterval: n })}
      min={1}
      max={59}
      presets={MINUTE_PRESETS}
      unit="minutes"
    />
  );
}

function HourlyPanel({ state, onChange }: { state: CronVisualState; onChange: (s: Partial<CronVisualState>) => void }) {
  const theme = useTheme();
  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
      <IntervalStepper
        value={state.hourInterval}
        onChange={(n) => onChange({ hourInterval: n })}
        min={1}
        max={23}
        presets={HOUR_PRESETS}
        unit="hours"
      />
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
        <Typography.SmallBody color="secondary">at :</Typography.SmallBody>
        <input
          type="number"
          min={0}
          max={59}
          value={state.minuteOffset.toString().padStart(2, '0')}
          onChange={(e) => {
            let v = parseInt(e.target.value, 10);
            if (isNaN(v)) v = 0;
            onChange({ minuteOffset: Math.max(0, Math.min(59, v)) });
          }}
          onFocus={(e) => e.target.select()}
          css={css`
            width: 40px;
            padding: ${theme.spacing[1]} ${theme.spacing[1.5]};
            background: ${theme.colors.background.paper};
            border: 1px solid ${theme.colors.border.default};
            border-radius: ${theme.borderRadius.default};
            color: ${theme.colors.text.primary};
            font-size: ${theme.typography.fontSize.base};
            font-family: ${theme.typography.fontFamily.sans};
            text-align: center;
            outline: none;
            -moz-appearance: textfield;
            &::-webkit-outer-spin-button,
            &::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
            &:focus { border-color: ${theme.colors.border.focus}; }
          `}
        />
        <Typography.Caption color="hint">past the hour</Typography.Caption>
      </div>
    </div>
  );
}

function DailyPanel({ state, onChange }: { state: CronVisualState; onChange: (s: Partial<CronVisualState>) => void }) {
  return (
    <TimePicker
      hour={state.time.hour}
      minute={state.time.minute}
      onChange={(hour, minute) => onChange({ time: { hour, minute } })}
      label="Every day at"
    />
  );
}

function WeeklyPanel({ state, onChange }: { state: CronVisualState; onChange: (s: Partial<CronVisualState>) => void }) {
  const theme = useTheme();
  const selectedCount = state.weekdays.filter(Boolean).length;

  const toggleDay = (idx: number) => {
    const next = [...state.weekdays];
    // Don't allow deselecting the last day
    if (next[idx] && selectedCount <= 1) return;
    next[idx] = !next[idx];
    onChange({ weekdays: next });
  };

  const setPreset = (days: boolean[]) => onChange({ weekdays: days });
  const isWeekdays = state.weekdays.every((on, i) => (i >= 1 && i <= 5) ? on : !on);
  const isAllDays = state.weekdays.every(Boolean);

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
      {/* Day toggles */}
      <div css={css`display: flex; gap: ${theme.spacing[1.5]};`}>
        {DAY_LETTERS.map((letter, idx) => (
          <button
            key={idx}
            title={DAY_FULL[idx]}
            onClick={() => toggleDay(idx)}
            css={css`
              width: 34px;
              height: 34px;
              border-radius: ${theme.borderRadius.full};
              border: 1px solid ${state.weekdays[idx] ? 'transparent' : theme.colors.border.default};
              background: ${state.weekdays[idx] ? theme.colors.accent : 'transparent'};
              color: ${state.weekdays[idx] ? theme.colors.accentForeground : theme.colors.text.hint};
              font-size: ${theme.typography.fontSize.sm};
              font-weight: ${theme.typography.fontWeight.medium};
              font-family: ${theme.typography.fontFamily.sans};
              cursor: pointer;
              transition: all ${theme.transitions.micro};
              &:hover {
                border-color: ${state.weekdays[idx] ? 'transparent' : theme.colors.text.hint};
                transform: scale(1.05);
              }
            `}
          >
            {letter}
          </button>
        ))}
      </div>

      {/* Shortcut chips */}
      {!isWeekdays && !isAllDays && (
        <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
          <button
            onClick={() => setPreset([false, true, true, true, true, true, false])}
            css={css`
              font-size: ${theme.typography.fontSize.xs};
              color: ${theme.colors.text.hint};
              cursor: pointer;
              border: none;
              background: none;
              padding: 0;
              font-family: ${theme.typography.fontFamily.sans};
              &:hover { color: ${theme.colors.text.secondary}; }
            `}
          >
            Weekdays
          </button>
          <button
            onClick={() => setPreset([true, true, true, true, true, true, true])}
            css={css`
              font-size: ${theme.typography.fontSize.xs};
              color: ${theme.colors.text.hint};
              cursor: pointer;
              border: none;
              background: none;
              padding: 0;
              font-family: ${theme.typography.fontFamily.sans};
              &:hover { color: ${theme.colors.text.secondary}; }
            `}
          >
            Every day
          </button>
        </div>
      )}

      <TimePicker
        hour={state.time.hour}
        minute={state.time.minute}
        onChange={(hour, minute) => onChange({ time: { hour, minute } })}
        label="at"
      />
    </div>
  );
}

function MonthlyPanel({ state, onChange }: { state: CronVisualState; onChange: (s: Partial<CronVisualState>) => void }) {
  const theme = useTheme();
  const [gridOpen, setGridOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Close grid on click outside
  useEffect(() => {
    if (!gridOpen) return;
    const handler = (e: MouseEvent) => {
      if (gridRef.current && !gridRef.current.contains(e.target as Node)) {
        setGridOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [gridOpen]);

  const toggleMonthDay = (day: number) => {
    const next = state.monthDays.includes(day)
      ? state.monthDays.filter(d => d !== day)
      : [...state.monthDays, day].sort((a, b) => a - b);
    // Don't allow empty
    if (next.length === 0) return;
    onChange({ monthDays: next });
  };

  const removeMonthDay = (day: number) => {
    if (state.monthDays.length <= 1) return;
    onChange({ monthDays: state.monthDays.filter(d => d !== day) });
  };

  const ordinal = (n: number) => {
    if (n >= 11 && n <= 13) return `${n}th`;
    const last = n % 10;
    if (last === 1) return `${n}st`;
    if (last === 2) return `${n}nd`;
    if (last === 3) return `${n}rd`;
    return `${n}th`;
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
      <div>
        <Typography.SmallBody color="secondary" css={css`margin-bottom: ${theme.spacing[2]};`}>
          On day(s)
        </Typography.SmallBody>
        <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[1.5]}; align-items: center;`}>
          {state.monthDays.map(day => (
            <span
              key={day}
              css={css`
                display: inline-flex;
                align-items: center;
                gap: ${theme.spacing[1]};
                padding: 2px ${theme.spacing[2]};
                border-radius: ${theme.borderRadius.sm};
                background: ${theme.colors.accent};
                color: ${theme.colors.accentForeground};
                font-size: ${theme.typography.fontSize.xs};
                font-weight: ${theme.typography.fontWeight.medium};
                font-family: ${theme.typography.fontFamily.sans};
              `}
            >
              {ordinal(day)}
              {state.monthDays.length > 1 && (
                <button
                  onClick={() => removeMonthDay(day)}
                  css={css`
                    border: none;
                    background: none;
                    padding: 0;
                    cursor: pointer;
                    color: ${theme.colors.accentForeground};
                    opacity: 0.6;
                    display: flex;
                    &:hover { opacity: 1; }
                  `}
                >
                  <X size={10} weight="bold" />
                </button>
              )}
            </span>
          ))}

          {/* Add day button + grid */}
          <div css={css`position: relative;`} ref={gridRef}>
            <button
              onClick={() => setGridOpen(!gridOpen)}
              css={css`
                display: inline-flex;
                align-items: center;
                gap: ${theme.spacing[1]};
                padding: 2px ${theme.spacing[2]};
                border-radius: ${theme.borderRadius.sm};
                border: 1px dashed ${theme.colors.border.default};
                background: none;
                color: ${theme.colors.text.hint};
                font-size: ${theme.typography.fontSize.xs};
                font-family: ${theme.typography.fontFamily.sans};
                cursor: pointer;
                transition: all ${theme.transitions.fast};
                &:hover {
                  border-color: ${theme.colors.text.hint};
                  color: ${theme.colors.text.secondary};
                }
              `}
            >
              <Plus size={10} weight="bold" /> Add day
            </button>

            {/* Day grid popover */}
            <AnimatePresence>
              {gridOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  css={css`
                    position: absolute;
                    top: calc(100% + 4px);
                    left: 0;
                    z-index: ${theme.zIndex.popover};
                    background: ${theme.mode === 'dark' ? '#2a2826' : '#fff'};
                    border: 1px solid ${theme.colors.border.default};
                    border-radius: ${theme.borderRadius.md};
                    padding: ${theme.spacing[2]};
                    display: grid;
                    grid-template-columns: repeat(7, 32px);
                    gap: 2px;
                    box-shadow: ${theme.shadows.lg};
                  `}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                    <button
                      key={day}
                      onClick={() => toggleMonthDay(day)}
                      css={css`
                        width: 32px;
                        height: 32px;
                        border: none;
                        border-radius: ${theme.borderRadius.sm};
                        background: ${state.monthDays.includes(day) ? theme.colors.accent : 'transparent'};
                        color: ${state.monthDays.includes(day) ? theme.colors.accentForeground : theme.colors.text.secondary};
                        font-size: ${theme.typography.fontSize.xs};
                        font-family: ${theme.typography.fontFamily.sans};
                        cursor: pointer;
                        transition: all ${theme.transitions.micro};
                        &:hover {
                          background: ${state.monthDays.includes(day) ? theme.colors.accent : theme.colors.background.elevated};
                        }
                      `}
                    >
                      {day}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        {state.monthDays.some(d => d >= 29) && (
          <Typography.Caption color="hint" css={css`margin-top: ${theme.spacing[1.5]}; font-size: 11px;`}>
            Skipped in shorter months
          </Typography.Caption>
        )}
      </div>

      <TimePicker
        hour={state.time.hour}
        minute={state.time.minute}
        onChange={(hour, minute) => onChange({ time: { hour, minute } })}
        label="at"
      />
    </div>
  );
}

// ============================================================================
// Month Filter
// ============================================================================

function MonthFilter({ months, onChange }: { months: number[]; onChange: (months: number[]) => void }) {
  const theme = useTheme();
  const active = months.length > 0;

  const toggleActive = () => {
    if (active) {
      onChange([]);
    } else {
      // Default to current month
      onChange([new Date().getMonth() + 1]);
    }
  };

  const toggleMonth = (m: number) => {
    if (months.includes(m)) {
      const next = months.filter(x => x !== m);
      if (next.length === 0) return; // at least one
      onChange(next);
    } else {
      onChange([...months, m].sort((a, b) => a - b));
    }
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
      <label css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        cursor: pointer;
        font-size: ${theme.typography.fontSize.xs};
        color: ${theme.colors.text.hint};
        font-family: ${theme.typography.fontFamily.sans};
      `}>
        <input
          type="checkbox"
          checked={active}
          onChange={toggleActive}
          css={css`accent-color: ${theme.colors.accent};`}
        />
        Only run in specific months
      </label>

      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            css={css`overflow: hidden;`}
          >
            <div css={css`
              display: grid;
              grid-template-columns: repeat(6, 1fr);
              gap: ${theme.spacing[1]};
            `}>
              {MONTH_ABBR.map((label, idx) => {
                const m = idx + 1;
                const selected = months.includes(m);
                return (
                  <button
                    key={m}
                    onClick={() => toggleMonth(m)}
                    css={css`
                      padding: ${theme.spacing[1]} 0;
                      border-radius: ${theme.borderRadius.sm};
                      border: 1px solid ${selected ? 'transparent' : theme.colors.border.default};
                      background: ${selected ? theme.colors.accent : 'transparent'};
                      color: ${selected ? theme.colors.accentForeground : theme.colors.text.hint};
                      font-size: ${theme.typography.fontSize.xs};
                      font-family: ${theme.typography.fontFamily.sans};
                      font-weight: ${theme.typography.fontWeight.medium};
                      cursor: pointer;
                      transition: all ${theme.transitions.micro};
                      &:hover {
                        border-color: ${selected ? 'transparent' : theme.colors.text.hint};
                      }
                    `}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// CronScheduleEditor (Root)
// ============================================================================

export function CronScheduleEditor({ value, onChange }: CronScheduleEditorProps) {
  const theme = useTheme();
  const [mode, setMode] = useState<'visual' | 'raw'>('visual');
  const [state, setState] = useState<CronVisualState>(() => {
    const parsed = parseCronToVisualState(value);
    return parsed ?? defaultVisualState();
  });
  const [rawValue, setRawValue] = useState(value);

  // On mount or value change from outside, try to parse into visual state
  const lastExternalValue = useRef(value);
  useEffect(() => {
    if (value === lastExternalValue.current) return;
    lastExternalValue.current = value;

    const parsed = parseCronToVisualState(value);
    if (parsed) {
      setState(parsed);
      setMode('visual');
    } else {
      setRawValue(value);
      setMode('raw');
    }
  }, [value]);

  // Generate cron from visual state and emit changes
  const updateState = useCallback((partial: Partial<CronVisualState>) => {
    setState(prev => {
      const next = { ...prev, ...partial };
      const cron = generateCron(next);
      lastExternalValue.current = cron;
      onChange(cron);
      return next;
    });
  }, [onChange]);

  // Initialize: if value is empty, emit the default cron
  useEffect(() => {
    if (!value && mode === 'visual') {
      const cron = generateCron(state);
      lastExternalValue.current = cron;
      onChange(cron);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFrequencyChange = (frequency: Frequency) => {
    updateState({ frequency });
  };

  const handleRawChange = (raw: string) => {
    setRawValue(raw);
    lastExternalValue.current = raw;
    onChange(raw);
  };

  const switchToRaw = () => {
    setRawValue(generateCron(state));
    setMode('raw');
  };

  const switchToVisual = () => {
    const parsed = parseCronToVisualState(rawValue);
    if (parsed) {
      setState(parsed);
      setMode('visual');
    }
    // If not parseable, stay in raw mode (button is disabled)
  };

  const canSwitchToVisual = useMemo(() => {
    if (mode !== 'raw') return true;
    return parseCronToVisualState(rawValue) !== null;
  }, [mode, rawValue]);

  const currentCron = mode === 'visual' ? generateCron(state) : rawValue;

  const FreqPanel = {
    minutes: MinutesPanel,
    hourly: HourlyPanel,
    daily: DailyPanel,
    weekly: WeeklyPanel,
    monthly: MonthlyPanel,
  }[state.frequency];

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
      {/* Section label */}
      <label css={css`
        font-size: ${theme.typography.fontSize.sm};
        font-weight: ${theme.typography.fontWeight.medium};
        color: ${theme.colors.text.secondary};
      `}>
        Schedule
      </label>

      {/* Preview */}
      <SchedulePreview cron={currentCron} />

      <AnimatePresence mode="wait">
        {mode === 'visual' ? (
          <motion.div
            key="visual"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}
          >
            {/* Frequency selector */}
            <FrequencySelector value={state.frequency} onChange={handleFrequencyChange} />

            {/* Frequency-specific panel */}
            <AnimatePresence mode="wait">
              <motion.div
                key={state.frequency}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                css={css`overflow: hidden;`}
              >
                <FreqPanel state={state} onChange={updateState} />
              </motion.div>
            </AnimatePresence>

            {/* Month filter */}
            <MonthFilter months={state.months} onChange={(months) => updateState({ months })} />

            {/* Advanced toggle */}
            <div css={css`display: flex; justify-content: flex-end;`}>
              <button
                onClick={switchToRaw}
                css={css`
                  font-size: ${theme.typography.fontSize.xs};
                  color: ${theme.colors.text.hint};
                  border: none;
                  background: none;
                  cursor: pointer;
                  padding: 0;
                  font-family: ${theme.typography.fontFamily.sans};
                  &:hover { color: ${theme.colors.text.secondary}; }
                `}
              >
                Edit as expression
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="raw"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}
          >
            <Input
              value={rawValue}
              onChange={(e) => handleRawChange((e.target as HTMLInputElement).value)}
              placeholder="e.g. 0 9 * * 1-5"
              css={css`font-family: ${theme.typography.fontFamily.mono};`}
            />

            <div css={css`display: flex; justify-content: flex-end;`}>
              <button
                onClick={switchToVisual}
                disabled={!canSwitchToVisual}
                css={css`
                  font-size: ${theme.typography.fontSize.xs};
                  color: ${canSwitchToVisual ? theme.colors.text.hint : theme.colors.text.disabled};
                  border: none;
                  background: none;
                  cursor: ${canSwitchToVisual ? 'pointer' : 'not-allowed'};
                  padding: 0;
                  font-family: ${theme.typography.fontFamily.sans};
                  &:hover { color: ${canSwitchToVisual ? theme.colors.text.secondary : theme.colors.text.disabled}; }
                `}
              >
                Use visual editor
              </button>
            </div>
            {!canSwitchToVisual && rawValue.trim().split(/\s+/).length === 5 && (
              <Typography.Caption color="hint" css={css`font-size: 11px;`}>
                This expression is too complex for the visual editor
              </Typography.Caption>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
