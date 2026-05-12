/**
 * Tool Result Persistor
 *
 * Implements Cortex's `PersistResultFn` callback. When a tool result exceeds
 * Cortex's threshold, the full content is written to
 * `data/tool-results/{tickNumber}/{toolName}-{id}.md` and Cortex inserts a
 * `[Result persisted: {path} (...)]` marker into the conversation history.
 * The agent can then use Read with offset/limit to recover the full content.
 *
 * Garbage collection runs in two layers:
 * 1. Primary: observation-driven cleanup. When Cortex's observational memory
 *    compresses messages into observations, any persisted-result paths that
 *    were in the compacted messages and are NOT referenced by remaining raw
 *    history are deleted. See `cleanupDereferencedPaths()`.
 * 2. Fallback: TTL sweep at the heartbeat cleanup phase, removing tick
 *    directories whose mtime is older than the retention window.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TOOL_RESULTS_DIR } from '../utils/env.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ToolResultPersistor', 'heartbeat');

// ---------------------------------------------------------------------------
// Persistor callback
// ---------------------------------------------------------------------------

export interface PersistorDeps {
  /** Accessor for the current heartbeat tick number at call time. */
  getTickNumber: () => number;
}

export interface PersistMetadata {
  toolName: string;
  category?: string;
  toolCallId?: string;
  messageIndex?: number;
}

export type PersistResultFn = (content: string, metadata: PersistMetadata) => Promise<string>;

export function createToolResultPersistor(deps: PersistorDeps): PersistResultFn {
  return async (content, metadata) => {
    const tickNumber = deps.getTickNumber();
    const tickDir = path.join(TOOL_RESULTS_DIR, String(tickNumber));
    await fs.mkdir(tickDir, { recursive: true });

    const filename = buildFilename(content, metadata);
    const absPath = path.join(tickDir, filename);

    const header = buildHeader(tickNumber, metadata, content.length);
    await fs.writeFile(absPath, `${header}\n${content}`, 'utf8');

    log.debug(`Persisted ${metadata.toolName} result (${content.length} chars) -> ${absPath}`);
    return absPath;
  };
}

function buildFilename(content: string, metadata: PersistMetadata): string {
  const safeTool = sanitize(metadata.toolName);
  if (metadata.toolCallId) {
    return `${safeTool}-${sanitize(metadata.toolCallId)}.md`;
  }
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);
  const msgPart = metadata.messageIndex !== undefined ? `-msg${metadata.messageIndex}` : '';
  return `${safeTool}${msgPart}-${hash}.md`;
}

function buildHeader(tickNumber: number, metadata: PersistMetadata, charCount: number): string {
  const lines = [
    '<!--',
    `tool: ${metadata.toolName}`,
    `tick: ${tickNumber}`,
    `chars: ${charCount}`,
    `persisted: ${new Date().toISOString()}`,
  ];
  if (metadata.toolCallId) lines.push(`toolCallId: ${metadata.toolCallId}`);
  if (metadata.messageIndex !== undefined) lines.push(`messageIndex: ${metadata.messageIndex}`);
  if (metadata.category) lines.push(`category: ${metadata.category}`);
  lines.push('-->');
  return lines.join('\n');
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

// ---------------------------------------------------------------------------
// Path extraction
// ---------------------------------------------------------------------------

const PERSISTED_PATH_PATTERN = /\[Result persisted: (.+?) \(/g;

export interface AgentMessageLike {
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
}

/**
 * Walk a set of messages and collect every persisted-result path referenced
 * in their textual content. Only paths under TOOL_RESULTS_DIR are returned
 * (a safety gate so we never act on foreign paths).
 */
export function collectReferencedPaths(messages: AgentMessageLike[]): Set<string> {
  const found = new Set<string>();
  for (const msg of messages) {
    for (const text of extractTextFragments(msg)) {
      addPathsFromText(text, found);
    }
  }
  return found;
}

function addPathsFromText(text: string, into: Set<string>): void {
  for (const match of text.matchAll(PERSISTED_PATH_PATTERN)) {
    const captured = match[1]?.trim();
    if (captured && isUnderToolResultsDir(captured)) {
      into.add(captured);
    }
  }
}

function extractTextFragments(msg: AgentMessageLike): string[] {
  if (typeof msg.content === 'string') return [msg.content];
  const out: string[] = [];
  for (const part of msg.content) {
    if (typeof part.text === 'string') out.push(part.text);
  }
  return out;
}

function isUnderToolResultsDir(p: string): boolean {
  const resolved = path.resolve(p);
  const root = path.resolve(TOOL_RESULTS_DIR);
  return resolved === root || resolved.startsWith(root + path.sep);
}

// ---------------------------------------------------------------------------
// Observation-driven GC
// ---------------------------------------------------------------------------

/**
 * Delete persisted-result files referenced ONLY in the compacted message
 * set. Paths still referenced in the remaining raw history OR in the
 * observation text are preserved (the observer occasionally echoes path
 * markers into its summary; the TTL sweep handles eventual cleanup).
 *
 * @returns the number of files deleted.
 */
export async function cleanupDereferencedPaths(
  compactedMessages: AgentMessageLike[],
  remainingHistory: AgentMessageLike[],
  observationText?: string,
): Promise<number> {
  const compactedPaths = collectReferencedPaths(compactedMessages);
  if (compactedPaths.size === 0) return 0;

  const stillReferenced = collectReferencedPaths(remainingHistory);
  if (observationText) addPathsFromText(observationText, stillReferenced);
  let deleted = 0;

  for (const p of compactedPaths) {
    if (stillReferenced.has(p)) continue;
    try {
      await fs.unlink(p);
      deleted++;
      log.debug(`Deleted dereferenced tool result: ${p}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
      log.warn(`Failed to delete ${p}:`, err);
    }
  }

  return deleted;
}

// ---------------------------------------------------------------------------
// TTL sweep (fallback)
// ---------------------------------------------------------------------------

/**
 * Delete tick directories whose mtime is older than `days`. Runs as a
 * safety net for any files the observation-driven cleanup missed.
 *
 * @returns the number of directories removed.
 */
export async function cleanupOldToolResults(days: number): Promise<number> {
  if (!Number.isFinite(days) || days <= 0) return 0;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  let entries: string[];
  try {
    entries = await fs.readdir(TOOL_RESULTS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return 0;
    throw err;
  }

  let removed = 0;
  for (const entry of entries) {
    const full = path.join(TOOL_RESULTS_DIR, entry);
    try {
      const stat = await fs.stat(full);
      if (!stat.isDirectory()) continue;
      if (stat.mtimeMs >= cutoffMs) continue;
      await fs.rm(full, { recursive: true, force: true });
      removed++;
    } catch (err) {
      log.warn(`Failed to sweep ${full}:`, err);
    }
  }

  if (removed > 0) log.info(`Tool-result TTL sweep removed ${removed} tick directories`);
  return removed;
}
