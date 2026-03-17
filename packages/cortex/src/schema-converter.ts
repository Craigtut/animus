/**
 * Schema conversion utility: Zod -> JSON Schema -> TypeBox.
 *
 * Pi-agent-core uses TypeBox + AJV for tool parameter schemas.
 * Consumer code continues using Zod. This module bridges the gap
 * at the tool registration boundary.
 *
 * Handles BOTH Zod v3 schemas (used by @animus-labs/shared tools)
 * and Zod v4 schemas. Zod v3 schemas use `zod-to-json-schema`,
 * Zod v4 schemas use the native `toJSONSchema()`.
 */

import { Type, type TSchema } from '@sinclair/typebox';

/**
 * Check if a schema is a Zod v3 schema (has _def property).
 */
function isZodV3(schema: unknown): boolean {
  if (schema == null || typeof schema !== 'object') return false;
  // Zod v3 schemas have _def but NOT _zod (which is a v4 marker)
  const obj = schema as Record<string, unknown>;
  return '_def' in obj && typeof obj['_def'] === 'object' && !('_zod' in obj);
}

/**
 * Convert a Zod schema (v3 or v4) to a TypeBox TSchema via JSON Schema.
 *
 * @param zodSchema - Any Zod schema (z.object, z.string, etc.)
 * @returns A TypeBox TSchema suitable for pi-agent-core AgentTool definitions
 */
export function zodToTypebox(zodSchema: unknown): TSchema {
  if (!zodSchema || typeof zodSchema !== 'object') {
    throw new Error(`zodToTypebox: received invalid schema: ${typeof zodSchema}`);
  }

  let jsonSchema: unknown;

  if (isZodV3(zodSchema)) {
    // Zod v3: use zod-to-json-schema (works with v3's _def structure)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { zodToJsonSchema } = require('zod-to-json-schema') as { zodToJsonSchema: (s: unknown) => unknown };
    jsonSchema = zodToJsonSchema(zodSchema);
  } else {
    // Zod v4: use native toJSONSchema
    const { toJSONSchema } = require('zod') as { toJSONSchema: (s: unknown) => unknown };
    jsonSchema = toJSONSchema(zodSchema);
  }

  // Type.Unsafe wraps a raw JSON Schema object as a TSchema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Type.Unsafe(jsonSchema as any);
}
