import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { z as z3 } from 'zod/v3';
import { zodToTypebox } from '../../src/schema-converter.js';

describe('zodToTypebox', () => {
  it('converts a Zod object schema to a TypeBox schema with correct JSON Schema', async () => {
    const zodSchema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = await zodToTypebox(zodSchema);

    expect(result).toBeDefined();
    expect(result.type).toBe('object');
    expect(result.properties).toBeDefined();
    expect(result.properties.name).toEqual({ type: 'string' });
    expect(result.properties.age).toEqual({ type: 'number' });
    expect(result.required).toContain('name');
    expect(result.required).toContain('age');
  });

  it('converts a Zod string schema', async () => {
    const zodSchema = z.string();
    const result = await zodToTypebox(zodSchema);
    expect(result.type).toBe('string');
  });

  it('converts a Zod v3 schema via zod-to-json-schema', async () => {
    const zodSchema = z3.object({
      legacy: z3.string(),
      count: z3.number(),
    });

    const result = await zodToTypebox(zodSchema);

    expect(result.type).toBe('object');
    expect(result.properties.legacy).toEqual({ type: 'string' });
    expect(result.properties.count).toEqual({ type: 'number' });
    expect(result.required).toEqual(expect.arrayContaining(['legacy', 'count']));
  });

  it('converts a Zod number schema', async () => {
    const zodSchema = z.number();
    const result = await zodToTypebox(zodSchema);
    expect(result.type).toBe('number');
  });

  it('converts a Zod schema with optional fields', async () => {
    const zodSchema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });

    const result = await zodToTypebox(zodSchema);

    expect(result.type).toBe('object');
    expect(result.required).toContain('required');
    if (result.required) {
      expect(result.required).not.toContain('optional');
    }
  });

  it('converts a Zod schema with nested objects', async () => {
    const zodSchema = z.object({
      user: z.object({
        name: z.string(),
        email: z.string(),
      }),
    });

    const result = await zodToTypebox(zodSchema);

    expect(result.type).toBe('object');
    expect(result.properties.user).toBeDefined();
    expect(result.properties.user.type).toBe('object');
    expect(result.properties.user.properties.name).toEqual({ type: 'string' });
    expect(result.properties.user.properties.email).toEqual({ type: 'string' });
  });

  it('converts a Zod array schema', async () => {
    const zodSchema = z.array(z.string());
    const result = await zodToTypebox(zodSchema);

    expect(result.type).toBe('array');
    expect(result.items).toEqual({ type: 'string' });
  });

  it('produces valid JSON Schema intermediate representation', async () => {
    const zodSchema = z.object({
      id: z.string(),
      count: z.number(),
      tags: z.array(z.string()),
      active: z.boolean(),
    });

    const result = await zodToTypebox(zodSchema);

    expect(result.type).toBe('object');
    expect(result.properties.id.type).toBe('string');
    expect(result.properties.count.type).toBe('number');
    expect(result.properties.tags.type).toBe('array');
    expect(result.properties.active.type).toBe('boolean');
    expect(result.required).toEqual(
      expect.arrayContaining(['id', 'count', 'tags', 'active']),
    );
  });
});
