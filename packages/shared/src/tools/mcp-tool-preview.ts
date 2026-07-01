/**
 * MCP tool permission preview.
 *
 * Single source of truth for two things that must agree exactly:
 *  - the install-time consent preview (what `verifyPackage` shows the user)
 *  - the rows the permission seeder creates for a plugin's MCP tools
 *
 * Both derive their keys, risk tiers, and default modes from here so the
 * dialog never shows something different from what actually gets seeded.
 */

import type { PluginMcpServer, RiskTier, ToolPermissionMode } from '../types/index.js';

/**
 * Canonical risk tier -> default permission mode mapping. Used for core,
 * built-in, and plugin tools alike. The plugin manifest tier is
 * authoritative for the default (no plugin-specific floor).
 */
export function riskTierToDefaultMode(tier: RiskTier): ToolPermissionMode {
  switch (tier) {
    case 'safe':
    case 'communicates':
      return 'always_allow';
    case 'acts':
    case 'sensitive':
      return 'ask';
  }
}

export interface McpToolPreview {
  /** Seeded permission key: `mcp__<plugin>__<server>` or `...__<tool>`. */
  toolName: string;
  /** Human-facing label for the dialog. */
  displayName: string;
  description: string;
  riskTier: RiskTier;
  /** Mode this tool would default to (from the manifest tier). */
  defaultMode: ToolPermissionMode;
  /**
   * True for the server-level catch-all row. Its tools are discovered at
   * runtime (e.g. Home Assistant), so they cannot be enumerated at
   * install time; they inherit this row until they appear individually
   * in Settings after first connect.
   */
  dynamic: boolean;
}

/**
 * Compute the MCP tool permission rows for one plugin from its parsed
 * MCP server configs. Mirrors `collectPluginTools` in the backend.
 */
export function computeMcpToolPreview(
  pluginName: string,
  mcpServers: Record<string, PluginMcpServer>,
  pluginDisplayName?: string,
): McpToolPreview[] {
  const out: McpToolPreview[] = [];
  const serverCount = Object.keys(mcpServers).length;

  for (const [serverName, config] of Object.entries(mcpServers)) {
    const namespacedKey = `${pluginName}__${serverName}`;
    const serverTier: RiskTier = config.riskTier ?? 'acts';

    // Human label for the catch-all row. Prefer the plugin's display name
    // (e.g. "Home Assistant"); fall back to the technical plugin name. When a
    // plugin ships more than one server, append the server name so the rows
    // stay distinct. The frontend frames this as "All tools from <label>", so
    // the label is just the name, never a redundant "(all tools)" suffix.
    const baseLabel = pluginDisplayName ?? pluginName;
    const dynamicLabel =
      serverCount > 1 ? `${baseLabel} (${serverName})` : baseLabel;

    // Server-level catch-all row (covers dynamically discovered tools).
    out.push({
      toolName: `mcp__${namespacedKey}`,
      displayName: dynamicLabel,
      description: config.description ?? `All of ${baseLabel}'s tools`,
      riskTier: serverTier,
      defaultMode: riskTierToDefaultMode(serverTier),
      dynamic: true,
    });

    // Per-tool rows for statically declared tools.
    for (const t of config.tools ?? []) {
      const toolName = typeof t === 'string' ? t : t.name;
      const toolTier: RiskTier =
        typeof t === 'string' ? serverTier : (t.riskTier ?? serverTier);
      const toolDesc =
        typeof t === 'string' ? undefined : t.description;
      out.push({
        toolName: `mcp__${namespacedKey}__${toolName}`,
        displayName: toolName,
        description: toolDesc ?? `${toolName} (from ${pluginName})`,
        riskTier: toolTier,
        defaultMode: riskTierToDefaultMode(toolTier),
        dynamic: false,
      });
    }
  }

  return out;
}
