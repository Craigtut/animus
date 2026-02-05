/** @jsxImportSource @emotion/react */
import { Global, css, useTheme } from '@emotion/react';

export function GlobalStyles() {
  const theme = useTheme();

  return (
    <Global
      styles={css`
        /* CSS Reset */
        *,
        *::before,
        *::after {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        /* Root styles */
        :root {
          font-synthesis: none;
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        /* Document styles */
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

        /* Links */
        a {
          color: ${theme.colors.primary[400]};
          text-decoration: none;
          transition: color ${theme.transitions.fast};

          &:hover {
            color: ${theme.colors.primary[300]};
          }
        }

        /* Headings */
        h1,
        h2,
        h3,
        h4,
        h5,
        h6 {
          font-weight: ${theme.typography.fontWeight.semibold};
          line-height: ${theme.typography.lineHeight.tight};
        }

        h1 {
          font-size: ${theme.typography.fontSize['4xl']};
        }
        h2 {
          font-size: ${theme.typography.fontSize['3xl']};
        }
        h3 {
          font-size: ${theme.typography.fontSize['2xl']};
        }
        h4 {
          font-size: ${theme.typography.fontSize.xl};
        }
        h5 {
          font-size: ${theme.typography.fontSize.lg};
        }
        h6 {
          font-size: ${theme.typography.fontSize.base};
        }

        /* Code */
        code,
        pre {
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

        /* Buttons */
        button {
          font-family: inherit;
          font-size: inherit;
          cursor: pointer;
          border: none;
          background: none;
        }

        /* Inputs */
        input,
        textarea,
        select {
          font-family: inherit;
          font-size: inherit;
        }

        /* Images */
        img,
        svg {
          display: block;
          max-width: 100%;
        }

        /* Lists */
        ul,
        ol {
          list-style: none;
        }

        /* Focus styles */
        :focus-visible {
          outline: 2px solid ${theme.colors.primary[500]};
          outline-offset: 2px;
        }

        /* Selection */
        ::selection {
          background-color: ${theme.colors.primary[500]};
          color: white;
        }

        /* Scrollbar (WebKit) */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }

        ::-webkit-scrollbar-track {
          background: ${theme.colors.background.paper};
        }

        ::-webkit-scrollbar-thumb {
          background: ${theme.colors.neutral[600]};
          border-radius: ${theme.borderRadius.full};

          &:hover {
            background: ${theme.colors.neutral[500]};
          }
        }

        /* Firefox scrollbar */
        * {
          scrollbar-width: thin;
          scrollbar-color: ${theme.colors.neutral[600]} ${theme.colors.background.paper};
        }
      `}
    />
  );
}
