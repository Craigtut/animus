/**
 * resolveMcpPermKey tests — verifies runtime MCP tool names map back to the
 * server-level permission key the seeder creates (`mcp__<plugin>__<server>`).
 *
 * Regression coverage for the MCP permission-bypass bug: Cortex calls plugin
 * MCP tools by `<plugin>__<server>__<tool>` while permissions are seeded per
 * server, so the exact-name lookup always missed and "ask" was never enforced.
 */

import { describe, it, expect } from 'vitest';
import { resolveMcpPermKey } from '../../src/heartbeat/cortex-mind.js';

describe('resolveMcpPermKey', () => {
  const serverKeys = ['home-assistant__server', 'obsidian__vault'];

  it('maps a runtime MCP tool name to its seeded server permKey', () => {
    expect(resolveMcpPermKey('home-assistant__server__get_state', serverKeys)).toBe(
      'mcp__home-assistant__server',
    );
    expect(resolveMcpPermKey('obsidian__vault__search_vault', serverKeys)).toBe(
      'mcp__obsidian__vault',
    );
  });

  it('matches when the tool name equals the server key exactly', () => {
    expect(resolveMcpPermKey('home-assistant__server', serverKeys)).toBe(
      'mcp__home-assistant__server',
    );
  });

  it('returns null for non-MCP / built-in tool names', () => {
    expect(resolveMcpPermKey('Bash', serverKeys)).toBeNull();
    expect(resolveMcpPermKey('send_message', serverKeys)).toBeNull();
  });

  it('returns null when there are no connected MCP servers', () => {
    expect(resolveMcpPermKey('home-assistant__server__get_state', [])).toBeNull();
  });

  it('does not match a server key that is only a partial token prefix', () => {
    // "home-assistant__serverpro__x" must not match "home-assistant__server"
    expect(
      resolveMcpPermKey('home-assistant__serverpro__x', ['home-assistant__server']),
    ).toBeNull();
  });

  it('prefers the longest matching server key when keys share a prefix', () => {
    const keys = ['acme__db', 'acme__db__readonly'];
    expect(resolveMcpPermKey('acme__db__readonly__query', keys)).toBe(
      'mcp__acme__db__readonly',
    );
  });
});
