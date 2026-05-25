/**
 * Self-managed environment schemas — the entity's persistent, self-owned
 * working environment (its "workshop").
 *
 * The manifest is stored as JSON at `$DATA_DIR/agent-env/environment.json`
 * and merged into the backend process environment at startup. Because the
 * Cortex bash tool rebuilds its sanitized env from `process.env` on every
 * command, registering a path here makes it effective for the next command
 * and persistent across restarts.
 *
 * See docs/research/self-managed-environment.md
 */

import { z } from 'zod/v3';

/**
 * A tool the entity has installed or discovered and registered.
 */
export const environmentToolSchema = z.object({
  /** Logical name (e.g. "node", "ripgrep"). */
  name: z.string(),
  /** Directory containing the tool's binary; added to PATH. */
  binDir: z.string(),
  /** Optional version string for display/audit. */
  version: z.string().optional(),
  /** Where the tool was obtained (URL or description) for audit. */
  source: z.string().optional(),
  /** Optional checksum recorded at install time. */
  sha256: z.string().optional(),
  /** ISO timestamp when registered. */
  registeredAt: z.string(),
});

/**
 * The environment overlay manifest. Declarative, inspectable, and owned by
 * the entity. `${AGENT_ENV}` in any value resolves to the agent-env directory.
 */
export const environmentManifestSchema = z.object({
  version: z.literal(1).default(1),
  /** Directories prepended to PATH (the entity's deliberate toolchain). */
  pathAdditions: z.array(z.string()).default([]),
  /** Allowlisted environment variables (denylisted/sensitive vars rejected). */
  envVars: z.record(z.string()).default({}),
  /** Registered tools, keyed by logical name. */
  tools: z.record(environmentToolSchema).default({}),
});

export type EnvironmentTool = z.infer<typeof environmentToolSchema>;
export type EnvironmentManifest = z.infer<typeof environmentManifestSchema>;
