/**
 * System Store — data access for system.db
 *
 * Tables: users, contacts, contact_channels, channel_packages,
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
  ChannelPackage,
  ChannelPackageStatus,
} from '@animus/shared';
import { snakeToCamel, boolToInt, intToBool } from '../utils.js';
import { encrypt, decrypt } from '../../lib/encryption-service.js';

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

/**
 * Delete all contact_channels for a given channel type.
 * Used during channel uninstall to clean up identity mappings.
 */
export function deleteContactChannelsByChannel(db: Database.Database, channel: string): number {
  const result = db.prepare('DELETE FROM contact_channels WHERE channel = ?').run(channel);
  return result.changes;
}

// ============================================================================
// System Settings (singleton)
// ============================================================================

export function getSystemSettings(db: Database.Database): SystemSettings {
  const row = db.prepare('SELECT * FROM system_settings WHERE id = 1').get() as Record<
    string,
    unknown
  >;
  const s = snakeToCamel<Record<string, unknown>>(row);
  // Strip singleton id and updatedAt (not in schema), convert booleans
  const { id: _id, updatedAt: _ua, ...rest } = s;
  return {
    ...rest,
    energySystemEnabled: intToBool(rest['energySystemEnabled'] as number),
  } as SystemSettings;
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
    energySystemEnabled: 'energy_system_enabled',
    sleepStartHour: 'sleep_start_hour',
    sleepEndHour: 'sleep_end_hour',
    sleepTickIntervalMs: 'sleep_tick_interval_ms',
  };

  // Boolean fields need int conversion
  const booleanFields = new Set(['energySystemEnabled']);

  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    const value = (data as Record<string, unknown>)[camelKey];
    if (value !== undefined) {
      fields.push(`${snakeKey} = ?`);
      values.push(booleanFields.has(camelKey) ? boolToInt(value as boolean) : value);
    }
  }

  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(now());
  db.prepare(`UPDATE system_settings SET ${fields.join(', ')} WHERE id = 1`).run(...values);
}

// ============================================================================
// Log Categories
// ============================================================================

export function getLogCategories(db: Database.Database): Record<string, boolean> {
  const row = db
    .prepare('SELECT log_categories FROM system_settings WHERE id = 1')
    .get() as { log_categories: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.log_categories) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function updateLogCategories(
  db: Database.Database,
  categories: Record<string, boolean>
): Record<string, boolean> {
  const existing = getLogCategories(db);
  const merged = { ...existing, ...categories };
  db.prepare('UPDATE system_settings SET log_categories = ?, updated_at = ? WHERE id = 1').run(
    JSON.stringify(merged),
    now()
  );
  return merged;
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
// Credentials (multi-type, encrypted)
// ============================================================================

interface CredentialRow {
  id: string;
  provider: string;
  credential_type: string;
  encrypted_data: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface Credential {
  id: string;
  provider: string;
  credentialType: string;
  data: string; // decrypted
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialMetadata {
  provider: string;
  credentialType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export function saveCredential(
  db: Database.Database,
  provider: string,
  credentialType: string,
  data: string,
  metadata?: Record<string, unknown>
): void {
  const encrypted = encrypt(data);
  const metaJson = metadata ? JSON.stringify(metadata) : null;
  const timestamp = now();
  const existing = db
    .prepare('SELECT id FROM credentials WHERE provider = ? AND credential_type = ?')
    .get(provider, credentialType) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE credentials SET encrypted_data = ?, metadata = ?, updated_at = ? WHERE id = ?'
    ).run(encrypted, metaJson, timestamp, existing.id);
  } else {
    db.prepare(
      `INSERT INTO credentials (id, provider, credential_type, encrypted_data, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(generateUUID(), provider, credentialType, encrypted, metaJson, timestamp, timestamp);
  }
}

export function getCredential(
  db: Database.Database,
  provider: string,
  credentialType?: string
): Credential | null {
  let row: CredentialRow | undefined;
  if (credentialType) {
    row = db
      .prepare('SELECT * FROM credentials WHERE provider = ? AND credential_type = ?')
      .get(provider, credentialType) as CredentialRow | undefined;
  } else {
    row = db
      .prepare('SELECT * FROM credentials WHERE provider = ? LIMIT 1')
      .get(provider) as CredentialRow | undefined;
  }
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    credentialType: row.credential_type,
    data: decrypt(row.encrypted_data),
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAllCredentials(db: Database.Database): Credential[] {
  const rows = db.prepare('SELECT * FROM credentials').all() as CredentialRow[];
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    credentialType: row.credential_type,
    data: decrypt(row.encrypted_data),
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function deleteCredential(
  db: Database.Database,
  provider: string,
  credentialType?: string
): boolean {
  let result;
  if (credentialType) {
    result = db
      .prepare('DELETE FROM credentials WHERE provider = ? AND credential_type = ?')
      .run(provider, credentialType);
  } else {
    result = db
      .prepare('DELETE FROM credentials WHERE provider = ?')
      .run(provider);
  }
  return result.changes > 0;
}

export function getCredentialMetadata(
  db: Database.Database,
  provider: string
): CredentialMetadata[] {
  const rows = db
    .prepare('SELECT provider, credential_type, metadata, created_at, updated_at FROM credentials WHERE provider = ?')
    .all(provider) as Array<{
      provider: string;
      credential_type: string;
      metadata: string | null;
      created_at: string;
      updated_at: string;
    }>;
  return rows.map((row) => ({
    provider: row.provider,
    credentialType: row.credential_type,
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
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
// Channel Packages
// ============================================================================

function rowToChannelPackage(row: Record<string, unknown>): ChannelPackage {
  const raw = snakeToCamel<Record<string, unknown>>(row);
  return {
    name: raw['name'] as string,
    channelType: raw['channelType'] as string,
    version: raw['version'] as string,
    path: raw['path'] as string,
    enabled: intToBool(raw['enabled'] as number),
    config: row['config'] ? JSON.parse(row['config'] as string) as Record<string, unknown> : null,
    installedAt: raw['installedAt'] as string,
    updatedAt: raw['updatedAt'] as string,
    checksum: raw['checksum'] as string,
    status: raw['status'] as ChannelPackageStatus,
    lastError: (raw['lastError'] as string) ?? null,
  };
}

export function getChannelPackages(db: Database.Database): ChannelPackage[] {
  const rows = db
    .prepare('SELECT * FROM channel_packages ORDER BY installed_at')
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToChannelPackage);
}

export function getChannelPackage(
  db: Database.Database,
  name: string
): ChannelPackage | null {
  const row = db
    .prepare('SELECT * FROM channel_packages WHERE name = ?')
    .get(name) as Record<string, unknown> | undefined;
  return row ? rowToChannelPackage(row) : null;
}

export function getChannelPackageByType(
  db: Database.Database,
  channelType: string
): ChannelPackage | null {
  const row = db
    .prepare('SELECT * FROM channel_packages WHERE channel_type = ?')
    .get(channelType) as Record<string, unknown> | undefined;
  return row ? rowToChannelPackage(row) : null;
}

export function createChannelPackage(
  db: Database.Database,
  data: {
    name: string;
    channelType: string;
    version: string;
    path: string;
    checksum: string;
  }
): ChannelPackage {
  const timestamp = now();
  db.prepare(
    `INSERT INTO channel_packages (name, channel_type, version, path, checksum, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(data.name, data.channelType, data.version, data.path, data.checksum, timestamp, timestamp);
  return {
    name: data.name,
    channelType: data.channelType,
    version: data.version,
    path: data.path,
    enabled: false,
    config: null,
    installedAt: timestamp,
    updatedAt: timestamp,
    checksum: data.checksum,
    status: 'disabled',
    lastError: null,
  };
}

export function updateChannelPackage(
  db: Database.Database,
  name: string,
  data: Partial<{
    version: string;
    path: string;
    enabled: boolean;
    config: Record<string, unknown> | null;
    checksum: string;
    status: ChannelPackageStatus;
    lastError: string | null;
  }>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.version !== undefined) {
    fields.push('version = ?');
    values.push(data.version);
  }
  if (data.path !== undefined) {
    fields.push('path = ?');
    values.push(data.path);
  }
  if (data.enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(boolToInt(data.enabled));
  }
  if (data.config !== undefined) {
    fields.push('config = ?');
    values.push(data.config ? JSON.stringify(data.config) : null);
  }
  if (data.checksum !== undefined) {
    fields.push('checksum = ?');
    values.push(data.checksum);
  }
  if (data.status !== undefined) {
    fields.push('status = ?');
    values.push(data.status);
  }
  if (data.lastError !== undefined) {
    fields.push('last_error = ?');
    values.push(data.lastError);
  }

  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(now());
  values.push(name);
  db.prepare(`UPDATE channel_packages SET ${fields.join(', ')} WHERE name = ?`).run(...values);
}

export function deleteChannelPackage(db: Database.Database, name: string): boolean {
  const result = db.prepare('DELETE FROM channel_packages WHERE name = ?').run(name);
  return result.changes > 0;
}

export function updateChannelPackageStatus(
  db: Database.Database,
  name: string,
  status: ChannelPackageStatus,
  lastError?: string | null
): void {
  db.prepare(
    'UPDATE channel_packages SET status = ?, last_error = ?, updated_at = ? WHERE name = ?'
  ).run(status, lastError ?? null, now(), name);
}

export function getChannelPackageConfig(
  db: Database.Database,
  name: string,
  secretKeys: string[]
): Record<string, unknown> | null {
  const row = db
    .prepare('SELECT config FROM channel_packages WHERE name = ?')
    .get(name) as { config: string | null } | undefined;
  if (!row?.config) return null;
  const config = JSON.parse(row.config) as Record<string, unknown>;
  // Decrypt secret fields
  for (const key of secretKeys) {
    if (typeof config[key] === 'string' && config[key]) {
      config[key] = decrypt(config[key] as string);
    }
  }
  return config;
}

export function setChannelPackageConfig(
  db: Database.Database,
  name: string,
  config: Record<string, unknown>,
  secretKeys: string[]
): void {
  const encrypted = { ...config };
  // Encrypt secret fields
  for (const key of secretKeys) {
    if (typeof encrypted[key] === 'string' && encrypted[key]) {
      encrypted[key] = encrypt(encrypted[key] as string);
    }
  }
  db.prepare(
    'UPDATE channel_packages SET config = ?, updated_at = ? WHERE name = ?'
  ).run(JSON.stringify(encrypted), now(), name);
}
