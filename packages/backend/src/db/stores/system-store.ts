/**
 * System Store — data access for system.db
 *
 * Tables: users, contacts, contact_channels, channel_packages,
 *         system_settings, api_keys, credentials
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import type {
  User,
  Contact,
  ContactChannel,
  SystemSettings,
  ChannelType,
  PermissionTier,
  OnboardingState,
  ChannelPackage,
  ChannelPackageStatus,
  ToolPermission,
  RiskTier,
  ToolPermissionMode,
} from '@animus-labs/shared';
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
  const raw = snakeToCamel<Record<string, unknown>>(row);
  return { ...raw, isPrimary: intToBool(raw['isPrimary'] as number) } as Contact;
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
    const raw = snakeToCamel<Record<string, unknown>>(row);
    return { ...raw, isVerified: intToBool(raw['isVerified'] as number) } as ContactChannel;
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
    taskRunRetentionDays: 'task_run_retention_days',
    defaultAgentProvider: 'default_agent_provider',
    defaultModel: 'default_model',
    goalApprovalMode: 'goal_approval_mode',
    timezone: 'timezone',
    energySystemEnabled: 'energy_system_enabled',
    sleepStartHour: 'sleep_start_hour',
    sleepEndHour: 'sleep_end_hour',
    sleepTickIntervalMs: 'sleep_tick_interval_ms',
    reasoningEffort: 'reasoning_effort',
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
    installedFrom: (raw['installedFrom'] as 'local' | 'package') ?? 'local',
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
    installedFrom?: 'local' | 'package';
  }
): ChannelPackage {
  const timestamp = now();
  const installedFrom = data.installedFrom ?? 'local';
  db.prepare(
    `INSERT INTO channel_packages (name, channel_type, version, path, checksum, installed_from, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(data.name, data.channelType, data.version, data.path, data.checksum, installedFrom, timestamp, timestamp);
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
    installedFrom,
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

// ============================================================================
// Tool Permissions
// ============================================================================

function rowToToolPermission(row: Record<string, unknown>): ToolPermission {
  return {
    toolName: row['tool_name'] as string,
    toolSource: row['tool_source'] as string,
    displayName: row['display_name'] as string,
    description: row['description'] as string,
    riskTier: row['risk_tier'] as RiskTier,
    mode: row['mode'] as ToolPermissionMode,
    isDefault: (row['is_default'] as number) === 1,
    usageCount: row['usage_count'] as number,
    lastUsedAt: (row['last_used_at'] as string) ?? null,
    trustRampDismissedAt: (row['trust_ramp_dismissed_at'] as string) ?? null,
    updatedAt: row['updated_at'] as string,
  };
}

export function getToolPermissions(db: Database.Database): ToolPermission[] {
  const rows = db
    .prepare('SELECT * FROM tool_permissions ORDER BY tool_source, tool_name')
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToToolPermission);
}

export function getToolPermission(
  db: Database.Database,
  toolName: string
): ToolPermission | null {
  const row = db
    .prepare('SELECT * FROM tool_permissions WHERE tool_name = ?')
    .get(toolName) as Record<string, unknown> | undefined;
  return row ? rowToToolPermission(row) : null;
}

export function upsertToolPermission(
  db: Database.Database,
  data: {
    toolName: string;
    toolSource: string;
    displayName: string;
    description: string;
    riskTier: RiskTier;
    mode: ToolPermissionMode;
    isDefault?: boolean;
  }
): void {
  const timestamp = now();
  db.prepare(
    `INSERT INTO tool_permissions (tool_name, tool_source, display_name, description, risk_tier, mode, is_default, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tool_name) DO UPDATE SET
       tool_source = CASE WHEN is_default = 1 THEN excluded.tool_source ELSE tool_source END,
       display_name = CASE WHEN is_default = 1 THEN excluded.display_name ELSE display_name END,
       description = CASE WHEN is_default = 1 THEN excluded.description ELSE description END,
       risk_tier = CASE WHEN is_default = 1 THEN excluded.risk_tier ELSE risk_tier END,
       mode = CASE WHEN is_default = 1 THEN excluded.mode ELSE mode END,
       updated_at = excluded.updated_at`
  ).run(
    data.toolName,
    data.toolSource,
    data.displayName,
    data.description,
    data.riskTier,
    data.mode,
    data.isDefault !== undefined ? (data.isDefault ? 1 : 0) : 1,
    timestamp
  );
}

export function updateToolPermissionMode(
  db: Database.Database,
  toolName: string,
  mode: ToolPermissionMode
): void {
  db.prepare(
    'UPDATE tool_permissions SET mode = ?, is_default = 0, updated_at = ? WHERE tool_name = ?'
  ).run(mode, now(), toolName);
}

export function updateGroupPermissionMode(
  db: Database.Database,
  source: string,
  mode: ToolPermissionMode
): void {
  db.prepare(
    'UPDATE tool_permissions SET mode = ?, is_default = 0, updated_at = ? WHERE tool_source = ?'
  ).run(mode, now(), source);
}

export function incrementToolUsage(db: Database.Database, toolName: string): void {
  db.prepare(
    'UPDATE tool_permissions SET usage_count = usage_count + 1, last_used_at = ?, updated_at = ? WHERE tool_name = ?'
  ).run(now(), now(), toolName);
}

export function setTrustRampDismissed(db: Database.Database, toolName: string): void {
  db.prepare(
    'UPDATE tool_permissions SET trust_ramp_dismissed_at = ?, updated_at = ? WHERE tool_name = ?'
  ).run(now(), now(), toolName);
}

export function getToolsEligibleForTrustRamp(db: Database.Database): ToolPermission[] {
  const rows = db
    .prepare(
      `SELECT tp.* FROM tool_permissions tp
       WHERE tp.mode = 'ask'
         AND (tp.trust_ramp_dismissed_at IS NULL
              OR tp.trust_ramp_dismissed_at < datetime('now', '-30 days'))
       ORDER BY tp.tool_name`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToToolPermission);
}
