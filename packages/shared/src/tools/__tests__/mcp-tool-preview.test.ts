import { describe, it, expect } from 'vitest';
import {
  computeMcpToolPreview,
  riskTierToDefaultMode,
} from '../mcp-tool-preview.js';
import type { PluginMcpServer } from '../../types/index.js';

describe('riskTierToDefaultMode', () => {
  it('maps tiers to default modes (manifest authoritative, no floor)', () => {
    expect(riskTierToDefaultMode('safe')).toBe('always_allow');
    expect(riskTierToDefaultMode('communicates')).toBe('always_allow');
    expect(riskTierToDefaultMode('acts')).toBe('ask');
    expect(riskTierToDefaultMode('sensitive')).toBe('ask');
  });
});

describe('computeMcpToolPreview', () => {
  it('emits a dynamic server-level row for a dynamic tool set (HA case)', () => {
    const servers: Record<string, PluginMcpServer> = {
      ha: {
        type: 'http',
        url: 'https://x/api/mcp',
        args: [],
        env: {},
        headers: {},
        description: 'Home Assistant MCP server',
        riskTier: 'acts',
      },
    };
    const preview = computeMcpToolPreview('home-assistant', servers);
    expect(preview).toHaveLength(1);
    expect(preview[0]).toMatchObject({
      toolName: 'mcp__home-assistant__ha',
      riskTier: 'acts',
      defaultMode: 'ask',
      dynamic: true,
    });
  });

  it('emits per-tool rows with declared tiers plus the server catch-all', () => {
    const servers: Record<string, PluginMcpServer> = {
      s: {
        command: 'node',
        args: [],
        env: {},
        headers: {},
        riskTier: 'acts',
        tools: [
          { name: 'get_state', riskTier: 'safe', description: 'Read state' },
          { name: 'unlock', riskTier: 'sensitive' },
          'toggle', // bare string inherits server tier
        ],
      },
    };
    const preview = computeMcpToolPreview('p', servers);
    const byName = Object.fromEntries(preview.map((t) => [t.toolName, t]));

    expect(byName['mcp__p__s']).toMatchObject({ dynamic: true, defaultMode: 'ask' });
    expect(byName['mcp__p__s__get_state']).toMatchObject({
      riskTier: 'safe',
      defaultMode: 'always_allow',
      dynamic: false,
    });
    expect(byName['mcp__p__s__unlock']).toMatchObject({
      riskTier: 'sensitive',
      defaultMode: 'ask',
    });
    expect(byName['mcp__p__s__toggle']).toMatchObject({
      riskTier: 'acts', // inherited from server
      defaultMode: 'ask',
    });
  });

  it('defaults server tier to acts when undeclared', () => {
    const servers: Record<string, PluginMcpServer> = {
      s: { command: 'x', args: [], env: {}, headers: {} },
    };
    const preview = computeMcpToolPreview('p', servers);
    expect(preview[0]).toMatchObject({ riskTier: 'acts', defaultMode: 'ask' });
  });
});
