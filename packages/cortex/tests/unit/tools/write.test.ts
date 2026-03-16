import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ReadRegistry } from '../../../src/tools/shared/read-registry.js';
import { createWriteTool } from '../../../src/tools/write.js';

describe('Write tool', () => {
  let registry: ReadRegistry;
  let writeTool: ReturnType<typeof createWriteTool>;
  let tmpDir: string;

  beforeEach(() => {
    registry = new ReadRegistry();
    writeTool = createWriteTool({ readRegistry: registry });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-write-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a new file', async () => {
    const filePath = path.join(tmpDir, 'new-file.txt');
    const result = await writeTool.execute({
      file_path: filePath,
      content: 'hello world',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Created');
    expect(text).toContain(filePath);
    expect(result.details.isCreate).toBe(true);
    expect(result.details.bytesWritten).toBe(11);

    // Verify file was actually written
    expect(fs.readFileSync(filePath, 'utf8')).toBe('hello world');
  });

  it('overwrites an existing file after read', async () => {
    const filePath = path.join(tmpDir, 'existing.txt');
    fs.writeFileSync(filePath, 'original content');
    registry.markRead(filePath);

    const result = await writeTool.execute({
      file_path: filePath,
      content: 'new content',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Updated');
    expect(result.details.isCreate).toBe(false);
    expect(result.details.originalContent).toBe('original content');
    expect(result.details.diff).not.toBeNull();
    expect(fs.readFileSync(filePath, 'utf8')).toBe('new content');
  });

  it('rejects write without prior read', async () => {
    const filePath = path.join(tmpDir, 'existing.txt');
    fs.writeFileSync(filePath, 'original content');

    const result = await writeTool.execute({
      file_path: filePath,
      content: 'new content',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('You must Read this file before overwriting it');
    // File should not have been modified
    expect(fs.readFileSync(filePath, 'utf8')).toBe('original content');
  });

  it('creates parent directories', async () => {
    const filePath = path.join(tmpDir, 'nested', 'deep', 'file.txt');

    const result = await writeTool.execute({
      file_path: filePath,
      content: 'nested content',
    });

    expect(result.details.isCreate).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('nested content');
  });

  it('marks the written file as read in the registry', async () => {
    const filePath = path.join(tmpDir, 'new.txt');

    await writeTool.execute({
      file_path: filePath,
      content: 'content',
    });

    expect(registry.hasBeenRead(filePath)).toBe(true);
  });

  it('computes diff for updates', async () => {
    const filePath = path.join(tmpDir, 'diff-test.txt');
    fs.writeFileSync(filePath, 'line 1\nline 2\nline 3\n');
    registry.markRead(filePath);

    const result = await writeTool.execute({
      file_path: filePath,
      content: 'line 1\nmodified\nline 3\n',
    });

    expect(result.details.diff).not.toBeNull();
    expect(result.details.diff!.length).toBeGreaterThan(0);
  });

  it('returns null diff for new files', async () => {
    const filePath = path.join(tmpDir, 'brand-new.txt');

    const result = await writeTool.execute({
      file_path: filePath,
      content: 'content',
    });

    expect(result.details.diff).toBeNull();
    expect(result.details.originalContent).toBeNull();
  });
});
