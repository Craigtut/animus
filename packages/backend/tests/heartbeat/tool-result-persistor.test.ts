import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The persistor captures TOOL_RESULTS_DIR from env.ts at module load. To
// redirect it at a known temp location we set ANIMUS_DATA_DIR before any
// dynamic import resolves env.ts.
const tmpRoot = path.join(os.tmpdir(), `animus-persistor-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
process.env['ANIMUS_DATA_DIR'] = tmpRoot;

type Persistor = typeof import('../../src/heartbeat/tool-result-persistor.js');
type EnvMod = typeof import('../../src/utils/env.js');

let mod: Persistor;
let envMod: EnvMod;

beforeAll(async () => {
  await fs.mkdir(tmpRoot, { recursive: true });
  envMod = await import('../../src/utils/env.js');
  mod = await import('../../src/heartbeat/tool-result-persistor.js');
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(envMod.TOOL_RESULTS_DIR, { recursive: true, force: true });
});

describe('createToolResultPersistor', () => {
  it('writes a file with metadata header under the current tick directory', async () => {
    const persist = mod.createToolResultPersistor({ getTickNumber: () => 42 });

    const content = 'hello world\n'.repeat(500);
    const abs = await persist(content, { toolName: 'Bash', toolCallId: 'abc-123' });

    expect(abs).toBe(path.join(envMod.TOOL_RESULTS_DIR, '42', 'Bash-abc-123.md'));

    const body = await fs.readFile(abs, 'utf8');
    expect(body).toMatch(/^<!--\n/);
    expect(body).toContain('tool: Bash');
    expect(body).toContain('tick: 42');
    expect(body).toContain('toolCallId: abc-123');
    expect(body).toContain(`chars: ${content.length}`);
    expect(body).toContain('\n-->\n');
    expect(body).toContain(content);
  });

  it('falls back to a content hash when toolCallId is absent', async () => {
    const persist = mod.createToolResultPersistor({ getTickNumber: () => 7 });

    const absA = await persist('payload A', { toolName: 'WebFetch', messageIndex: 5 });
    const absB = await persist('payload A', { toolName: 'WebFetch', messageIndex: 5 });
    const absC = await persist('payload B', { toolName: 'WebFetch', messageIndex: 5 });

    expect(absA).toBe(absB); // same content -> stable hash
    expect(absA).not.toBe(absC); // different content -> different hash
    expect(path.basename(absA)).toMatch(/^WebFetch-msg5-[0-9a-f]{8}\.md$/);
  });

  it('sanitizes tool names and tool call IDs that contain unsafe characters', async () => {
    const persist = mod.createToolResultPersistor({ getTickNumber: () => 1 });
    const abs = await persist('x', { toolName: 'mcp__obsidian__read-note', toolCallId: 'id/with slash' });
    expect(path.basename(abs)).toBe('mcp__obsidian__read-note-id_with_slash.md');
  });

  it('reads the tick number at call time, not creation time', async () => {
    let tick = 10;
    const persist = mod.createToolResultPersistor({ getTickNumber: () => tick });

    const first = await persist('a', { toolName: 'Grep', toolCallId: '1' });
    tick = 11;
    const second = await persist('a', { toolName: 'Grep', toolCallId: '2' });

    expect(first).toContain(path.sep + '10' + path.sep);
    expect(second).toContain(path.sep + '11' + path.sep);
  });
});

describe('collectReferencedPaths', () => {
  it('finds paths under TOOL_RESULTS_DIR in string content', () => {
    const p = path.join(envMod.TOOL_RESULTS_DIR, '42', 'Bash-abc.md');
    const messages = [
      { content: `preamble\n[Result persisted: ${p} (1234 chars, ~300 tokens)]\ntail` },
    ];
    const paths = mod.collectReferencedPaths(messages);
    expect(paths.has(p)).toBe(true);
    expect(paths.size).toBe(1);
  });

  it('finds paths in array content blocks', () => {
    const p = path.join(envMod.TOOL_RESULTS_DIR, '1', 'WebFetch-x.md');
    const messages = [
      {
        content: [
          { type: 'text', text: `[Result persisted: ${p} (1 chars, ~1 tokens) -- WebFetch]` },
          { type: 'other' },
        ],
      },
    ];
    expect(mod.collectReferencedPaths(messages).has(p)).toBe(true);
  });

  it('ignores paths NOT under TOOL_RESULTS_DIR', () => {
    const foreign = '/etc/passwd';
    const messages = [{ content: `[Result persisted: ${foreign} (1 chars, ~1 tokens)]` }];
    expect(mod.collectReferencedPaths(messages).size).toBe(0);
  });

  it('returns an empty set when no markers are present', () => {
    expect(mod.collectReferencedPaths([{ content: 'nothing to see' }]).size).toBe(0);
  });
});

describe('cleanupDereferencedPaths', () => {
  it('deletes paths referenced only in compacted messages', async () => {
    const persist = mod.createToolResultPersistor({ getTickNumber: () => 5 });
    const orphan = await persist('dead', { toolName: 'Bash', toolCallId: 'orphan' });
    const keeper = await persist('alive', { toolName: 'Bash', toolCallId: 'keeper' });

    const compacted = [
      { content: `[Result persisted: ${orphan} (10 chars, ~1 tokens)]` },
      { content: `[Result persisted: ${keeper} (10 chars, ~1 tokens)]` },
    ];
    const remaining = [
      { content: `still referencing [Result persisted: ${keeper} (10 chars, ~1 tokens)]` },
    ];

    const deleted = await mod.cleanupDereferencedPaths(compacted, remaining);
    expect(deleted).toBe(1);

    await expect(fs.access(orphan)).rejects.toThrow();
    await expect(fs.access(keeper)).resolves.not.toThrow();
  });

  it('is a no-op when compacted messages have no persisted paths', async () => {
    const deleted = await mod.cleanupDereferencedPaths(
      [{ content: 'plain text only' }],
      [{ content: 'also plain' }],
    );
    expect(deleted).toBe(0);
  });

  it('preserves paths echoed in the observation text', async () => {
    const persist = mod.createToolResultPersistor({ getTickNumber: () => 6 });
    const echoed = await persist('echo', { toolName: 'Bash', toolCallId: 'echoed' });
    const orphan = await persist('orphan', { toolName: 'Bash', toolCallId: 'orphan' });

    const compacted = [
      { content: `[Result persisted: ${echoed} (10 chars, ~1 tokens)]` },
      { content: `[Result persisted: ${orphan} (10 chars, ~1 tokens)]` },
    ];
    const observationText = `summary mentions [Result persisted: ${echoed} (10 chars, ~1 tokens) -- Bash]`;

    const deleted = await mod.cleanupDereferencedPaths(compacted, [], observationText);
    expect(deleted).toBe(1);

    await expect(fs.access(echoed)).resolves.not.toThrow();
    await expect(fs.access(orphan)).rejects.toThrow();
  });

  it('tolerates already-missing files', async () => {
    const missing = path.join(envMod.TOOL_RESULTS_DIR, '99', 'Bash-missing.md');
    const deleted = await mod.cleanupDereferencedPaths(
      [{ content: `[Result persisted: ${missing} (10 chars, ~1 tokens)]` }],
      [],
    );
    expect(deleted).toBe(0);
  });
});

describe('cleanupOldToolResults', () => {
  it('removes tick directories older than the retention window', async () => {
    const persist = mod.createToolResultPersistor({ getTickNumber: () => 1 });
    await persist('old', { toolName: 'Bash', toolCallId: 'old' });

    // Age the tick directory by resetting its mtime to 10 days ago.
    const tickDir = path.join(envMod.TOOL_RESULTS_DIR, '1');
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await fs.utimes(tickDir, past, past);

    const newPersist = mod.createToolResultPersistor({ getTickNumber: () => 2 });
    await newPersist('new', { toolName: 'Bash', toolCallId: 'new' });

    const removed = await mod.cleanupOldToolResults(7);
    expect(removed).toBe(1);

    await expect(fs.access(tickDir)).rejects.toThrow();
    await expect(fs.access(path.join(envMod.TOOL_RESULTS_DIR, '2'))).resolves.not.toThrow();
  });

  it('returns 0 when the tool-results directory does not exist', async () => {
    await fs.rm(envMod.TOOL_RESULTS_DIR, { recursive: true, force: true });
    const removed = await mod.cleanupOldToolResults(7);
    expect(removed).toBe(0);
  });

  it('is a no-op for non-positive retention', async () => {
    const persist = mod.createToolResultPersistor({ getTickNumber: () => 1 });
    await persist('keep', { toolName: 'Bash', toolCallId: 'k' });
    expect(await mod.cleanupOldToolResults(0)).toBe(0);
    expect(await mod.cleanupOldToolResults(-5)).toBe(0);
  });
});
