import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createGrepTool } from '../../../src/tools/grep.js';

describe('Grep tool', () => {
  let grepTool: ReturnType<typeof createGrepTool>;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-grep-test-'));
    grepTool = createGrepTool({ defaultCwd: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds files with matching content (files_with_matches mode)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'match.ts'), 'hello world\n');
    fs.writeFileSync(path.join(tmpDir, 'nomatch.ts'), 'goodbye\n');

    const result = await grepTool.execute({
      pattern: 'hello',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('match.ts');
    expect(text).not.toContain('nomatch.ts');
    expect(result.details.totalFiles).toBe(1);
  });

  it('returns matching lines in content mode', async () => {
    fs.writeFileSync(path.join(tmpDir, 'file.ts'), 'line 1\nhello world\nline 3\n');

    const result = await grepTool.execute({
      pattern: 'hello',
      output_mode: 'content',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('hello world');
    expect(text).toContain('2:'); // line number
  });

  it('returns match counts in count mode', async () => {
    fs.writeFileSync(path.join(tmpDir, 'file.ts'), 'hello\nhello\nhello\nworld\n');

    const result = await grepTool.execute({
      pattern: 'hello',
      output_mode: 'count',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain(':3');
  });

  it('supports case insensitive search', async () => {
    fs.writeFileSync(path.join(tmpDir, 'file.ts'), 'Hello World\n');

    const sensitive = await grepTool.execute({
      pattern: 'hello',
    });
    const insensitive = await grepTool.execute({
      pattern: 'hello',
      '-i': true,
    });

    expect((sensitive.content[0] as { type: 'text'; text: string }).text).toContain('No matches');
    expect((insensitive.content[0] as { type: 'text'; text: string }).text).toContain('file.ts');
  });

  it('filters by file type', async () => {
    fs.writeFileSync(path.join(tmpDir, 'code.ts'), 'hello\n');
    fs.writeFileSync(path.join(tmpDir, 'text.md'), 'hello\n');

    const result = await grepTool.execute({
      pattern: 'hello',
      type: 'ts',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('code.ts');
    expect(text).not.toContain('text.md');
  });

  it('returns error for invalid regex', async () => {
    const result = await grepTool.execute({
      pattern: '[invalid',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Invalid regex');
  });

  it('returns error for nonexistent path', async () => {
    const result = await grepTool.execute({
      pattern: 'test',
      path: '/nonexistent/dir',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Path does not exist');
  });

  it('returns no matches for empty directory', async () => {
    const result = await grepTool.execute({
      pattern: 'anything',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('No matches');
    expect(result.details.totalMatches).toBe(0);
  });

  it('supports context lines', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(tmpDir, 'ctx.ts'), lines.join('\n') + '\n');

    const result = await grepTool.execute({
      pattern: 'line 5',
      output_mode: 'content',
      context: 1,
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    // Should include line 4 and line 6 as context
    expect(text).toContain('line 4');
    expect(text).toContain('line 5');
    expect(text).toContain('line 6');
  });

  it('supports pagination with offset and head_limit', async () => {
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(tmpDir, `file${i}.ts`), `match${i}\n`);
    }

    const result = await grepTool.execute({
      pattern: 'match',
      offset: 2,
      head_limit: 2,
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    const lines = text.trim().split('\n');
    expect(lines.length).toBe(2);
  });

  it('skips binary files silently', async () => {
    const textFile = path.join(tmpDir, 'text.ts');
    const binFile = path.join(tmpDir, 'binary.ts');
    fs.writeFileSync(textFile, 'hello world\n');
    const buf = Buffer.alloc(100);
    buf[0] = 0x00;
    buf.write('hello', 10);
    fs.writeFileSync(binFile, buf);

    const result = await grepTool.execute({ pattern: 'hello' });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('text.ts');
    expect(text).not.toContain('binary.ts');
  });

  it('searches a single file when path is a file', async () => {
    const filePath = path.join(tmpDir, 'single.ts');
    fs.writeFileSync(filePath, 'target line\nother line\n');

    const result = await grepTool.execute({
      pattern: 'target',
      path: filePath,
      output_mode: 'content',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('target line');
  });

  it('reports whether ripgrep or fallback engine was used', async () => {
    fs.writeFileSync(path.join(tmpDir, 'file.ts'), 'test\n');

    const result = await grepTool.execute({ pattern: 'test' });

    // usingFallback is false when rg is available, true otherwise
    expect(typeof result.details.usingFallback).toBe('boolean');
  });

  it('applies default head_limit of 250', async () => {
    // Create 5 files with matching content
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(tmpDir, `file${i}.ts`), 'findme\n');
    }

    const result = await grepTool.execute({ pattern: 'findme' });

    // All 5 should be returned (under 250 limit)
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    for (let i = 0; i < 5; i++) {
      expect(text).toContain(`file${i}.ts`);
    }
    expect(result.details.truncated).toBe(false);
  });

  it('supports explicit head_limit=0 for unlimited results', async () => {
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(tmpDir, `unlimited${i}.ts`), 'target\n');
    }

    const result = await grepTool.execute({ pattern: 'target', head_limit: 0 });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    for (let i = 0; i < 5; i++) {
      expect(text).toContain(`unlimited${i}.ts`);
    }
  });

  it('handles dash-prefixed patterns', async () => {
    fs.writeFileSync(path.join(tmpDir, 'dashes.ts'), 'foo --bar baz\n');

    const result = await grepTool.execute({
      pattern: '--bar',
      output_mode: 'content',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('--bar');
  });

  describe('gitignore support', () => {
    it('respects .gitignore patterns when searching directories', async () => {
      // Create a .gitignore
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'ignored-dir/\n*.log\n');

      // Create a file that should be found
      fs.writeFileSync(path.join(tmpDir, 'found.ts'), 'search-target\n');

      // Create a file matching .gitignore pattern
      fs.writeFileSync(path.join(tmpDir, 'debug.log'), 'search-target\n');

      // Create a directory matching .gitignore pattern
      fs.mkdirSync(path.join(tmpDir, 'ignored-dir'));
      fs.writeFileSync(path.join(tmpDir, 'ignored-dir', 'hidden.ts'), 'search-target\n');

      const result = await grepTool.execute({ pattern: 'search-target' });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('found.ts');
      expect(text).not.toContain('debug.log');
      expect(text).not.toContain('hidden.ts');
    });

    it('can be disabled via respectGitignore: false', async () => {
      const noGitignoreTool = createGrepTool({
        defaultCwd: tmpDir,
        respectGitignore: false,
      });

      // Create a .gitignore
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '*.log\n');

      // Create files
      fs.writeFileSync(path.join(tmpDir, 'found.ts'), 'target\n');
      fs.writeFileSync(path.join(tmpDir, 'also-found.log'), 'target\n');

      const result = await noGitignoreTool.execute({ pattern: 'target' });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('found.ts');
      expect(text).toContain('also-found.log');
    });

    it('still respects DEFAULT_IGNORE even without .gitignore file', async () => {
      // Create a node_modules directory (in DEFAULT_IGNORE)
      fs.mkdirSync(path.join(tmpDir, 'node_modules'));
      fs.writeFileSync(path.join(tmpDir, 'node_modules', 'dep.js'), 'target\n');

      // Create a regular file
      fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'target\n');

      const result = await grepTool.execute({ pattern: 'target' });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('app.ts');
      expect(text).not.toContain('dep.js');
    });
  });
});
