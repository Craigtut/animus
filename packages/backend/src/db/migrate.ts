/**
 * Database Migration Runner
 *
 * Reads versioned .sql files from a migrations directory,
 * applies them in order, and tracks applied versions.
 */

import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

/**
 * Run all pending migrations for a database.
 *
 * - Creates `_migrations` table if it doesn't exist
 * - Reads `.sql` files sorted by numeric prefix (e.g. 001_initial.sql)
 * - Skips already-applied versions
 * - Runs each migration in a transaction
 */
export function runMigrations(
  db: Database.Database,
  migrationsDir: string,
  dbName: string
): void {
  // Ensure migrations tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Read and sort migration files
  let files: string[];
  try {
    files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    // No migrations directory — nothing to do
    return;
  }

  if (files.length === 0) return;

  // Get already-applied versions
  const applied = new Set(
    (db.prepare('SELECT version FROM _migrations').all() as Array<{ version: string }>).map(
      (r) => r.version
    )
  );

  // Apply pending migrations
  let appliedCount = 0;
  for (const file of files) {
    const version = path.basename(file, '.sql');
    if (applied.has(version)) continue;

    const sql = readFileSync(path.join(migrationsDir, file), 'utf-8');

    const migrate = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(version);
    });

    migrate();
    appliedCount++;
  }

  if (appliedCount > 0) {
    console.log(
      `[Migrations] ${dbName}: applied ${appliedCount} migration${appliedCount > 1 ? 's' : ''} (${files
        .map((f) => path.basename(f, '.sql'))
        .slice(-appliedCount)
        .join(', ')})`
    );
  }
}
