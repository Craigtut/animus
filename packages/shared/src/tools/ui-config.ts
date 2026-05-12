/**
 * Tool UI Configuration
 *
 * Controls how tools are displayed in the Settings > Tools page.
 * Tools are either "locked" (always-allow infrastructure, hidden from default view)
 * or "visible" (shown to users, grouped by functional category).
 *
 * Plugin tools are always visible and auto-categorized as 'plugin'.
 */

export type ToolVisibility = 'visible' | 'locked';

export type ToolUICategory =
  | 'messaging'
  | 'web'
  | 'files'
  | 'shell'
  | 'credentials'
  | 'plugin';

export interface ToolUIConfig {
  visibility: ToolVisibility;
  category?: ToolUICategory;
}

export const TOOL_UI_CONFIG: Record<string, ToolUIConfig> = {
  // ------------------------------------------------------------------
  // Locked: agent infrastructure (safe, always-allow, never shown)
  // ------------------------------------------------------------------
  read_memory: { visibility: 'locked' },
  lookup_contacts: { visibility: 'locked' },
  update_progress: { visibility: 'locked' },
  list_vault_entries: { visibility: 'locked' },
  transcribe_audio: { visibility: 'locked' },
  Read: { visibility: 'visible', category: 'files' },
  Glob: { visibility: 'visible', category: 'files' },
  Grep: { visibility: 'visible', category: 'files' },
  SubAgent: { visibility: 'locked' },
  TaskOutput: { visibility: 'locked' },
  ToolSearch: { visibility: 'locked' },
  load_skill: { visibility: 'locked' },
  recall: { visibility: 'locked' },

  // ------------------------------------------------------------------
  // Locked: core communication (Animus can't reply without these)
  // ------------------------------------------------------------------
  send_message: { visibility: 'locked' },
  send_media: { visibility: 'locked' },
  send_voice_reply: { visibility: 'locked' },
  generate_speech: { visibility: 'locked' },

  // ------------------------------------------------------------------
  // Visible: user-configurable permissions grouped by function
  // ------------------------------------------------------------------
  send_proactive_message: { visibility: 'visible', category: 'messaging' },
  WebFetch: { visibility: 'visible', category: 'web' },
  Write: { visibility: 'visible', category: 'files' },
  Edit: { visibility: 'visible', category: 'files' },
  UndoEdit: { visibility: 'visible', category: 'files' },
  Bash: { visibility: 'visible', category: 'shell' },
  run_with_credentials: { visibility: 'visible', category: 'credentials' },
  manage_vault_entry: { visibility: 'visible', category: 'credentials' },
};

export interface ToolCategoryMeta {
  label: string;
  description: string;
  order: number;
}

export const TOOL_CATEGORY_META: Record<ToolUICategory, ToolCategoryMeta> = {
  messaging: {
    label: 'Messaging',
    description: 'Control whether Animus can reach out to you on its own.',
    order: 0,
  },
  web: {
    label: 'Web Access',
    description: 'Allow Animus to fetch content from the internet.',
    order: 1,
  },
  files: {
    label: 'Files',
    description: 'Control how Animus can read, search, and modify files on your system.',
    order: 2,
  },
  shell: {
    label: 'Shell Commands',
    description: 'Allow Animus to run commands in a terminal.',
    order: 3,
  },
  credentials: {
    label: 'Credentials',
    description: 'Control access to stored passwords, API keys, and tokens.',
    order: 4,
  },
  plugin: {
    label: 'Plugins',
    description: 'Tools provided by installed plugins.',
    order: 5,
  },
};

/** Get the UI config for a tool, defaulting to visible/plugin for unknown tools. */
export function getToolUIConfig(toolName: string, toolSource: string): ToolUIConfig {
  const config = TOOL_UI_CONFIG[toolName];
  if (config) return config;
  if (toolSource.startsWith('plugin:')) return { visibility: 'visible', category: 'plugin' };
  return { visibility: 'visible' };
}
