/**
 * Permission Seeder Tests — verifies tool permission seeding logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSystemDb } from '../helpers.js';
import { seedToolPermissions } from '../../src/tools/permission-seeder.js';
import * as systemStore from '../../src/db/stores/system-store.js';

describe('permission seeder', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestSystemDb();
  });

  it('seeds core Animus tools', () => {
    seedToolPermissions(db);
    const perms = systemStore.getToolPermissions(db);
    const coreTools = perms.filter((p) => p.toolSource === 'animus:core');
    expect(coreTools.length).toBeGreaterThan(0);

    // Check known core tools
    const sendMsg = coreTools.find((p) => p.toolName === 'send_message');
    expect(sendMsg).toBeDefined();
    expect(sendMsg!.riskTier).toBe('communicates');
    expect(sendMsg!.mode).toBe('always_allow');

    const readMemory = coreTools.find((p) => p.toolName === 'read_memory');
    expect(readMemory).toBeDefined();
    expect(readMemory!.riskTier).toBe('safe');
    expect(readMemory!.mode).toBe('always_allow');
  });

  it('seeds cortex built-in tools', () => {
    seedToolPermissions(db);
    const perms = systemStore.getToolPermissions(db);
    const cortexTools = perms.filter((p) => p.toolSource === 'cortex:builtin');

    const readTool = cortexTools.find((p) => p.toolName === 'Read');
    expect(readTool).toBeDefined();
    expect(readTool!.riskTier).toBe('safe');
    expect(readTool!.mode).toBe('always_allow');

    const writeTool = cortexTools.find((p) => p.toolName === 'Write');
    expect(writeTool).toBeDefined();
    expect(writeTool!.riskTier).toBe('acts');
    expect(writeTool!.mode).toBe('ask');

    const undoEditTool = cortexTools.find((p) => p.toolName === 'UndoEdit');
    expect(undoEditTool).toBeDefined();
    expect(undoEditTool!.riskTier).toBe('acts');
    expect(undoEditTool!.mode).toBe('ask');

    const bashTool = cortexTools.find((p) => p.toolName === 'Bash');
    expect(bashTool).toBeDefined();
    expect(bashTool!.riskTier).toBe('sensitive');
    expect(bashTool!.mode).toBe('ask');

    const taskOutputTool = cortexTools.find((p) => p.toolName === 'TaskOutput');
    expect(taskOutputTool).toBeDefined();
    expect(taskOutputTool!.riskTier).toBe('safe');
    expect(taskOutputTool!.mode).toBe('always_allow');

    const toolSearchTool = cortexTools.find((p) => p.toolName === 'ToolSearch');
    expect(toolSearchTool).toBeDefined();
    expect(toolSearchTool!.riskTier).toBe('safe');
    expect(toolSearchTool!.mode).toBe('always_allow');

    const loadSkillTool = cortexTools.find((p) => p.toolName === 'load_skill');
    expect(loadSkillTool).toBeDefined();
    expect(loadSkillTool!.riskTier).toBe('safe');
    expect(loadSkillTool!.mode).toBe('always_allow');

    const recallTool = cortexTools.find((p) => p.toolName === 'recall');
    expect(recallTool).toBeDefined();
    expect(recallTool!.riskTier).toBe('safe');
    expect(recallTool!.mode).toBe('always_allow');
  });

  it('seeds plugin tools', () => {
    seedToolPermissions(db, [
      {
        name: 'weather',
        tools: [
          { name: 'get_weather', description: 'Get current weather' },
          { name: 'get_forecast', description: 'Get weather forecast' },
        ],
      },
    ]);
    const perms = systemStore.getToolPermissions(db);
    const pluginTools = perms.filter((p) => p.toolSource === 'plugin:weather');
    expect(pluginTools).toHaveLength(2);

    const weather = pluginTools.find((p) => p.toolName === 'get_weather');
    expect(weather).toBeDefined();
    expect(weather!.riskTier).toBe('acts');
    expect(weather!.mode).toBe('ask');
  });

  it('treats the declared plugin tier as authoritative for the default mode', () => {
    seedToolPermissions(db, [
      {
        name: 'home-assistant',
        tools: [
          // Server-level row (dynamic tool set): declared 'acts'
          { name: 'mcp__home-assistant__ha', riskTier: 'acts' },
          // Per-tool 'safe' -> always_allow by default (plugin can
          // self-grant; the manifest is authoritative).
          {
            name: 'mcp__home-assistant__ha__get_state',
            riskTier: 'safe',
            description: 'Read entity state',
          },
          // Per-tool 'sensitive' -> ask.
          { name: 'mcp__home-assistant__ha__unlock_door', riskTier: 'sensitive' },
        ],
      },
    ]);
    const perms = systemStore.getToolPermissions(db);
    const ha = perms.filter((p) => p.toolSource === 'plugin:home-assistant');
    expect(ha).toHaveLength(3);

    const getState = ha.find((p) => p.toolName === 'mcp__home-assistant__ha__get_state');
    expect(getState!.riskTier).toBe('safe');
    expect(getState!.mode).toBe('always_allow'); // authoritative: not floored

    const unlock = ha.find((p) => p.toolName === 'mcp__home-assistant__ha__unlock_door');
    expect(unlock!.riskTier).toBe('sensitive');
    expect(unlock!.mode).toBe('ask');

    const server = ha.find((p) => p.toolName === 'mcp__home-assistant__ha');
    expect(server!.riskTier).toBe('acts');
    expect(server!.mode).toBe('ask');
  });

  it('defaults plugin tool tier to acts when undeclared', () => {
    seedToolPermissions(db, [
      { name: 'p', tools: [{ name: 'mcp__p__s', description: 'srv' }] },
    ]);
    const row = systemStore
      .getToolPermissions(db)
      .find((p) => p.toolName === 'mcp__p__s');
    expect(row!.riskTier).toBe('acts');
    expect(row!.mode).toBe('ask');
  });

  it('is idempotent — running twice does not duplicate', () => {
    seedToolPermissions(db);
    const count1 = systemStore.getToolPermissions(db).length;

    seedToolPermissions(db);
    const count2 = systemStore.getToolPermissions(db).length;

    expect(count1).toBe(count2);
  });

  it('preserves user-customized permissions on re-seed', () => {
    seedToolPermissions(db);

    // User customizes Write tool to always_allow
    systemStore.updateToolPermissionMode(db, 'Write', 'always_allow');
    const custom = systemStore.getToolPermission(db, 'Write');
    expect(custom!.mode).toBe('always_allow');
    expect(custom!.isDefault).toBe(false);

    // Re-seed — should not overwrite user's choice
    seedToolPermissions(db);
    const afterReseed = systemStore.getToolPermission(db, 'Write');
    expect(afterReseed!.mode).toBe('always_allow');
    expect(afterReseed!.isDefault).toBe(false);
  });

  it('maps risk tiers to correct default modes', () => {
    seedToolPermissions(db);
    const perms = systemStore.getToolPermissions(db);

    for (const perm of perms) {
      if (perm.riskTier === 'safe' || perm.riskTier === 'communicates') {
        expect(perm.mode).toBe('always_allow');
      } else if (perm.riskTier === 'acts' || perm.riskTier === 'sensitive') {
        expect(perm.mode).toBe('ask');
      }
    }
  });

  it('skips plugins with no tools', () => {
    seedToolPermissions(db, [
      { name: 'empty-plugin' },
    ]);
    const perms = systemStore.getToolPermissions(db);
    const pluginTools = perms.filter((p) => p.toolSource === 'plugin:empty-plugin');
    expect(pluginTools).toHaveLength(0);
  });
});
