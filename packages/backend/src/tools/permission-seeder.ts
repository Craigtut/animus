/**
 * Permission Seeder -- seeds tool_permissions with defaults on startup.
 *
 * Runs idempotently: only inserts for tools without existing records.
 * User-customized rows (is_default=0) are preserved; is_default=1 rows
 * are updated if the tool definition changes.
 */

import type Database from 'better-sqlite3';
import { ANIMUS_TOOL_DEFS, riskTierToDefaultMode } from '@animus-labs/shared';
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
  transcribe_audio: 'safe',
  send_message: 'communicates',
  send_proactive_message: 'communicates',
  send_media: 'communicates',
  update_progress: 'communicates',
  generate_speech: 'communicates',
  run_with_credentials: 'sensitive',
  list_vault_entries: 'safe',
  manage_vault_entry: 'acts',
  send_voice_reply: 'communicates',
};

// ---------------------------------------------------------------------------
// Cortex built-in tools (in-process, from @animus-labs/cortex)
// These are registered as AgentTool objects, not MCP tools.
// ---------------------------------------------------------------------------

type SdkToolDef = { displayName: string; description: string; riskTier: RiskTier };

const CORTEX_BUILTIN_TOOLS: Record<string, SdkToolDef> = {
  Bash: { displayName: 'Bash Shell', description: 'Execute shell commands', riskTier: 'sensitive' },
  Read: { displayName: 'Read File', description: 'Read contents of a file', riskTier: 'safe' },
  Write: { displayName: 'Write File', description: 'Write contents to a file', riskTier: 'acts' },
  Edit: { displayName: 'Edit File', description: 'Edit sections of a file', riskTier: 'acts' },
  UndoEdit: { displayName: 'Undo Edit', description: 'Revert the most recent file edit or write', riskTier: 'acts' },
  Glob: { displayName: 'Glob Search', description: 'Find files matching a glob pattern', riskTier: 'safe' },
  Grep: { displayName: 'Grep Search', description: 'Search file contents with regex', riskTier: 'safe' },
  WebFetch: { displayName: 'Web Fetch', description: 'Fetch content from a URL', riskTier: 'communicates' },
  SubAgent: { displayName: 'Sub Agent', description: 'Spawn a sub-agent for delegated work', riskTier: 'safe' },
  TaskOutput: { displayName: 'Task Output', description: 'Poll or control background shell tasks', riskTier: 'safe' },
  ToolSearch: { displayName: 'Tool Search', description: 'Load deferred tool schemas on demand', riskTier: 'safe' },
  load_skill: { displayName: 'Load Skill', description: 'Load skill instructions into active context', riskTier: 'safe' },
  recall: { displayName: 'Recall', description: 'Search persisted conversation history', riskTier: 'safe' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a risk tier to its default permission mode. Delegates to the
 * shared mapping so the install-time preview and the seeded rows can
 * never disagree.
 */
function defaultModeForTier(tier: RiskTier): ToolPermissionMode {
  return riskTierToDefaultMode(tier);
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
  plugins?: Array<{
    name: string;
    tools?: Array<{
      name: string;
      description?: string;
      riskTier?: RiskTier;
      /**
       * Install-time mode chosen by the user in the consent dialog. When
       * set, the row is seeded as a locked override (`is_default=0`) so
       * re-seeds and plugin updates never stomp the user's decision.
       */
      mode?: ToolPermissionMode;
    }>;
  }>,
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

  // 2. Cortex built-in tools (in-process tools from @animus-labs/cortex)
  for (const [name, tool] of Object.entries(CORTEX_BUILTIN_TOOLS)) {
    upsertToolPermission(systemDb, {
      toolName: name,
      toolSource: 'cortex:builtin',
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
        const riskTier: RiskTier = tool.riskTier ?? 'acts';
        // If the user picked a mode at install time, seed it as a locked
        // override (is_default=0). upsertToolPermission's ON CONFLICT
        // preserves is_default=0 rows verbatim, so re-seeds and plugin
        // updates never overwrite the user's install-time decision.
        // Otherwise the manifest-declared tier is authoritative for the
        // default mode (no plugin-specific floor), like core tools.
        const hasInstallChoice = tool.mode !== undefined;
        upsertToolPermission(systemDb, {
          toolName: tool.name,
          toolSource: pluginSource,
          displayName: toDisplayName(tool.name),
          description: tool.description ?? `Tool from ${plugin.name} plugin`,
          riskTier,
          mode: tool.mode ?? defaultModeForTier(riskTier),
          isDefault: !hasInstallChoice,
        });
        seeded++;
      }
    }
  }

  // 4. Purge orphaned tool sources (e.g., old sdk:claude rows from legacy agent adapters)
  const VALID_SOURCES = new Set(['animus:core', 'cortex:builtin']);
  if (plugins) {
    for (const p of plugins) VALID_SOURCES.add(`plugin:${p.name}`);
  }
  const allRows = systemDb.prepare('SELECT tool_source FROM tool_permissions').all() as Array<{ tool_source: string }>;
  const orphanSources = new Set<string>();
  for (const row of allRows) {
    if (!VALID_SOURCES.has(row.tool_source)) orphanSources.add(row.tool_source);
  }
  if (orphanSources.size > 0) {
    for (const src of orphanSources) {
      const deleted = systemDb.prepare('DELETE FROM tool_permissions WHERE tool_source = ?').run(src);
      log.info(`Purged ${deleted.changes} orphaned tools from source "${src}"`);
    }
  }

  log.debug(`Seeded ${seeded} tool permissions`);
  return seeded;
}
