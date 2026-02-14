/**
 * Zod schemas for configuration validation.
 *
 * These schemas provide runtime validation and TypeScript type inference
 * for all agent configuration options.
 */

import { z } from 'zod';

// ============================================================================
// Base Schemas
// ============================================================================

/**
 * Agent provider enum schema.
 */
export const agentProviderSchema = z.enum(['claude', 'codex', 'opencode']);

/**
 * Permission config for unified permission model.
 */
export const permissionConfigSchema = z.object({
  /**
   * Execution mode determines what CAN execute.
   * - plan: Read-only analysis mode
   * - build: Full development mode (default)
   */
  executionMode: z.enum(['plan', 'build']).default('build'),

  /**
   * Approval level determines when to ask user.
   * - strict: Maximum safety, approve all modifications
   * - normal: Balanced, approve writes/bash/edits (default)
   * - trusted: Auto-approve edits
   * - none: No prompts (CI/CD mode)
   */
  approvalLevel: z.enum(['strict', 'normal', 'trusted', 'none']).default('normal'),

  /**
   * Tool-specific permission overrides.
   * Keys are tool names, values are permission levels.
   */
  toolPermissions: z.record(z.enum(['allow', 'ask', 'deny'])).optional(),
});

/**
 * MCP server configuration.
 */
export const mcpServerConfigSchema = z.object({
  /** Command to start stdio-based MCP server */
  command: z.string().optional(),

  /** Arguments to pass to command */
  args: z.array(z.string()).optional(),

  /** URL for HTTP-based MCP server */
  url: z.string().url().optional(),

  /** Environment variables for the server */
  env: z.record(z.string()).optional(),
});

/**
 * Hook result schema for pre-execution hooks.
 */
export const hookResultSchema = z.object({
  /** Whether to allow execution (Claude only can block) */
  allow: z.boolean().optional(),

  /** Modified input for the tool (Claude only can modify) */
  modifiedInput: z.unknown().optional(),
});

// ============================================================================
// Base Session Configuration
// ============================================================================

/**
 * Base configuration shared by all providers.
 */
export const baseSessionConfigSchema = z.object({
  /** Which SDK provider to use */
  provider: agentProviderSchema,

  /** Model identifier (provider-specific) */
  model: z.string().optional(),

  /** System prompt to initialize the agent with */
  systemPrompt: z.string().optional(),

  /** Working directory for file operations */
  cwd: z.string().optional(),

  /** Environment variables to pass to the agent */
  env: z.record(z.string()).optional(),

  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeoutMs: z.number().positive().optional(),

  /** Unified permission configuration */
  permissions: permissionConfigSchema.optional(),

  /**
   * MCP server configurations.
   *
   * Values can be standard MCP configs (stdio/HTTP) or opaque SDK-specific
   * objects (e.g., Claude SDK's in-process server from createSdkMcpServer()).
   * We use passthrough() to preserve unknown fields like `type`, `name`, `instance`.
   */
  mcpServers: z.record(z.record(z.unknown())).optional(),

  // Note: hooks are not validated with Zod since they contain functions
});

// ============================================================================
// Provider-Specific Configurations
// ============================================================================

/**
 * Claude-specific configuration options.
 */
export const claudeConfigSchema = baseSessionConfigSchema.extend({
  provider: z.literal('claude'),

  /** Maximum number of agentic turns */
  maxTurns: z.number().positive().optional(),

  /** Maximum budget in USD */
  maxBudgetUsd: z.number().positive().optional(),

  /** Maximum thinking tokens for extended thinking */
  maxThinkingTokens: z.number().positive().optional(),

  /** Session ID to resume */
  resume: z.string().optional(),

  /** Whether to fork the session instead of continue */
  forkSession: z.boolean().optional(),

  /** List of allowed tool names */
  allowedTools: z.array(z.string()).optional(),

  /** List of disallowed tool names */
  disallowedTools: z.array(z.string()).optional(),

  /** Include partial messages for streaming */
  includePartialMessages: z.boolean().optional(),

  /** Output format for structured responses (constrained decoding) */
  outputFormat: z.object({
    type: z.literal('json_schema'),
    schema: z.record(z.unknown()),
  }).optional(),
});

/**
 * Codex-specific configuration options.
 */
export const codexConfigSchema = baseSessionConfigSchema.extend({
  provider: z.literal('codex'),

  /** Working directory override */
  workingDirectory: z.string().optional(),

  /** Skip git repository check */
  skipGitRepoCheck: z.boolean().optional(),

  /** Thread ID to resume */
  resume: z.string().optional(),
});

/**
 * OpenCode-specific configuration options.
 */
export const opencodeConfigSchema = baseSessionConfigSchema.extend({
  provider: z.literal('opencode'),

  /** Server hostname (default: 127.0.0.1) */
  hostname: z.string().optional(),

  /** Server port (default: 4096) */
  port: z.number().positive().optional(),

  /** Session ID to resume */
  resume: z.string().optional(),
});

/**
 * Discriminated union of all provider configurations.
 *
 * Use this schema to validate any session configuration.
 */
export const agentSessionConfigSchema = z.discriminatedUnion('provider', [
  claudeConfigSchema,
  codexConfigSchema,
  opencodeConfigSchema,
]);

// ============================================================================
// Type Inference
// ============================================================================

export type PermissionConfig = z.infer<typeof permissionConfigSchema>;
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;
export type HookResult = z.infer<typeof hookResultSchema>;
export type ClaudeConfig = z.infer<typeof claudeConfigSchema>;
export type CodexConfig = z.infer<typeof codexConfigSchema>;
export type OpenCodeConfig = z.infer<typeof opencodeConfigSchema>;
export type AgentSessionConfigUnion = z.infer<typeof agentSessionConfigSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate configuration and return typed result.
 *
 * @throws ZodError if validation fails
 */
export function validateConfig(config: unknown): AgentSessionConfigUnion {
  return agentSessionConfigSchema.parse(config);
}

/**
 * Safely validate configuration, returning null on failure.
 */
export function safeValidateConfig(
  config: unknown,
): AgentSessionConfigUnion | null {
  const result = agentSessionConfigSchema.safeParse(config);
  return result.success ? result.data : null;
}

/**
 * Get validation errors for a configuration.
 */
export function getConfigErrors(config: unknown): string[] {
  const result = agentSessionConfigSchema.safeParse(config);
  if (result.success) return [];

  return result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
}
