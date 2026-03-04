/**
 * Tool definition tests — validates that all tool schemas are MCP-compliant.
 *
 * The MCP protocol requires tool input schemas to produce `{ type: "object" }`
 * at the JSON Schema root. Zod types like discriminatedUnion() and union()
 * produce `anyOf`/`oneOf` instead, which causes the Claude SDK to silently
 * drop the entire MCP server's tools. This test catches that at CI time.
 */

import { describe, it, expect } from 'vitest';
import { ANIMUS_TOOL_DEFS } from '../src/tools/definitions.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

describe('tool definitions', () => {
  describe('MCP schema compliance', () => {
    for (const [name, def] of Object.entries(ANIMUS_TOOL_DEFS)) {
      it(`${name} inputSchema produces type: "object" at root`, () => {
        const schema = zodToJsonSchema(def.inputSchema, { target: 'openApi3' }) as Record<string, unknown>;
        expect(schema.type).toBe('object');
      });
    }
  });

  it('all tool names are unique', () => {
    const names = Object.values(ANIMUS_TOOL_DEFS).map(d => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all tools have a description', () => {
    for (const [name, def] of Object.entries(ANIMUS_TOOL_DEFS)) {
      expect(def.description.length, `${name} should have a description`).toBeGreaterThan(0);
    }
  });

  it('all tools have a category', () => {
    for (const [name, def] of Object.entries(ANIMUS_TOOL_DEFS)) {
      expect(def.category, `${name} should have a category`).toBeTruthy();
    }
  });
});
