/**
 * Persona Store — data access for persona.db
 *
 * Tables: personality_settings
 */

import type Database from 'better-sqlite3';
import { now } from '@animus-labs/shared';
import type { PersonalitySettings, Persona } from '@animus-labs/shared';
import { intToBool } from '../utils.js';

// ============================================================================
// Personality Settings (singleton)
// ============================================================================

export function getPersonalitySettings(db: Database.Database): PersonalitySettings {
  const row = db.prepare('SELECT * FROM personality_settings WHERE id = 1').get() as Record<
    string,
    unknown
  >;
  return {
    name: row['name'] as string,
    traits: JSON.parse(row['traits'] as string) as string[],
    communicationStyle: row['communication_style'] as string,
    values: JSON.parse(row['values'] as string) as string[],
  };
}

export function updatePersonalitySettings(
  db: Database.Database,
  data: Partial<PersonalitySettings>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.name !== undefined) {
    fields.push('name = ?');
    values.push(data.name);
  }
  if (data.traits !== undefined) {
    fields.push('traits = ?');
    values.push(JSON.stringify(data.traits));
  }
  if (data.communicationStyle !== undefined) {
    fields.push('communication_style = ?');
    values.push(data.communicationStyle);
  }
  if (data.values !== undefined) {
    fields.push('"values" = ?');
    values.push(JSON.stringify(data.values));
  }
  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(now());
  db.prepare(`UPDATE personality_settings SET ${fields.join(', ')} WHERE id = 1`).run(...values);
}

// ============================================================================
// Persona (expanded personality_settings)
// ============================================================================

const DEFAULT_DIMENSIONS = JSON.stringify({
  extroversion: 0.5,
  trust: 0.5,
  leadership: 0.5,
  optimism: 0.5,
  confidence: 0.5,
  empathy: 0.5,
  cautious: 0.5,
  patience: 0.5,
  orderly: 0.5,
  altruism: 0.5,
});

export function getPersona(db: Database.Database): Persona {
  const row = db.prepare('SELECT * FROM personality_settings WHERE id = 1').get() as Record<
    string,
    unknown
  >;
  return {
    name: (row['name'] as string) || 'Animus',
    existenceParadigm: (row['existence_paradigm'] as Persona['existenceParadigm']) || 'digital_consciousness',
    location: (row['location'] as string) || null,
    worldDescription: (row['world_description'] as string) || null,
    gender: (row['gender'] as string) || null,
    age: (row['age'] as number) || null,
    physicalDescription: (row['physical_description'] as string) || null,
    personalityDimensions: {
      ...JSON.parse(DEFAULT_DIMENSIONS),
      ...JSON.parse((row['personality_dimensions'] as string) || '{}'),
    },
    traits: JSON.parse((row['traits'] as string) || '[]'),
    values: JSON.parse((row['"values"'] as string) || (row['values'] as string) || '[]'),
    background: (row['background'] as string) || null,
    personalityNotes: (row['personality_notes'] as string) || null,
    archetype: (row['archetype'] as Persona['archetype']) || null,
    voiceId: (row['voice_id'] as string) || null,
    voiceSpeed: (row['voice_speed'] as number) ?? 1.0,
    isFinalized: intToBool((row['is_finalized'] as number) || 0),
    communicationStyle: (row['communication_style'] as string) || undefined,
  };
}

export function savePersonaDraft(
  db: Database.Database,
  data: Partial<Omit<Persona, 'isFinalized' | 'communicationStyle'>>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  const mapping: Record<string, string> = {
    name: 'name',
    existenceParadigm: 'existence_paradigm',
    location: 'location',
    worldDescription: 'world_description',
    gender: 'gender',
    age: 'age',
    physicalDescription: 'physical_description',
    background: 'background',
    personalityNotes: 'personality_notes',
    archetype: 'archetype',
    voiceId: 'voice_id',
    voiceSpeed: 'voice_speed',
  };

  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    const value = (data as Record<string, unknown>)[camelKey];
    if (value !== undefined) {
      fields.push(`${snakeKey} = ?`);
      values.push(value);
    }
  }

  // JSON fields
  if (data.personalityDimensions !== undefined) {
    fields.push('personality_dimensions = ?');
    values.push(JSON.stringify(data.personalityDimensions));
  }
  if (data.traits !== undefined) {
    fields.push('traits = ?');
    values.push(JSON.stringify(data.traits));
  }
  if (data.values !== undefined) {
    fields.push('"values" = ?');
    values.push(JSON.stringify(data.values));
  }

  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(now());
  db.prepare(`UPDATE personality_settings SET ${fields.join(', ')} WHERE id = 1`).run(...values);
}

export function finalizePersona(db: Database.Database): void {
  db.prepare(
    'UPDATE personality_settings SET is_finalized = 1, updated_at = ? WHERE id = 1'
  ).run(now());
}
