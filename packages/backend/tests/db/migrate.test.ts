import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { runMigrations } from '../../src/db/migrate.js';

describe('runMigrations', () => {
  let db: Database.Database;
  let migrationsDir: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrationsDir = mkdtempSync(path.join(os.tmpdir(), 'animus-migrate-'));
  });

  it('creates _migrations table and applies migrations', () => {
    writeFileSync(
      path.join(migrationsDir, '001_initial.sql'),
      'CREATE TABLE test_table (id TEXT PRIMARY KEY, name TEXT NOT NULL);'
    );

    runMigrations(db, migrationsDir, 'test.db');

    // Check _migrations table
    const versions = db
      .prepare('SELECT version FROM _migrations')
      .all() as Array<{ version: string }>;
    expect(versions).toHaveLength(1);
    expect(versions[0]!.version).toBe('001_initial');

    // Check table was created
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it('is idempotent — skips already-applied migrations', () => {
    writeFileSync(
      path.join(migrationsDir, '001_initial.sql'),
      'CREATE TABLE test_table (id TEXT PRIMARY KEY);'
    );

    runMigrations(db, migrationsDir, 'test.db');
    runMigrations(db, migrationsDir, 'test.db');

    const versions = db
      .prepare('SELECT version FROM _migrations')
      .all() as Array<{ version: string }>;
    expect(versions).toHaveLength(1);
  });

  it('applies migrations in sorted order', () => {
    writeFileSync(
      path.join(migrationsDir, '002_second.sql'),
      'CREATE TABLE second (id TEXT PRIMARY KEY);'
    );
    writeFileSync(
      path.join(migrationsDir, '001_first.sql'),
      'CREATE TABLE first (id TEXT PRIMARY KEY);'
    );

    runMigrations(db, migrationsDir, 'test.db');

    const versions = db
      .prepare('SELECT version FROM _migrations ORDER BY version')
      .all() as Array<{ version: string }>;
    expect(versions).toHaveLength(2);
    expect(versions[0]!.version).toBe('001_first');
    expect(versions[1]!.version).toBe('002_second');
  });

  it('rolls back on bad SQL', () => {
    writeFileSync(
      path.join(migrationsDir, '001_good.sql'),
      'CREATE TABLE good_table (id TEXT PRIMARY KEY);'
    );
    writeFileSync(
      path.join(migrationsDir, '002_bad.sql'),
      'THIS IS NOT VALID SQL;'
    );

    // First migration should succeed
    // Second should throw — but first stays applied
    expect(() => runMigrations(db, migrationsDir, 'test.db')).toThrow();

    // First migration was applied
    const versions = db
      .prepare('SELECT version FROM _migrations')
      .all() as Array<{ version: string }>;
    expect(versions).toHaveLength(1);
    expect(versions[0]!.version).toBe('001_good');
  });

  it('handles missing directory gracefully', () => {
    expect(() =>
      runMigrations(db, '/nonexistent/path', 'test.db')
    ).not.toThrow();
  });
});
