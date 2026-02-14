/** @jsxImportSource @emotion/react */
import { Global, css, useTheme } from '@emotion/react';

export function GlobalStyles() {
  const theme = useTheme();

  return (
    <Global
      styles={css`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@200;300;400;500;600;700&family=Crimson+Pro:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&family=JetBrains+Mono:wght@400;700&display=swap');

        *,
        *::before,
        *::after {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        :root {
          font-synthesis: none;
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        html {
          font-size: 16px;
          scroll-behavior: smooth;
        }

        body {
          font-family: ${theme.typography.fontFamily.sans};
          font-size: ${theme.typography.fontSize.base};
          line-height: ${theme.typography.lineHeight.normal};
          color: ${theme.colors.text.primary};
          background-color: ${theme.colors.background.default};
          min-height: 100vh;
        }

        a {
          color: ${theme.colors.accent};
          text-decoration: none;
          transition: opacity ${theme.transitions.fast};

          &:hover {
            opacity: 0.8;
          }
        }

        code, pre {
          font-family: ${theme.typography.fontFamily.mono};
        }

        code {
          font-size: 0.9em;
          padding: 0.2em 0.4em;
          background-color: ${theme.colors.background.elevated};
          border-radius: ${theme.borderRadius.sm};
        }

        pre {
          padding: ${theme.spacing[4]};
          background-color: ${theme.colors.background.elevated};
          border-radius: ${theme.borderRadius.default};
          overflow-x: auto;

          code {
            padding: 0;
            background: none;
          }
        }

        button {
          font-family: inherit;
          font-size: inherit;
          cursor: pointer;
          border: none;
          background: none;
        }

        input, textarea, select {
          font-family: inherit;
          font-size: inherit;
        }

        img, svg {
          display: block;
          max-width: 100%;
        }

        ul, ol {
          list-style: none;
        }

        :focus-visible {
          outline: 2px solid ${theme.colors.accent};
          outline-offset: 2px;
        }

        ::selection {
          background-color: ${theme.colors.accent};
          color: ${theme.colors.accentForeground};
        }

        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        ::-webkit-scrollbar-track {
          background: transparent;
        }

        ::-webkit-scrollbar-thumb {
          background: ${theme.colors.border.default};
          border-radius: ${theme.borderRadius.full};
        }

        * {
          scrollbar-width: thin;
          scrollbar-color: ${theme.colors.border.default} transparent;
        }

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
            scroll-behavior: auto !important;
          }
        }
      `}
    />
  );
}
