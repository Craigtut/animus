/** @jsxImportSource @emotion/react */
import { createElement, forwardRef } from 'react';
import type { ElementType, ComponentPropsWithRef, ReactNode } from 'react';
import { useTheme } from '@emotion/react';
import type { Theme } from '../../styles/theme';

// ---------------------------------------------------------------------------
// Variant definitions
// ---------------------------------------------------------------------------

interface VariantStyle {
  fontSize: string;
  fontWeight: number;
  lineHeight: number;
  defaultAs: ElementType;
}

const variants = {
  title:        { fontSize: '2rem',    fontWeight: 400, lineHeight: 1.25,  defaultAs: 'h1' },
  title2:       { fontSize: '1.75rem', fontWeight: 400, lineHeight: 1.25,  defaultAs: 'h2' },
  title3:       { fontSize: '1.5rem',  fontWeight: 500, lineHeight: 1.375, defaultAs: 'h3' },
  subtitle:     { fontSize: '1.25rem', fontWeight: 500, lineHeight: 1.375, defaultAs: 'h4' },
  body:         { fontSize: '1rem',    fontWeight: 400, lineHeight: 1.5,   defaultAs: 'p'    },
  bodyAlt:      { fontSize: '1rem',    fontWeight: 500, lineHeight: 1.5,   defaultAs: 'p'    },
  smallBody:    { fontSize: '0.875rem',fontWeight: 400, lineHeight: 1.5,   defaultAs: 'p'    },
  smallBodyAlt: { fontSize: '0.875rem',fontWeight: 500, lineHeight: 1.5,   defaultAs: 'p'    },
  caption:      { fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.5,   defaultAs: 'span' },
  tiny:         { fontSize: '0.625rem',fontWeight: 400, lineHeight: 1.5,   defaultAs: 'span' },
} as const satisfies Record<string, VariantStyle>;

type Variant = keyof typeof variants;

// ---------------------------------------------------------------------------
// Shared props
// ---------------------------------------------------------------------------

type ColorKey = 'primary' | 'secondary' | 'disabled' | 'hint';

interface TypographyOwnProps {
  /** Override the rendered HTML element */
  as?: ElementType;
  /** Use Crimson Pro (serif) font */
  serif?: boolean;
  /** Italic style */
  italic?: boolean;
  /** Theme text color key or raw CSS color string */
  color?: ColorKey | (string & {});
  children?: ReactNode;
}

// ---------------------------------------------------------------------------
// Resolve color helper
// ---------------------------------------------------------------------------

function resolveColor(color: string | undefined, theme: Theme): string | undefined {
  if (!color) return undefined;
  const themeColors = theme.colors.text as Record<string, string>;
  if (color in themeColors) return themeColors[color];
  return color; // raw CSS value
}

// ---------------------------------------------------------------------------
// Base component factory
// ---------------------------------------------------------------------------

function createVariant(variant: Variant) {
  const v = variants[variant];

  const Component = forwardRef<HTMLElement, TypographyOwnProps & Record<string, unknown>>(
    ({ as, serif, italic, color, children, ...rest }, ref) => {
      const theme = useTheme();
      const Tag = (as ?? v.defaultAs) as string;
      const resolvedColor = resolveColor(color as string | undefined, theme);

      return createElement(
        Tag as any,
        {
          ref,
          css: {
            fontSize: v.fontSize,
            fontWeight: v.fontWeight,
            lineHeight: v.lineHeight,
            fontFamily: serif ? theme.typography.fontFamily.serif : undefined,
            fontStyle: italic ? ('italic' as const) : undefined,
            color: resolvedColor,
            margin: 0,
          },
          ...rest,
        },
        children as ReactNode,
      );
    },
  );

  Component.displayName = `Typography.${variant.charAt(0).toUpperCase() + variant.slice(1)}`;
  return Component;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

export const Title        = createVariant('title');
export const Title2       = createVariant('title2');
export const Title3       = createVariant('title3');
export const Subtitle     = createVariant('subtitle');
export const Body         = createVariant('body');
export const BodyAlt      = createVariant('bodyAlt');
export const SmallBody    = createVariant('smallBody');
export const SmallBodyAlt = createVariant('smallBodyAlt');
export const Caption      = createVariant('caption');
export const Tiny         = createVariant('tiny');

// ---------------------------------------------------------------------------
// Namespace export
// ---------------------------------------------------------------------------

export const Typography = {
  Title,
  Title2,
  Title3,
  Subtitle,
  Body,
  BodyAlt,
  SmallBody,
  SmallBodyAlt,
  Caption,
  Tiny,
} as const;
