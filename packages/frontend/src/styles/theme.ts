/**
 * Animus Theme
 *
 * Design-spec aligned theme with warm neutrals, Plus Jakarta Sans,
 * gradient rim lighting, and dual-mode support (light default).
 *
 * See docs/frontend/design-principles.md and docs/brand-vision.md.
 */

// --------------------------------------------------------------------------
// Light Mode (default)
// --------------------------------------------------------------------------
const lightColors = {
  // Canvas & surfaces
  background: {
    default: '#FAF9F4',       // warm white canvas
    paper: '#F5F4EE',         // slightly darker warm surface (cards)
    elevated: '#EFEDE6',      // elevated surfaces
  },

  // Text
  text: {
    primary: '#1A1816',       // near-black, warm
    secondary: 'rgba(26, 24, 22, 0.55)',
    disabled: 'rgba(26, 24, 22, 0.35)',
    hint: 'rgba(26, 24, 22, 0.45)',
  },

  // Borders — rim-lighting gradients defined per component
  border: {
    default: 'rgba(26, 24, 22, 0.10)',
    light: 'rgba(26, 24, 22, 0.06)',
    focus: 'rgba(26, 24, 22, 0.25)',
  },

  // High-contrast accent (near-black in light mode)
  accent: '#1A1816',
  accentForeground: '#FAF9F4',

  // Rim-lighting gradient (from subtle dark to transparent)
  rimGradient: 'linear-gradient(180deg, rgba(26, 24, 22, 0.08) 0%, transparent 100%)',

  // Semantic
  success: { light: '#86efac', main: '#16a34a', dark: '#15803d' },
  warning: { light: '#fcd34d', main: '#d97706', dark: '#b45309' },
  error:   { light: '#fca5a5', main: '#dc2626', dark: '#b91c1c' },
  info:    { light: '#a5b4fc', main: '#4f46e5', dark: '#4338ca' },
};

// --------------------------------------------------------------------------
// Dark Mode
// --------------------------------------------------------------------------
const darkColors = {
  background: {
    default: '#1C1A18',       // warm dark canvas
    paper: '#242220',         // warm dark surface
    elevated: '#2E2C29',      // elevated
  },

  text: {
    primary: '#FAF9F4',
    secondary: 'rgba(250, 249, 244, 0.55)',
    disabled: 'rgba(250, 249, 244, 0.35)',
    hint: 'rgba(250, 249, 244, 0.45)',
  },

  border: {
    default: 'rgba(250, 249, 244, 0.10)',
    light: 'rgba(250, 249, 244, 0.06)',
    focus: 'rgba(250, 249, 244, 0.25)',
  },

  accent: '#FAF9F4',
  accentForeground: '#1C1A18',

  rimGradient: 'linear-gradient(180deg, rgba(250, 249, 244, 0.10) 0%, transparent 100%)',

  success: { light: '#86efac', main: '#22c55e', dark: '#15803d' },
  warning: { light: '#fcd34d', main: '#f59e0b', dark: '#b45309' },
  error:   { light: '#fca5a5', main: '#ef4444', dark: '#b91c1c' },
  info:    { light: '#a5b4fc', main: '#6366f1', dark: '#4f46e5' },
};

// --------------------------------------------------------------------------
// Emotion Color Palette (shared across both modes)
// --------------------------------------------------------------------------
export const emotionColors = {
  light: {
    joy:          'hsl(38, 65%, 72%)',
    contentment:  'hsl(25, 55%, 78%)',
    excitement:   'hsl(15, 60%, 70%)',
    gratitude:    'hsl(42, 50%, 76%)',
    confidence:   'hsl(35, 70%, 68%)',
    stress:       'hsl(220, 20%, 68%)',
    anxiety:      'hsl(260, 18%, 72%)',
    frustration:  'hsl(5, 25%, 65%)',
    sadness:      'hsl(210, 15%, 70%)',
    boredom:      'hsl(30, 8%, 72%)',
    curiosity:    'hsl(175, 35%, 62%)',
    loneliness:   'hsl(280, 25%, 65%)',
  },
  dark: {
    joy:          'hsl(38, 55%, 45%)',
    contentment:  'hsl(25, 45%, 42%)',
    excitement:   'hsl(15, 50%, 40%)',
    gratitude:    'hsl(42, 40%, 40%)',
    confidence:   'hsl(35, 60%, 38%)',
    stress:       'hsl(220, 25%, 35%)',
    anxiety:      'hsl(260, 22%, 38%)',
    frustration:  'hsl(5, 30%, 35%)',
    sadness:      'hsl(210, 20%, 32%)',
    boredom:      'hsl(30, 10%, 35%)',
    curiosity:    'hsl(175, 40%, 35%)',
    loneliness:   'hsl(280, 30%, 32%)',
  },
} as const;

// --------------------------------------------------------------------------
// Shared design tokens
// --------------------------------------------------------------------------
const shared = {
  typography: {
    fontFamily: {
      sans: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      mono: '"JetBrains Mono", "Fira Code", Consolas, monospace',
    },
    fontSize: {
      xs: '0.75rem',     // 12px
      sm: '0.875rem',    // 14px
      base: '1rem',      // 16px
      lg: '1.125rem',    // 18px
      xl: '1.25rem',     // 20px
      '2xl': '1.5rem',   // 24px
      '3xl': '1.875rem', // 30px
      '4xl': '2.25rem',  // 36px
      '5xl': '3rem',     // 48px
    },
    fontWeight: {
      light: 300,
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeight: {
      tight: 1.25,
      snug: 1.375,
      normal: 1.5,
      relaxed: 1.75,
    },
  },

  spacing: {
    0: '0',
    0.5: '0.125rem',  // 2px
    1: '0.25rem',     // 4px
    1.5: '0.375rem',  // 6px
    2: '0.5rem',      // 8px
    3: '0.75rem',     // 12px
    4: '1rem',        // 16px
    5: '1.25rem',     // 20px
    6: '1.5rem',      // 24px
    8: '2rem',        // 32px
    10: '2.5rem',     // 40px
    12: '3rem',       // 48px
    16: '4rem',       // 64px
    20: '5rem',       // 80px
    24: '6rem',       // 96px
  },

  borderRadius: {
    none: '0',
    sm: '0.375rem',    // 6px  — small elements (chips, badges)
    default: '0.5rem', // 8px  — buttons, inputs
    md: '0.75rem',     // 12px — cards
    lg: '1rem',        // 16px — larger cards
    xl: '1.5rem',      // 24px — modals, major containers
    full: '9999px',    //        pills, avatars
  },

  shadows: {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
    default: '0 1px 3px 0 rgb(0 0 0 / 0.06)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.06)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.06)',
  },

  transitions: {
    micro: '100ms ease-out',    // micro-interactions
    fast: '150ms ease-out',     // hover, focus
    normal: '250ms ease-out',   // standard transitions
    slow: '400ms ease-out',     // page transitions
    ambient: '2000ms ease-in-out', // ambient breathing
  },

  breakpoints: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
  },

  zIndex: {
    base: 0,
    dropdown: 1000,
    sticky: 1020,
    fixed: 1030,
    modalBackdrop: 1040,
    modal: 1050,
    popover: 1060,
    tooltip: 1070,
    navPill: 1080,
    commandPalette: 1090,
  },
} as const;

// --------------------------------------------------------------------------
// Composed themes
// --------------------------------------------------------------------------
type Colors = typeof lightColors;

interface AnimusTheme {
  colors: Colors;
  typography: typeof shared.typography;
  spacing: typeof shared.spacing;
  borderRadius: typeof shared.borderRadius;
  shadows: typeof shared.shadows;
  transitions: typeof shared.transitions;
  breakpoints: typeof shared.breakpoints;
  zIndex: typeof shared.zIndex;
  mode: 'light' | 'dark';
}

export const lightTheme: AnimusTheme = { colors: lightColors, ...shared, mode: 'light' };
export const darkTheme: AnimusTheme  = { colors: darkColors as Colors, ...shared, mode: 'dark' };

// Default export (light is default as per spec)
export const theme = lightTheme;

export type Theme = AnimusTheme;

// Extend Emotion's theme type
declare module '@emotion/react' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  export interface Theme extends AnimusTheme {}
}
