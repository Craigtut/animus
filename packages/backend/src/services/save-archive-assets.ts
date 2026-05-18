/**
 * File-backed assets carried by .animus save archives.
 *
 * The databases hold references to these files. Without the files, restored
 * messages, session tool results, and selected custom voices can point at
 * missing paths even though the database rows restored cleanly.
 */

import path from 'node:path';
import { DATA_DIR, LANCEDB_PATH, TOOL_RESULTS_DIR } from '../utils/env.js';

export type SaveArchiveDirectoryKey = 'lancedb' | 'media' | 'tool_results' | 'voices';

export type MissingArchiveDirectoryPolicy = 'create-empty' | 'preserve-existing';

export interface SaveArchiveDirectory {
  key: SaveArchiveDirectoryKey;
  entryName: string;
  livePath: string;
  missingFromOlderArchives: MissingArchiveDirectoryPolicy;
}

export const SAVE_ARCHIVE_DIRECTORIES = [
  {
    key: 'lancedb',
    entryName: 'lancedb',
    livePath: LANCEDB_PATH,
    missingFromOlderArchives: 'create-empty',
  },
  {
    key: 'media',
    entryName: 'media',
    livePath: path.join(DATA_DIR, 'media'),
    missingFromOlderArchives: 'create-empty',
  },
  {
    key: 'tool_results',
    entryName: 'tool-results',
    livePath: TOOL_RESULTS_DIR,
    missingFromOlderArchives: 'create-empty',
  },
  {
    key: 'voices',
    entryName: 'voices',
    livePath: path.join(DATA_DIR, 'voices'),
    missingFromOlderArchives: 'preserve-existing',
  },
] as const satisfies readonly SaveArchiveDirectory[];
