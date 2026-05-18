import { describe, expect, it } from 'vitest';
import type { SaveManifest } from '@animus-labs/shared';
import {
  SAVE_ARCHIVE_DATABASES,
  planArchiveDatabaseRestore,
  type ArchiveDatabaseRestoreAction,
  type SaveArchiveDatabaseKey,
} from '../save-archive-registry.js';

function manifest(overrides: Partial<SaveManifest> = {}): SaveManifest {
  return {
    version: 1,
    name: 'Cleo Backup 5/17',
    createdAt: '2026-05-18T01:36:53.609Z',
    animusVersion: '0.3.3',
    schemaVersions: {
      persona: 3,
      heartbeat: 5,
      memory: 2,
      messages: 2,
      agent_logs: 2,
      contacts: 1,
    },
    stats: {
      tickCount: 12484,
      messageCount: 2721,
      memoryCount: 498,
      personaName: 'Cleo Mae Hayes',
    },
    ...overrides,
  };
}

function entries(...missing: string[]): string[] {
  const missingSet = new Set(missing);
  return SAVE_ARCHIVE_DATABASES
    .map((db) => db.fileName)
    .filter((fileName) => !missingSet.has(fileName));
}

function actionFor(
  plan: ReturnType<typeof planArchiveDatabaseRestore>,
  key: SaveArchiveDatabaseKey,
): ArchiveDatabaseRestoreAction {
  const item = plan.find((candidate) => candidate.database.key === key);
  if (!item) throw new Error(`No restore plan item for ${key}`);
  return item.action;
}

describe('save archive registry', () => {
  it('creates a fresh sessions.db for 0.3.3 archives that predate sessions.db', () => {
    const restorePlan = planArchiveDatabaseRestore(
      manifest(),
      entries('sessions.db'),
    );

    expect(actionFor(restorePlan, 'sessions')).toBe('create-empty');
  });

  it('preserves current contacts.db for archives that predate contacts.db', () => {
    const restorePlan = planArchiveDatabaseRestore(
      manifest({
        animusVersion: '0.2.0',
        schemaVersions: {
          persona: 1,
          heartbeat: 1,
          memory: 1,
          messages: 1,
          agent_logs: 1,
        },
      }),
      entries('contacts.db', 'sessions.db'),
    );

    expect(actionFor(restorePlan, 'contacts')).toBe('preserve-existing');
    expect(actionFor(restorePlan, 'sessions')).toBe('create-empty');
  });

  it('rejects a missing database when the manifest recorded its schema version', () => {
    expect(() =>
      planArchiveDatabaseRestore(
        manifest(),
        entries('memory.db', 'sessions.db'),
      ),
    ).toThrow(/memory\.db/);
  });

  it('rejects a missing sessions.db when the manifest recorded sessions schema', () => {
    expect(() =>
      planArchiveDatabaseRestore(
        manifest({
          animusVersion: '0.4.3',
          schemaVersions: {
            persona: 3,
            heartbeat: 8,
            memory: 2,
            messages: 2,
            agent_logs: 3,
            contacts: 1,
            sessions: 1,
          },
        }),
        entries('sessions.db'),
      ),
    ).toThrow(/sessions\.db/);
  });

  it('copies every database when a current archive contains all files', () => {
    const restorePlan = planArchiveDatabaseRestore(
      manifest({
        animusVersion: '0.4.3',
        schemaVersions: {
          persona: 3,
          heartbeat: 8,
          memory: 2,
          messages: 2,
          agent_logs: 3,
          contacts: 1,
          sessions: 1,
        },
      }),
      entries(),
    );

    expect(restorePlan.map((item) => item.action)).toEqual(
      SAVE_ARCHIVE_DATABASES.map(() => 'copy'),
    );
  });
});
