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
  list_vault_entries: 'safe',
  manage_vault_entry: 'acts',
  send_voice_reply: 'communicates',
};

// ---------------------------------------------------------------------------
// Known SDK built-in tools and their risk tiers (per provider)
// ---------------------------------------------------------------------------

type SdkToolDef = { displayName: string; description: string; riskTier: RiskTier };

// All known SDK tool definitions. Each provider selects a subset below.
const ALL_SDK_TOOLS: Record<string, SdkToolDef> = {
  // Claude Code SDK tools (PascalCase, matches canUseTool names)
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
  // Codex-specific tools (mapped from app-server item types)
  CollabAgent: { displayName: 'Collab Agent', description: 'Multi-agent collaboration tool calls', riskTier: 'acts' },
};

// Per-provider tool sets. Keys must exist in ALL_SDK_TOOLS.
// Claude: Has discrete tools for read, search, write, etc.
// Codex: Uses commandExecution (Bash), fileChange (Write/Edit), webSearch, collabAgentToolCall.
//        Does NOT have separate Read/Glob/Grep/LS/WebFetch/Notebook tools.
// OpenCode: Tools are dynamic (arbitrary names from the LLM provider); seed a minimal set.
const PROVIDER_SDK_TOOLS: Record<string, string[]> = {
  claude: ['Read', 'Glob', 'Grep', 'LS', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch', 'NotebookEdit', 'NotebookRead'],
  codex: ['Bash', 'Write', 'Edit', 'WebSearch', 'CollabAgent'],
  opencode: ['Bash', 'Write', 'Edit', 'WebSearch'],
};

/** Get the SDK tools for a given provider, falling back to the Claude set. */
function getSdkToolsForProvider(provider: string): Record<string, SdkToolDef> {
  const toolNames = PROVIDER_SDK_TOOLS[provider] ?? PROVIDER_SDK_TOOLS['claude']!;
  const result: Record<string, SdkToolDef> = {};
  for (const name of toolNames) {
    const def = ALL_SDK_TOOLS[name];
    if (def) result[name] = def;
  }
  return result;
}

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

  // 2. Active SDK tools (provider-specific)
  const sdkSource = `sdk:${activeProvider}`;
  const providerTools = getSdkToolsForProvider(activeProvider);
  const providerToolNames = new Set(Object.keys(providerTools));

  // Clean up SDK tool records that don't belong to the active provider's set.
  // This handles: stale lowercase records from older versions, and tools from
  // a previous provider that don't apply to the current one.
  const existingPerms = systemDb
    .prepare(`SELECT tool_name FROM tool_permissions WHERE tool_source LIKE 'sdk:%'`)
    .all() as Array<{ tool_name: string }>;
  for (const row of existingPerms) {
    if (!providerToolNames.has(row.tool_name)) {
      systemDb.prepare('DELETE FROM tool_permissions WHERE tool_name = ? AND tool_source LIKE ?').run(row.tool_name, 'sdk:%');
      log.debug(`Removed SDK tool not in ${activeProvider} set: "${row.tool_name}"`);
    }
  }

  for (const [name, tool] of Object.entries(providerTools)) {
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
