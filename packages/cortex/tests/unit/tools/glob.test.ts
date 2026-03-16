import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createGlobTool } from '../../../src/tools/glob.js';

describe('Glob tool', () => {
  let globTool: ReturnType<typeof createGlobTool>;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-glob-test-'));
    globTool = createGlobTool({ defaultCwd: tmpDir, respectGitignore: false });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('matches files with a simple pattern', async () => {
    fs.writeFileSync(path.join(tmpDir, 'file1.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'file2.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'file3.js'), '');

    const result = await globTool.execute({ pattern: '*.ts' });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('file1.ts');
    expect(text).toContain('file2.ts');
    expect(text).not.toContain('file3.js');
  });

  it('matches files recursively with **', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'root.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'src', 'deep.ts'), '');

    const result = await globTool.execute({ pattern: '**/*.ts' });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('root.ts');
    expect(text).toContain('deep.ts');
  });

  it('returns empty for no matches', async () => {
    const result = await globTool.execute({ pattern: '*.xyz' });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('No files matched');
    expect(result.details.totalCount).toBe(0);
  });

  it('returns error for nonexistent directory', async () => {
    const result = await globTool.execute({
      pattern: '*.ts',
      path: '/nonexistent/dir',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Directory does not exist');
  });

  it('respects gitignore patterns when enabled', async () => {
    const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-glob-git-'));
    try {
      fs.mkdirSync(path.join(gitDir, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(gitDir, 'app.ts'), '');
      fs.writeFileSync(path.join(gitDir, 'node_modules', 'dep.ts'), '');

      // Default ignore patterns should skip node_modules
      const tool = createGlobTool({ defaultCwd: gitDir, respectGitignore: true });
      const result = await tool.execute({ pattern: '**/*.ts' });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('app.ts');
      expect(text).not.toContain('dep.ts');
    } finally {
      fs.rmSync(gitDir, { recursive: true, force: true });
    }
  });

  it('sorts by modification time (newest first)', async () => {
    const file1 = path.join(tmpDir, 'older.ts');
    const file2 = path.join(tmpDir, 'newer.ts');

    fs.writeFileSync(file1, 'old');
    // Set older mtime
    const oldTime = new Date(2020, 0, 1);
    fs.utimesSync(file1, oldTime, oldTime);

    fs.writeFileSync(file2, 'new');

    const result = await globTool.execute({ pattern: '*.ts' });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    const lines = text.split('\n');
    // Newer file should appear first
    expect(lines[0]).toContain('newer.ts');
  });

  it('uses forward slashes in output paths', async () => {
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'sub', 'file.ts'), '');

    const result = await globTool.execute({ pattern: '**/*.ts' });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('/sub/file.ts');
    expect(text).not.toContain('\\');
  });

  it('provides duration in details', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), '');

    const result = await globTool.execute({ pattern: '*.ts' });

    expect(result.details.durationMs).toBeGreaterThanOrEqual(0);
  });
});
