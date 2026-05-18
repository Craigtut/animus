/**
 * Central registry for the database files carried by .animus save archives.
 *
 * Database schema migrations can update a database that exists. This registry
 * handles save archive topology: which database files are expected and what to
 * do when an older archive predates one of them.
 */

import type { SaveManifest } from '@animus-labs/shared';
import {
  DB_AGENT_LOGS_PATH,
  DB_CONTACTS_PATH,
  DB_HEARTBEAT_PATH,
  DB_MEMORY_PATH,
  DB_MESSAGES_PATH,
  DB_PERSONA_PATH,
  DB_SESSIONS_PATH,
} from '../utils/env.js';

export type SaveArchiveDatabaseKey =
  | 'persona'
  | 'heartbeat'
  | 'memory'
  | 'messages'
  | 'agent_logs'
  | 'contacts'
  | 'sessions';

export type MissingArchiveDatabasePolicy =
  | 'fail'
  | 'create-empty'
  | 'preserve-existing';

export type ArchiveDatabaseRestoreAction =
  | 'copy'
  | 'create-empty'
  | 'preserve-existing';

export interface SaveArchiveDatabase {
  key: SaveArchiveDatabaseKey;
  fileName: string;
  envPath: string;
  introducedInAnimusVersion: string;
  missingFromOlderArchives: MissingArchiveDatabasePolicy;
}

export interface ArchiveDatabaseRestorePlanItem {
  database: SaveArchiveDatabase;
  action: ArchiveDatabaseRestoreAction;
  reason?: string;
}

export const SAVE_ARCHIVE_DATABASES = [
  {
    key: 'persona',
    fileName: 'persona.db',
    envPath: DB_PERSONA_PATH,
    introducedInAnimusVersion: '0.1.0',
    missingFromOlderArchives: 'fail',
  },
  {
    key: 'heartbeat',
    fileName: 'heartbeat.db',
    envPath: DB_HEARTBEAT_PATH,
    introducedInAnimusVersion: '0.1.0',
    missingFromOlderArchives: 'fail',
  },
  {
    key: 'memory',
    fileName: 'memory.db',
    envPath: DB_MEMORY_PATH,
    introducedInAnimusVersion: '0.1.0',
    missingFromOlderArchives: 'fail',
  },
  {
    key: 'messages',
    fileName: 'messages.db',
    envPath: DB_MESSAGES_PATH,
    introducedInAnimusVersion: '0.1.0',
    missingFromOlderArchives: 'fail',
  },
  {
    key: 'agent_logs',
    fileName: 'agent_logs.db',
    envPath: DB_AGENT_LOGS_PATH,
    introducedInAnimusVersion: '0.1.0',
    missingFromOlderArchives: 'fail',
  },
  {
    key: 'contacts',
    fileName: 'contacts.db',
    envPath: DB_CONTACTS_PATH,
    introducedInAnimusVersion: '0.3.0',
    missingFromOlderArchives: 'preserve-existing',
  },
  {
    key: 'sessions',
    fileName: 'sessions.db',
    envPath: DB_SESSIONS_PATH,
    introducedInAnimusVersion: '0.4.0',
    missingFromOlderArchives: 'create-empty',
  },
] as const satisfies readonly SaveArchiveDatabase[];

function manifestHasSchemaVersion(
  manifest: SaveManifest,
  key: SaveArchiveDatabaseKey,
): boolean {
  return Object.prototype.hasOwnProperty.call(manifest.schemaVersions, key);
}

/**
 * Plan how to normalize an extracted archive into the current database layout.
 *
 * If a database was recorded in schemaVersions, its file must be present. If it
 * was not recorded, the archive predates that database and the registry policy
 * decides whether restore should create an empty DB, preserve the current DB, or
 * fail as incompatible.
 */
export function planArchiveDatabaseRestore(
  manifest: SaveManifest,
  archiveTopLevelEntries: Iterable<string>,
): ArchiveDatabaseRestorePlanItem[] {
  const topLevelEntries = new Set(archiveTopLevelEntries);

  return SAVE_ARCHIVE_DATABASES.map((database) => {
    if (topLevelEntries.has(database.fileName)) {
      return { database, action: 'copy' };
    }

    if (manifestHasSchemaVersion(manifest, database.key)) {
      throw new Error(
        `Missing database file in archive: ${database.fileName}. ` +
        `The manifest records schema version ${manifest.schemaVersions[database.key]} for ${database.key}.`,
      );
    }

    switch (database.missingFromOlderArchives) {
      case 'create-empty':
        return {
          database,
          action: 'create-empty',
          reason:
            `${database.fileName} was introduced in Animus ${database.introducedInAnimusVersion} ` +
            'and is not listed in this archive manifest.',
        };
      case 'preserve-existing':
        return {
          database,
          action: 'preserve-existing',
          reason:
            `${database.fileName} was introduced in Animus ${database.introducedInAnimusVersion} ` +
            'and is not listed in this archive manifest.',
        };
      case 'fail':
        throw new Error(`Missing required database file in archive: ${database.fileName}`);
    }
  });
}
