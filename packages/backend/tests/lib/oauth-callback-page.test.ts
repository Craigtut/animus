import { describe, it, expect } from 'vitest';
import { renderOAuthCallbackPage } from '../../src/lib/oauth-callback-page.js';

describe('renderOAuthCallbackPage', () => {
  it('renders a self-contained branded success page using the real Animus symbol', () => {
    const html = renderOAuthCallbackPage({ status: 'success', providerName: 'Claude' });

    expect(html).toContain('<!DOCTYPE html>');
    // Branding: wordmark + the actual inlined Animus symbol (no external asset)
    expect(html).toContain('>animus<');
    expect(html).toContain('<svg');
    // The real symbol artwork (branding/logos/animus-symbol.svg)
    expect(html).toContain('fill="#8E6043"');
    expect(html).toContain('stroke0_57_40');
    expect(html).not.toContain('/favicon.svg');
    expect(html).not.toContain('src=');
    // Provider-specific success copy (apostrophes are HTML-escaped)
    expect(html).toContain('signed in to Claude');
    expect(html).toContain('open Animus to continue');
  });

  it('omits the provider clause when no provider name is given', () => {
    const html = renderOAuthCallbackPage({ status: 'success' });
    expect(html).toContain('open Animus to continue');
    expect(html).not.toContain('signed in to ');
  });

  it('never closes the window automatically', () => {
    const success = renderOAuthCallbackPage({ status: 'success' });
    const error = renderOAuthCallbackPage({ status: 'error' });
    expect(success).not.toContain('window.close()');
    expect(success).not.toContain('close automatically');
    expect(error).not.toContain('window.close()');
    expect(error).not.toContain('<script');
  });

  it('renders error details in a muted block', () => {
    const html = renderOAuthCallbackPage({
      status: 'error',
      title: 'Connection failed',
      details: 'token exchange failed',
    });
    expect(html).toContain('Connection failed');
    expect(html).toContain('class="details"');
    expect(html).toContain('token exchange failed');
  });

  it('escapes HTML to prevent injection from provider strings', () => {
    const html = renderOAuthCallbackPage({
      status: 'error',
      details: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
