/**
 * Theme Tests
 *
 * Validates that the theme objects are structurally correct and
 * conform to the design spec (warm neutrals, Plus Jakarta Sans, etc.)
 */

import { describe, it, expect } from 'vitest';
import { lightTheme, darkTheme, emotionColors } from '../src/styles/theme.js';

describe('Theme Structure', () => {
  const themes = [
    { name: 'light', theme: lightTheme },
    { name: 'dark', theme: darkTheme },
  ];

  for (const { name, theme } of themes) {
    describe(`${name} theme`, () => {
      it('has correct mode', () => {
        expect(theme.mode).toBe(name);
      });

      it('has all color categories', () => {
        expect(theme.colors.background).toBeDefined();
        expect(theme.colors.text).toBeDefined();
        expect(theme.colors.border).toBeDefined();
        expect(theme.colors.accent).toBeDefined();
        expect(theme.colors.accentForeground).toBeDefined();
        expect(theme.colors.success).toBeDefined();
        expect(theme.colors.warning).toBeDefined();
        expect(theme.colors.error).toBeDefined();
        expect(theme.colors.info).toBeDefined();
      });

      it('has background surface hierarchy', () => {
        expect(theme.colors.background.default).toBeTruthy();
        expect(theme.colors.background.paper).toBeTruthy();
        expect(theme.colors.background.elevated).toBeTruthy();
      });

      it('has text hierarchy', () => {
        expect(theme.colors.text.primary).toBeTruthy();
        expect(theme.colors.text.secondary).toBeTruthy();
        expect(theme.colors.text.disabled).toBeTruthy();
        expect(theme.colors.text.hint).toBeTruthy();
      });

      it('has typography with Plus Jakarta Sans', () => {
        expect(theme.typography.fontFamily.sans).toContain('Plus Jakarta Sans');
      });

      it('has all font sizes', () => {
        const sizes = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'] as const;
        for (const size of sizes) {
          expect(theme.typography.fontSize[size]).toBeTruthy();
        }
      });

      it('has all font weights', () => {
        expect(theme.typography.fontWeight.light).toBe(300);
        expect(theme.typography.fontWeight.normal).toBe(400);
        expect(theme.typography.fontWeight.medium).toBe(500);
        expect(theme.typography.fontWeight.semibold).toBe(600);
        expect(theme.typography.fontWeight.bold).toBe(700);
      });

      it('has spacing scale', () => {
        expect(theme.spacing[0]).toBe('0');
        expect(theme.spacing[1]).toBeTruthy();
        expect(theme.spacing[2]).toBeTruthy();
        expect(theme.spacing[4]).toBeTruthy();
        expect(theme.spacing[8]).toBeTruthy();
      });

      it('has border radius scale', () => {
        expect(theme.borderRadius.none).toBe('0');
        expect(theme.borderRadius.sm).toBeTruthy();
        expect(theme.borderRadius.default).toBeTruthy();
        expect(theme.borderRadius.md).toBeTruthy();
        expect(theme.borderRadius.lg).toBeTruthy();
        expect(theme.borderRadius.xl).toBeTruthy();
        expect(theme.borderRadius.full).toBe('9999px');
      });

      it('has z-index layers', () => {
        expect(theme.zIndex.base).toBe(0);
        expect(theme.zIndex.modal).toBeGreaterThan(theme.zIndex.dropdown);
        expect(theme.zIndex.commandPalette).toBeGreaterThan(theme.zIndex.navPill);
      });
    });
  }
});

describe('Light Theme Design Spec Compliance', () => {
  it('uses warm white canvas', () => {
    expect(lightTheme.colors.background.default).toBe('#FAF9F4');
  });

  it('uses near-black accent', () => {
    expect(lightTheme.colors.accent).toBe('#1A1816');
  });

  it('has warm accent foreground', () => {
    expect(lightTheme.colors.accentForeground).toBe('#FAF9F4');
  });
});

describe('Dark Theme Design Spec Compliance', () => {
  it('uses warm dark canvas', () => {
    expect(darkTheme.colors.background.default).toBe('#1C1A18');
  });

  it('uses warm white accent', () => {
    expect(darkTheme.colors.accent).toBe('#FAF9F4');
  });

  it('has dark accent foreground', () => {
    expect(darkTheme.colors.accentForeground).toBe('#1C1A18');
  });
});

describe('Emotion Colors', () => {
  const allEmotions = [
    'joy', 'contentment', 'excitement', 'gratitude', 'confidence',
    'stress', 'anxiety', 'frustration', 'sadness', 'boredom',
    'curiosity', 'loneliness',
  ] as const;

  it('has all 12 emotions in light mode', () => {
    for (const emotion of allEmotions) {
      expect(emotionColors.light[emotion]).toBeTruthy();
    }
  });

  it('has all 12 emotions in dark mode', () => {
    for (const emotion of allEmotions) {
      expect(emotionColors.dark[emotion]).toBeTruthy();
    }
  });

  it('uses HSL color format', () => {
    for (const emotion of allEmotions) {
      expect(emotionColors.light[emotion]).toMatch(/^hsl\(/);
      expect(emotionColors.dark[emotion]).toMatch(/^hsl\(/);
    }
  });
});
