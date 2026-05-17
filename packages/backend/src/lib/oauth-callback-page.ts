/**
 * Branded OAuth Callback Page
 *
 * A single, self-contained HTML template for every OAuth return page Animus
 * shows in the browser. Used by two consumers:
 *
 *  1. Model-provider OAuth (Claude, ChatGPT, ...) via Cortex's
 *     `renderCallbackPage` hook. That page is served by Cortex's localhost
 *     callback shim (e.g. http://localhost:1455/auth/callback), which has no
 *     access to the frontend origin, so the template must be fully
 *     self-contained (the real Animus symbol SVG is inlined, no external
 *     asset references).
 *
 *  2. Plugin OAuth via the native /api/oauth/callback Fastify route.
 *
 * The template mirrors the in-app auth aesthetic: the actual Animus symbol,
 * the lowercase "animus" wordmark, and a warm canvas that adapts to the OS
 * light/dark preference. The page never closes itself.
 */

import { readFileSync } from 'node:fs';

/**
 * The real Animus symbol (branding/logos/animus-symbol.svg). Read once at
 * module load and inlined into the page so it renders with no network access.
 * The SVG declares its own viewBox; size is controlled via CSS.
 */
const ANIMUS_SYMBOL_SVG = readFileSync(
  new URL('./assets/animus-symbol.svg', import.meta.url),
  'utf8',
).trim();

export interface OAuthCallbackPageOptions {
  /** Whether the OAuth flow succeeded or failed. */
  status: 'success' | 'error';
  /** Human-readable provider name, e.g. "Claude". Optional. */
  providerName?: string | undefined;
  /** Heading override. Defaults to a status-appropriate phrase. */
  title?: string | undefined;
  /** Body message override. Defaults to a status-appropriate message. */
  message?: string | undefined;
  /** Extra error detail rendered in a muted block (error only). */
  details?: string | undefined;
}

/**
 * Basic HTML escaping to prevent XSS from provider error strings or any
 * value that originates outside our control.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderOAuthCallbackPage(opts: OAuthCallbackPageOptions): string {
  const isError = opts.status === 'error';
  const provider = opts.providerName?.trim();

  const heading = opts.title?.trim()
    || (isError ? 'Connection failed' : "You're signed in");

  const message = opts.message?.trim()
    || (isError
      ? 'Something went wrong while connecting. You can close this tab and try again from Animus.'
      : provider
        ? `You're signed in to ${provider}. You can close this tab and open Animus to continue.`
        : 'You can close this tab and open Animus to continue.');

  const details = opts.details?.trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(heading)} · animus</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #FAF9F4;
      --text: #1A1816;
      --muted: #6f6a63;
      --brand: #927768;
      --accent: ${isError ? '#dc2626' : '#1A1816'};
      --surface: rgba(255,255,255,0.55);
      --border: rgba(26,24,22,0.08);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1C1A18;
        --text: #FAF9F4;
        --muted: #a8a299;
        --brand: #c0a594;
        --accent: ${isError ? '#ef4444' : '#FAF9F4'};
        --surface: rgba(255,255,255,0.04);
        --border: rgba(250,249,244,0.10);
      }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 2rem;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      text-align: center;
      max-width: 420px;
      animation: rise 0.7s cubic-bezier(0.25,0.1,0.25,1) both;
    }
    .brand {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 2rem;
    }
    .brand svg {
      display: block;
      width: 64px;
      height: 64px;
    }
    .wordmark {
      font-size: 1.5rem;
      font-weight: 300;
      letter-spacing: -0.02em;
      color: var(--brand);
    }
    h1 {
      font-size: 1.4rem;
      font-weight: 600;
      color: var(--accent);
      margin-bottom: 0.6rem;
    }
    p {
      font-size: 1rem;
      line-height: 1.55;
      color: var(--muted);
    }
    .details {
      margin-top: 1.25rem;
      padding: 0.75rem 1rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      font-size: 0.8rem;
      line-height: 1.5;
      color: var(--muted);
      word-break: break-word;
      text-align: left;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(14px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand">
      ${ANIMUS_SYMBOL_SVG}
      <span class="wordmark">animus</span>
    </div>
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(message)}</p>
    ${details ? `<div class="details">${escapeHtml(details)}</div>` : ''}
  </div>
</body>
</html>`;
}
