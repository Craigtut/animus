/**
 * System Store — data access for system.db
 *
 * Tables: users, contacts, contact_channels, channel_configs,
 *         system_settings, personality_settings, api_keys
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus/shared';
import type {
  User,
  Contact,
  ContactChannel,
  SystemSettings,
  PersonalitySettings,
  ChannelType,
  PermissionTier,
  OnboardingState,
  Persona,
  ChannelConfig,
  ChannelConfigType,
} from '@animus/shared';
import { snakeToCamel, boolToInt, intToBool } from '../utils.js';

// ============================================================================
// Users
// ============================================================================

export function createUser(
  db: Database.Database,
  data: { email: string; passwordHash: string }
): User {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, data.email, data.passwordHash, timestamp, timestamp);
  return { id, email: data.email, contactId: null, createdAt: timestamp, updatedAt: timestamp };
}

export function getUserByEmail(db: Database.Database, email: string): User | null {
  const row = db
    .prepare('SELECT id, email, contact_id, created_at, updated_at FROM users WHERE email = ?')
    .get(email) as Record<string, unknown> | undefined;
  return row ? snakeToCamel<User>(row) : null;
}

export function getUserById(db: Database.Database, id: string): User | null {
  const row = db
    .prepare('SELECT id, email, contact_id, created_at, updated_at FROM users WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? snakeToCamel<User>(row) : null;
}

export function getUserCount(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  return row.count;
}

export function getPasswordHash(db: Database.Database, email: string): string | null {
  const row = db
    .prepare('SELECT password_hash FROM users WHERE email = ?')
    .get(email) as { password_hash: string } | undefined;
  return row?.password_hash ?? null;
}

export function updateUserContactId(
  db: Database.Database,
  userId: string,
  contactId: string
): void {
  db.prepare('UPDATE users SET contact_id = ?, updated_at = ? WHERE id = ?').run(
    contactId,
    now(),
    userId
  );
}

// ============================================================================
// Contacts
// ============================================================================

interface NewContact {
  fullName: string;
  userId?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  isPrimary?: boolean;
  permissionTier?: PermissionTier;
  notes?: string | null;
}

export function createContact(db: Database.Database, data: NewContact): Contact {
  const id = generateUUID();
  const timestamp = now();
  const isPrimary = data.isPrimary ?? false;
  const tier = data.permissionTier ?? (isPrimary ? 'primary' : 'standard');
  db.prepare(
    `INSERT INTO contacts (id, user_id, full_name, phone_number, email, is_primary, permission_tier, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.userId ?? null,
    data.fullName,
    data.phoneNumber ?? null,
    data.email ?? null,
    boolToInt(isPrimary),
    tier,
    data.notes ?? null,
    timestamp,
    timestamp
  );
  return {
    id,
    userId: data.userId ?? null,
    fullName: data.fullName,
    phoneNumber: data.phoneNumber ?? null,
    email: data.email ?? null,
    isPrimary,
    permissionTier: tier,
    notes: data.notes ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function rowToContact(row: Record<string, unknown>): Contact {
  const c = snakeToCamel<Contact & { isPrimary: number }>(row);
  return { ...c, isPrimary: intToBool(c.isPrimary as unknown as number) };
}

export function getContact(db: Database.Database, id: string): Contact | null {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToContact(row) : null;
}

export function getContactByUserId(db: Database.Database, userId: string): Contact | null {
  const row = db.prepare('SELECT * FROM contacts WHERE user_id = ?').get(userId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToContact(row) : null;
}

export function getPrimaryContact(db: Database.Database): Contact | null {
  const row = db.prepare('SELECT * FROM contacts WHERE is_primary = 1 LIMIT 1').get() as
    | Record<string, unknown>
    | undefined;
  return row ? rowToContact(row) : null;
}

export function listContacts(db: Database.Database): Contact[] {
  const rows = db.prepare('SELECT * FROM contacts ORDER BY created_at').all() as Array<
    Record<string, unknown>
  >;
  return rows.map(rowToContact);
}

export function updateContact(
  db: Database.Database,
  id: string,
  data: Partial<Pick<Contact, 'fullName' | 'phoneNumber' | 'email' | 'notes' | 'permissionTier'>>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.fullName !== undefined) {
    fields.push('full_name = ?');
    values.push(data.fullName);
  }
  if (data.phoneNumber !== undefined) {
    fields.push('phone_number = ?');
    values.push(data.phoneNumber);
  }
  if (data.email !== undefined) {
    fields.push('email = ?');
    values.push(data.email);
  }
  if (data.notes !== undefined) {
    fields.push('notes = ?');
    values.push(data.notes);
  }
  if (data.permissionTier !== undefined) {
    fields.push('permission_tier = ?');
    values.push(data.permissionTier);
  }
  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(now());
  values.push(id);
  db.prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

// ============================================================================
// Contact Channels
// ============================================================================

export function createContactChannel(
  db: Database.Database,
  data: { contactId: string; channel: ChannelType; identifier: string; displayName?: string | null }
): ContactChannel {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO contact_channels (id, contact_id, channel, identifier, display_name, is_verified, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(id, data.contactId, data.channel, data.identifier, data.displayName ?? null, timestamp);
  return {
    id,
    contactId: data.contactId,
    channel: data.channel,
    identifier: data.identifier,
    displayName: data.displayName ?? null,
    isVerified: false,
    createdAt: timestamp,
  };
}

export function getContactChannelsByContactId(
  db: Database.Database,
  contactId: string
): ContactChannel[] {
  const rows = db
    .prepare('SELECT * FROM contact_channels WHERE contact_id = ?')
    .all(contactId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const ch = snakeToCamel<ContactChannel & { isVerified: number }>(row);
    return { ...ch, isVerified: intToBool(ch.isVerified as unknown as number) };
  });
}

export function resolveContactByChannel(
  db: Database.Database,
  channel: ChannelType,
  identifier: string
): Contact | null {
  const row = db
    .prepare(
      `SELECT c.* FROM contacts c
       JOIN contact_channels cc ON cc.contact_id = c.id
       WHERE cc.channel = ? AND cc.identifier = ?`
    )
    .get(channel, identifier) as Record<string, unknown> | undefined;
  return row ? rowToContact(row) : null;
}

export function deleteContact(db: Database.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  return result.changes > 0;
}

export function deleteContactChannel(db: Database.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM contact_channels WHERE id = ?').run(id);
  return result.changes > 0;
}

// ============================================================================
// System Settings (singleton)
// ============================================================================

export function getSystemSettings(db: Database.Database): SystemSettings {
  const row = db.prepare('SELECT * FROM system_settings WHERE id = 1').get() as Record<
    string,
    unknown
  >;
  const s = snakeToCamel<SystemSettings & { id: number; updatedAt: string }>(row);
  // Strip singleton id and updatedAt (not in schema)
  const { id: _id, updatedAt: _ua, ...settings } = s;
  return settings as unknown as SystemSettings;
}

export function updateSystemSettings(
  db: Database.Database,
  data: Partial<SystemSettings>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  const mapping: Record<string, string> = {
    heartbeatIntervalMs: 'heartbeat_interval_ms',
    sessionWarmthMs: 'session_warmth_ms',
    sessionContextBudget: 'session_context_budget',
    thoughtRetentionDays: 'thought_retention_days',
    experienceRetentionDays: 'experience_retention_days',
    emotionHistoryRetentionDays: 'emotion_history_retention_days',
    agentLogRetentionDays: 'agent_log_retention_days',
    defaultAgentProvider: 'default_agent_provider',
    goalApprovalMode: 'goal_approval_mode',
    timezone: 'timezone',
  };

  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    const value = (data as Record<string, unknown>)[camelKey];
    if (value !== undefined) {
      fields.push(`${snakeKey} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(now());
  db.prepare(`UPDATE system_settings SET ${fields.join(', ')} WHERE id = 1`).run(...values);
}

// ============================================================================
// Onboarding State (on system_settings singleton)
// ============================================================================

export function getOnboardingState(db: Database.Database): OnboardingState {
  const row = db.prepare(
    'SELECT onboarding_step, onboarding_complete FROM system_settings WHERE id = 1'
  ).get() as { onboarding_step: number; onboarding_complete: number } | undefined;
  if (!row) return { currentStep: 0, isComplete: false };
  return {
    currentStep: row.onboarding_step,
    isComplete: intToBool(row.onboarding_complete),
  };
}

export function updateOnboardingState(
  db: Database.Database,
  data: { currentStep?: number; isComplete?: boolean }
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.currentStep !== undefined) {
    fields.push('onboarding_step = ?');
    values.push(data.currentStep);
  }
  if (data.isComplete !== undefined) {
    fields.push('onboarding_complete = ?');
    values.push(boolToInt(data.isComplete));
  }
  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(now());
  db.prepare(`UPDATE system_settings SET ${fields.join(', ')} WHERE id = 1`).run(...values);
}

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
// API Keys
// ============================================================================

export function getApiKey(db: Database.Database, provider: string): string | null {
  const row = db
    .prepare('SELECT encrypted_key FROM api_keys WHERE provider = ?')
    .get(provider) as { encrypted_key: string } | undefined;
  return row?.encrypted_key ?? null;
}

export function setApiKey(db: Database.Database, provider: string, encryptedKey: string): void {
  const existing = db
    .prepare('SELECT id FROM api_keys WHERE provider = ?')
    .get(provider) as { id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE api_keys SET encrypted_key = ?, updated_at = ? WHERE provider = ?').run(
      encryptedKey,
      now(),
      provider
    );
  } else {
    db.prepare(
      'INSERT INTO api_keys (id, provider, encrypted_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(generateUUID(), provider, encryptedKey, now(), now());
  }
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

// ============================================================================
// Channel Configs
// ============================================================================

function rowToChannelConfig(row: Record<string, unknown>): ChannelConfig {
  return {
    id: row['id'] as string,
    channelType: row['channel_type'] as ChannelConfigType,
    isEnabled: intToBool(row['is_enabled'] as number),
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

export function getChannelConfigs(db: Database.Database): ChannelConfig[] {
  const rows = db.prepare('SELECT * FROM channel_configs ORDER BY channel_type').all() as Array<
    Record<string, unknown>
  >;
  return rows.map(rowToChannelConfig);
}

export function getChannelConfig(
  db: Database.Database,
  channelType: ChannelConfigType
): (ChannelConfig & { config: string }) | null {
  const row = db
    .prepare('SELECT * FROM channel_configs WHERE channel_type = ?')
    .get(channelType) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...rowToChannelConfig(row),
    config: row['config'] as string,
  };
}

export function upsertChannelConfig(
  db: Database.Database,
  data: {
    channelType: ChannelConfigType;
    config: string;
    isEnabled?: boolean;
  }
): ChannelConfig {
  const existing = db
    .prepare('SELECT id FROM channel_configs WHERE channel_type = ?')
    .get(data.channelType) as { id: string } | undefined;

  const timestamp = now();
  if (existing) {
    const fields: string[] = ['config = ?', 'updated_at = ?'];
    const values: unknown[] = [data.config, timestamp];
    if (data.isEnabled !== undefined) {
      fields.push('is_enabled = ?');
      values.push(boolToInt(data.isEnabled));
    }
    values.push(existing.id);
    db.prepare(`UPDATE channel_configs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const row = db.prepare('SELECT * FROM channel_configs WHERE id = ?').get(existing.id) as Record<string, unknown>;
    return rowToChannelConfig(row);
  } else {
    const id = generateUUID();
    db.prepare(
      `INSERT INTO channel_configs (id, channel_type, config, is_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, data.channelType, data.config, boolToInt(data.isEnabled ?? false), timestamp, timestamp);
    return {
      id,
      channelType: data.channelType,
      isEnabled: data.isEnabled ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}
