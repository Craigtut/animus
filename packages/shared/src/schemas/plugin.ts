/**
 * Schemas for the plugin system.
 *
 * Defines plugin manifest, component schemas (agents, context sources,
 * hooks, custom decisions, triggers, MCP servers), and the plugin
 * database record shape.
 */

import { z } from 'zod/v3';

// ============================================================================
// Plugin Manifest
// ============================================================================

export const PluginManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  displayName: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  description: z.string().max(200),
  author: z.object({
    name: z.string(),
    url: z.string().url().optional(),
  }),
  license: z.string().optional(),
  engine: z.string().optional(),
  icon: z.string().optional(), // relative path to icon file (SVG or PNG)

  components: z.object({
    skills: z.string().optional(),
    tools: z.string().optional(),
    context: z.string().optional(),
    hooks: z.string().optional(),
    decisions: z.string().optional(),
    triggers: z.string().optional(),
    agents: z.string().optional(),
  }),

  dependencies: z.object({
    plugins: z.array(z.string()).default([]),
    system: z.record(z.string()).default({}),
  }).default({}),

  permissions: z.object({
    tools: z.array(z.string()).default([]),
    network: z.boolean().default(false),
    filesystem: z.enum(['none', 'read-only', 'read-write']).default('none'),
    contacts: z.boolean().default(false),
    memory: z.enum(['none', 'read-only', 'read-write']).default('none'),
  }).default({}),

  configSchema: z.string().optional(), // path to config.schema.json (uses same field format as channels)
  setup: z.string().optional(),

  store: z.object({
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    pricing: z.enum(['free', 'paid', 'subscription']).default('free'),
    screenshots: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
  }).optional(),
});

// ============================================================================
// Agent Frontmatter
// ============================================================================

export const AgentFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string().max(200),
  tools: z.array(z.string()).default([]),
  maxTurns: z.number().positive().optional(),
});

// ============================================================================
// Context Sources
// ============================================================================

export const ContextSourceSchema = z.object({
  name: z.string(),
  description: z.string().max(200),
  type: z.enum(['static', 'retrieval']),
  maxTokens: z.number().positive(),
  priority: z.number().min(1).max(10).default(5),
  provider: z.object({
    command: z.string(),
    args: z.array(z.string()).default([]),
  }).optional(),
  content: z.string().optional(),
});

// ============================================================================
// Hooks
// ============================================================================

export const HookDefinitionSchema = z.object({
  event: z.enum([
    'preTick', 'postTick',
    'preDecision', 'postDecision',
    'preSubAgent', 'postSubAgent',
    'preMessage', 'postMessage',
    'onPluginInstall', 'onPluginRemove',
  ]),
  matcher: z.record(z.unknown()).optional(),
  handler: z.object({
    type: z.literal('command'),
    command: z.string(),
  }),
});

// ============================================================================
// Custom Decision Types
// ============================================================================

export const DecisionTypeSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/),
  description: z.string().max(500),
  payloadSchema: z.record(z.unknown()),
  handler: z.object({
    type: z.literal('command'),
    command: z.string(),
  }),
  contactTier: z.enum(['primary', 'standard']).default('primary'),
});

// ============================================================================
// Custom Triggers
// ============================================================================

export const TriggerDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z0-9_-]+$/),
  description: z.string().max(200),
  type: z.enum(['http', 'watcher']),
  config: z.object({
    path: z.string().optional(),
    methods: z.array(z.string()).default(['POST']),
    command: z.string().optional(),
    interval: z.number().optional(),
  }),
});

// ============================================================================
// MCP Server Config
// ============================================================================

export const PluginMcpServerSchema = z.object({
  // Transport type (inferred from fields if omitted)
  type: z.enum(['stdio', 'http']).optional(),
  // Stdio transport
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  // HTTP transport
  url: z.string().optional(),
  headers: z.record(z.string()).default({}),
  // Common
  description: z.string().optional(),
  tools: z.array(z.string()).optional(),
}).refine(
  (data) => data.command || data.url,
  { message: 'Either "command" (stdio) or "url" (http) must be provided' },
);

// ============================================================================
// Plugin Record (DB row shape)
// ============================================================================

export const pluginSourceSchema = z.enum(['built-in', 'local', 'git', 'npm', 'store', 'package']);

export const pluginStatusSchema = z.enum(['active', 'disabled', 'unconfigured', 'error']);

export const PluginRecordSchema = z.object({
  name: z.string(),
  version: z.string(),
  path: z.string(),
  enabled: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  source: pluginSourceSchema,
  storeId: z.string().nullable(),
  configEncrypted: z.string().nullable(),
  status: pluginStatusSchema.default('active'),
  lastError: z.string().nullable().default(null),
});

// Types are derived and exported from types/index.ts via z.infer<>.
