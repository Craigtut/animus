/**
 * Permission Seeder — seeds tool_permissions with defaults on startup.
 *
 * Runs idempotently: only inserts for tools without existing records.
 * User-customized rows (is_default=0) are preserved; is_default=1 rows
 * are updated if the tool definition changes.
 */

import type Database from 'better-sqlite3';
import { ANIMUS_TOOL_DEFS } from '@animus-labs/shared';
import type { RiskTier, ToolPermissionMode } from '@animus-labs/shared';
import { upsertToolPermission } from '../db/stores/system-store.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('PermissionSeeder', 'heartbeat');

// ---------------------------------------------------------------------------
// Risk tier assignment for core Animus tools
// ---------------------------------------------------------------------------

const CORE_TOOL_RISK_TIERS: Record<string, RiskTier> = {
  read_memory: 'safe',
  lookup_contacts: 'safe',
  resolve_tool_approval: 'safe',
  transcribe_audio: 'safe',
  send_message: 'communicates',
  send_proactive_message: 'communicates',
  send_media: 'communicates',
  update_progress: 'communicates',
  generate_speech: 'acts',
  run_with_credentials: 'sensitive',
};

// ---------------------------------------------------------------------------
// Known SDK built-in tools and their risk tiers
// ---------------------------------------------------------------------------

// Keys MUST match the exact tool names the Claude SDK uses (PascalCase).
// The SDK calls canUseTool/hooks with these exact names.
const SDK_TOOLS: Record<string, { displayName: string; description: string; riskTier: RiskTier }> = {
  Read: { displayName: 'Read File', description: 'Read contents of a file', riskTier: 'safe' },
  Glob: { displayName: 'Glob Search', description: 'Find files matching a glob pattern', riskTier: 'safe' },
  Grep: { displayName: 'Grep Search', description: 'Search file contents with regex', riskTier: 'safe' },
  LS: { displayName: 'List Directory', description: 'List files in a directory', riskTier: 'safe' },
  Write: { displayName: 'Write File', description: 'Write contents to a file', riskTier: 'acts' },
  Edit: { displayName: 'Edit File', description: 'Edit sections of a file', riskTier: 'acts' },
  Bash: { displayName: 'Bash Shell', description: 'Execute shell commands', riskTier: 'sensitive' },
  WebFetch: { displayName: 'Web Fetch', description: 'Fetch content from a URL', riskTier: 'acts' },
  WebSearch: { displayName: 'Web Search', description: 'Search the web', riskTier: 'acts' },
  NotebookEdit: { displayName: 'Notebook Edit', description: 'Edit Jupyter notebook cells', riskTier: 'acts' },
  NotebookRead: { displayName: 'Notebook Read', description: 'Read Jupyter notebook contents', riskTier: 'safe' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a risk tier to its default permission mode. */
function defaultModeForTier(tier: RiskTier): ToolPermissionMode {
  switch (tier) {
    case 'safe':
    case 'communicates':
      return 'always_allow';
    case 'acts':
    case 'sensitive':
      return 'ask';
  }
}

/** Convert a snake_case tool name to a human-readable display name. */
function toDisplayName(name: string): string {
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Main seeder
// ---------------------------------------------------------------------------

export function seedToolPermissions(
  systemDb: Database.Database,
  activeProvider: string = 'claude',
  plugins?: Array<{ name: string; tools?: Array<{ name: string; description?: string }> }>,
): number {
  let seeded = 0;

  // 1. Core Animus tools
  for (const [name, def] of Object.entries(ANIMUS_TOOL_DEFS)) {
    const riskTier = CORE_TOOL_RISK_TIERS[name] ?? 'acts';
    upsertToolPermission(systemDb, {
      toolName: name,
      toolSource: 'animus:core',
      displayName: toDisplayName(name),
      description: def.description,
      riskTier,
      mode: defaultModeForTier(riskTier),
      isDefault: true,
    });
    seeded++;
  }

  // 2. Active SDK tools
  const sdkSource = `sdk:${activeProvider}`;

  // Clean up stale lowercase SDK tool records from older versions.
  // The SDK uses PascalCase names (WebSearch, not websearch), so old lowercase
  // records are orphaned and should be removed to avoid confusion.
  const sdkToolNames = new Set(Object.keys(SDK_TOOLS));
  const existingPerms = systemDb
    .prepare(`SELECT tool_name FROM tool_permissions WHERE tool_source LIKE 'sdk:%'`)
    .all() as Array<{ tool_name: string }>;
  for (const row of existingPerms) {
    if (!sdkToolNames.has(row.tool_name)) {
      systemDb.prepare('DELETE FROM tool_permissions WHERE tool_name = ?').run(row.tool_name);
      log.info(`Removed stale SDK tool permission: "${row.tool_name}"`);
    }
  }

  for (const [name, tool] of Object.entries(SDK_TOOLS)) {
    upsertToolPermission(systemDb, {
      toolName: name,
      toolSource: sdkSource,
      displayName: tool.displayName,
      description: tool.description,
      riskTier: tool.riskTier,
      mode: defaultModeForTier(tool.riskTier),
      isDefault: true,
    });
    seeded++;
  }

  // 3. Plugin tools
  if (plugins) {
    for (const plugin of plugins) {
      const pluginSource = `plugin:${plugin.name}`;
      if (!plugin.tools) continue;
      for (const tool of plugin.tools) {
        const riskTier: RiskTier = 'acts';
        upsertToolPermission(systemDb, {
          toolName: tool.name,
          toolSource: pluginSource,
          displayName: toDisplayName(tool.name),
          description: tool.description ?? `Tool from ${plugin.name} plugin`,
          riskTier,
          mode: defaultModeForTier(riskTier),
          isDefault: true,
        });
        seeded++;
      }
    }
  }

  log.debug(`Seeded ${seeded} tool permissions (provider: ${activeProvider})`);
  return seeded;
}
