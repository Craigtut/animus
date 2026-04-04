import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWebFetchTool, isPrivateIp } from '../../../src/tools/web-fetch/index.js';
import { promises as dns } from 'node:dns';

describe('WebFetch tool', () => {
  let webFetchTool: ReturnType<typeof createWebFetchTool>;

  beforeEach(() => {
    webFetchTool = createWebFetchTool({});
    vi.spyOn(dns, 'lookup').mockResolvedValue({ address: '93.184.216.34', family: 4 } as never);
  });

  afterEach(() => {
    webFetchTool.getCache().destroy();
    vi.restoreAllMocks();
  });

  it('rejects file:// URLs', async () => {
    const result = await webFetchTool.execute({
      url: 'file:///etc/passwd',
      prompt: 'read this file',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('URL rejected');
    expect(text).toContain('not allowed');
  });

  it('rejects data:// URLs', async () => {
    const result = await webFetchTool.execute({
      url: 'data:text/html,<h1>hello</h1>',
      prompt: 'read this',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('URL rejected');
  });

  it('rejects private IP addresses (127.0.0.1)', async () => {
    const result = await webFetchTool.execute({
      url: 'http://127.0.0.1:8080/api',
      prompt: 'test',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('URL rejected');
    expect(text).toContain('private');
  });

  it('rejects localhost', async () => {
    const result = await webFetchTool.execute({
      url: 'http://localhost:3000',
      prompt: 'test',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('URL rejected');
  });

  it('rejects 10.x.x.x private IPs', async () => {
    const result = await webFetchTool.execute({
      url: 'http://10.0.0.1/api',
      prompt: 'test',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('URL rejected');
  });

  it('rejects 192.168.x.x private IPs', async () => {
    const result = await webFetchTool.execute({
      url: 'http://192.168.1.1',
      prompt: 'test',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('URL rejected');
  });

  it('enforces per-loop rate limit', async () => {
    const tool = createWebFetchTool({ maxPerLoop: 1 });

    // Mock fetch to avoid real HTTP calls (create fresh Response per call)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('<html><body>content</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    // First fetch should work (or error on DNS, but the count is consumed)
    await tool.execute({ url: 'https://example.com/page1', prompt: 'test' });

    // Second fetch should hit rate limit
    const result = await tool.execute({ url: 'https://example.com/page2', prompt: 'test' });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('rate limit');

    tool.getCache().destroy();
  });

  it('resets rate limit counter', async () => {
    const tool = createWebFetchTool({ maxPerLoop: 1 });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('<html><body>content</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    // Use one fetch
    await tool.execute({ url: 'https://example.com/page1', prompt: 'test' });

    // Reset
    tool.resetRateLimit();

    // Should be able to fetch again
    const result = await tool.execute({ url: 'https://example.com/page2', prompt: 'test' });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).not.toContain('rate limit');

    tool.getCache().destroy();
  });

  it('serves cached results without counting against rate limit', async () => {
    const tool = createWebFetchTool({ maxPerLoop: 1 });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('<html><body>test content</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    // First fetch (counts against limit)
    await tool.execute({ url: 'https://example.com/cached', prompt: 'test1' });

    // Same URL again (should hit cache, not count against limit)
    const result = await tool.execute({ url: 'https://example.com/cached', prompt: 'test2' });
    expect(result.details.cacheHit).toBe(true);

    tool.getCache().destroy();
  });

  it('handles HTTP 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    );

    const result = await webFetchTool.execute({
      url: 'https://example.com/notfound',
      prompt: 'test',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Page not found');
  });

  it('handles HTTP 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Forbidden', { status: 403 }),
    );

    const result = await webFetchTool.execute({
      url: 'https://example.com/private',
      prompt: 'test',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Access forbidden');
  });

  it('handles HTTP 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    const result = await webFetchTool.execute({
      url: 'https://example.com/error',
      prompt: 'test',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Server error');
  });

  it('detects JavaScript-only pages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><head><script src="app.js"></script></head><body><div id="root"></div></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const result = await webFetchTool.execute({
      url: 'https://example.com/spa',
      prompt: 'test',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('JavaScript to render');
  });

  it('returns raw content when no utility model is available', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body><p>Hello World</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const result = await webFetchTool.execute({
      url: 'https://example.com/content',
      prompt: 'what does the page say?',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('utility model not available');
    expect(text).toContain('Hello World');
  });

  it('uses utility model for summarization when available', async () => {
    const tool = createWebFetchTool({
      utilityComplete: async () => 'Summarized answer about the page',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body><p>Long content here</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const result = await tool.execute({
      url: 'https://example.com/content',
      prompt: 'summarize this',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toBe('Summarized answer about the page');

    tool.getCache().destroy();
  });

  it('handles JSON content type', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"key": "value"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await webFetchTool.execute({
      url: 'https://example.com/api',
      prompt: 'test',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    // Should contain the JSON as raw text (no HTML conversion)
    expect(text).toContain('key');
    expect(text).toContain('value');
  });

  it('handles invalid URL format', async () => {
    const result = await webFetchTool.execute({
      url: 'not-a-url',
      prompt: 'test',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('URL rejected');
  });

  // S2: DNS rebinding prevention
  describe('DNS rebinding prevention', () => {
    it('blocks domains that resolve to private IPs', async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: '127.0.0.1', family: 4 } as never);

      const result = await webFetchTool.execute({
        url: 'https://evil-rebind.example.com/api',
        prompt: 'test',
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('URL rejected');
      expect(text).toContain('private IP');
    });

    it('blocks domains that resolve to 10.x.x.x', async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: '10.0.0.1', family: 4 } as never);

      const result = await webFetchTool.execute({
        url: 'https://attacker.com/ssrf',
        prompt: 'test',
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('URL rejected');
      expect(text).toContain('private IP');
    });

    it('allows domains that resolve to public IPs', async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: '93.184.216.34', family: 4 } as never);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('<html><body>Public content</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      );

      const result = await webFetchTool.execute({
        url: 'https://example.com/page',
        prompt: 'test',
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).not.toContain('URL rejected');
    });
  });

  // S5: Proper IP parsing tests
  describe('isPrivateIp', () => {
    // IPv4 private ranges
    it('detects 127.0.0.1 as private', () => {
      expect(isPrivateIp('127.0.0.1')).toBe(true);
    });

    it('detects 127.x.x.x as private', () => {
      expect(isPrivateIp('127.255.0.1')).toBe(true);
    });

    it('detects 10.0.0.0/8 as private', () => {
      expect(isPrivateIp('10.0.0.1')).toBe(true);
      expect(isPrivateIp('10.255.255.255')).toBe(true);
    });

    it('detects 172.16.0.0/12 as private', () => {
      expect(isPrivateIp('172.16.0.1')).toBe(true);
      expect(isPrivateIp('172.31.255.255')).toBe(true);
    });

    it('does not flag 172.15.x.x or 172.32.x.x', () => {
      expect(isPrivateIp('172.15.0.1')).toBe(false);
      expect(isPrivateIp('172.32.0.1')).toBe(false);
    });

    it('detects 192.168.0.0/16 as private', () => {
      expect(isPrivateIp('192.168.0.1')).toBe(true);
      expect(isPrivateIp('192.168.255.255')).toBe(true);
    });

    it('detects 169.254.0.0/16 (link-local) as private', () => {
      expect(isPrivateIp('169.254.169.254')).toBe(true);
    });

    it('detects 0.0.0.0 as private', () => {
      expect(isPrivateIp('0.0.0.0')).toBe(true);
    });

    it('allows public IPs', () => {
      expect(isPrivateIp('8.8.8.8')).toBe(false);
      expect(isPrivateIp('93.184.216.34')).toBe(false);
      expect(isPrivateIp('1.1.1.1')).toBe(false);
    });

    // IPv4-mapped IPv6
    it('detects ::ffff:127.0.0.1 as private', () => {
      expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    });

    it('detects ::ffff:10.0.0.1 as private', () => {
      expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
    });

    it('allows ::ffff: with public IP', () => {
      expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
    });

    // IPv6
    it('detects ::1 as private', () => {
      expect(isPrivateIp('::1')).toBe(true);
    });

    it('detects fe80:: link-local as private', () => {
      expect(isPrivateIp('fe80::1')).toBe(true);
    });

    it('detects fc00::/7 unique local as private', () => {
      expect(isPrivateIp('fc00::1')).toBe(true);
      expect(isPrivateIp('fd00::1')).toBe(true);
    });

    it('treats unrecognized format as private (fail-safe)', () => {
      expect(isPrivateIp('not-an-ip')).toBe(true);
    });
  });

  // Cross-host redirect detection tests
  describe('redirect handling', () => {
    it('returns redirect message for cross-host 301 redirect', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, {
          status: 301,
          headers: { 'location': 'https://other-host.com/page' },
        }),
      );

      const result = await webFetchTool.execute({
        url: 'https://example.com/old',
        prompt: 'test',
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('redirects to');
      expect(text).toContain('https://other-host.com/page');
      expect(text).toContain('Make a new WebFetch request');
    });

    it('follows same-host redirects transparently', async () => {
      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        callCount++;
        const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
        if (requestUrl.includes('/old')) {
          return new Response(null, {
            status: 302,
            headers: { 'location': 'https://example.com/new' },
          });
        }
        return new Response('<html><body><p>Final content</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      });

      const result = await webFetchTool.execute({
        url: 'https://example.com/old',
        prompt: 'test',
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      // Should have followed the redirect (2 fetch calls)
      expect(callCount).toBe(2);
      // Should not contain the redirect message
      expect(text).not.toContain('redirects to');
      // Should contain the final content
      expect(text).toContain('Final content');
    });

    it('handles cross-host redirect with relative Location header', async () => {
      // A 302 to an absolute URL on a different host
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { 'location': 'https://cdn.example.org/resource' },
        }),
      );

      const result = await webFetchTool.execute({
        url: 'https://example.com/resource',
        prompt: 'test',
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('redirects to');
      expect(text).toContain('cdn.example.org');
    });

    it('stops after too many same-host redirects', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
        const num = parseInt(requestUrl.split('/r')[1] ?? '0', 10);
        return new Response(null, {
          status: 302,
          headers: { 'location': `https://example.com/r${num + 1}` },
        });
      });

      const result = await webFetchTool.execute({
        url: 'https://example.com/r0',
        prompt: 'test',
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Too many redirects');
    });
  });
});
