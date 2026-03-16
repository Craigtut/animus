import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ReadRegistry } from '../../../src/tools/shared/read-registry.js';
import { createEditTool } from '../../../src/tools/edit.js';

describe('Edit tool', () => {
  let registry: ReadRegistry;
  let editTool: ReturnType<typeof createEditTool>;
  let tmpDir: string;

  beforeEach(() => {
    registry = new ReadRegistry();
    editTool = createEditTool({ readRegistry: registry });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-edit-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('replaces a unique string', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world\nfoo bar\n');
    registry.markRead(filePath);

    const result = await editTool.execute({
      file_path: filePath,
      old_string: 'foo bar',
      new_string: 'baz qux',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('1 replacement');
    expect(result.details.replacementCount).toBe(1);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('hello world\nbaz qux\n');
  });

  it('replaces all occurrences with replaceAll', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'foo bar foo bar foo\n');
    registry.markRead(filePath);

    const result = await editTool.execute({
      file_path: filePath,
      old_string: 'foo',
      new_string: 'baz',
      replace_all: true,
    });

    expect(result.details.replacementCount).toBe(3);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('baz bar baz bar baz\n');
  });

  it('rejects non-unique match without replaceAll', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'foo bar foo bar\n');
    registry.markRead(filePath);

    const result = await editTool.execute({
      file_path: filePath,
      old_string: 'foo',
      new_string: 'baz',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Found 2 matches');
    // File should not have been modified
    expect(fs.readFileSync(filePath, 'utf8')).toBe('foo bar foo bar\n');
  });

  it('returns error when old_string not found', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world\n');
    registry.markRead(filePath);

    const result = await editTool.execute({
      file_path: filePath,
      old_string: 'nonexistent',
      new_string: 'replacement',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('not found');
  });

  it('returns error when old_string equals new_string', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world\n');
    registry.markRead(filePath);

    const result = await editTool.execute({
      file_path: filePath,
      old_string: 'hello',
      new_string: 'hello',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('identical');
  });

  it('rejects edit without prior read', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world\n');

    const result = await editTool.execute({
      file_path: filePath,
      old_string: 'hello',
      new_string: 'hi',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('You must Read this file before editing it');
  });

  it('returns error for nonexistent file', async () => {
    const result = await editTool.execute({
      file_path: '/nonexistent/file.txt',
      old_string: 'hello',
      new_string: 'hi',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('File does not exist');
  });

  it('handles multi-line replacements', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'line 1\nline 2\nline 3\n');
    registry.markRead(filePath);

    const result = await editTool.execute({
      file_path: filePath,
      old_string: 'line 1\nline 2',
      new_string: 'replaced 1\nreplaced 2',
    });

    expect(result.details.replacementCount).toBe(1);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('replaced 1\nreplaced 2\nline 3\n');
  });

  it('normalizes CRLF line endings for matching', async () => {
    const filePath = path.join(tmpDir, 'crlf.txt');
    fs.writeFileSync(filePath, 'hello\r\nworld\r\n');
    registry.markRead(filePath);

    // The old_string uses \n (the model sends normalized text)
    const result = await editTool.execute({
      file_path: filePath,
      old_string: 'hello\nworld',
      new_string: 'hi\nthere',
    });

    expect(result.details.replacementCount).toBe(1);
    // Original CRLF style should be preserved
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toBe('hi\r\nthere\r\n');
  });

  it('produces a diff in details', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world\n');
    registry.markRead(filePath);

    const result = await editTool.execute({
      file_path: filePath,
      old_string: 'hello',
      new_string: 'hi',
    });

    expect(result.details.diff.length).toBeGreaterThan(0);
    expect(result.details.originalContent).toBe('hello world\n');
  });
});
