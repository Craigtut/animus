/**
 * Schema conversion utility: Zod -> JSON Schema -> TypeBox.
 *
 * Pi-agent-core uses TypeBox + AJV for tool parameter schemas.
 * Consumer code continues using Zod. This module bridges the gap
 * at the tool registration boundary.
 *
 * One-way conversion. Built-in tools (Bash, Read, Write) use TypeBox
 * directly since they are defined within Cortex.
 *
 * Uses zod v4's built-in `toJSONSchema()` for the Zod -> JSON Schema step.
 * The third-party `zod-to-json-schema` library does not work with zod v4
 * schemas (returns empty output), so we use the native converter instead.
 */

import { toJSONSchema, type ZodType } from 'zod';
import { Type, type TSchema } from '@sinclair/typebox';

/**
 * Convert a Zod schema to a TypeBox TSchema via JSON Schema intermediate.
 *
 * Uses zod v4's built-in `toJSONSchema()` to produce a JSON Schema object,
 * then wraps it with `Type.Unsafe()` so AJV can validate against it.
 *
 * @param zodSchema - Any Zod schema (z.object, z.string, etc.)
 * @returns A TypeBox TSchema suitable for pi-agent-core AgentTool definitions
 */
export function zodToTypebox(zodSchema: ZodType): TSchema {
  const jsonSchema = toJSONSchema(zodSchema);
  // Type.Unsafe wraps a raw JSON Schema object as a TSchema.
  // Cast needed because toJSONSchema's return type (JSONSchema) has optional
  // properties that conflict with exactOptionalPropertyTypes in TypeBox's
  // UnsafeOptions type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Type.Unsafe(jsonSchema as any);
}
