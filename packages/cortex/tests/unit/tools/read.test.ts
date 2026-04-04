import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ReadRegistry } from '../../../src/tools/shared/read-registry.js';
import { createReadTool } from '../../../src/tools/read.js';

describe('Read tool', () => {
  let registry: ReadRegistry;
  let readTool: ReturnType<typeof createReadTool>;
  let tmpDir: string;

  beforeEach(() => {
    registry = new ReadRegistry();
    readTool = createReadTool({ readRegistry: registry });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-read-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads a text file with line numbers', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'line one\nline two\nline three\n');

    const result = await readTool.execute({ file_path: filePath });

    expect(result.content[0]?.type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('1\tline one');
    expect(text).toContain('2\tline two');
    expect(text).toContain('3\tline three');
    expect(result.details.totalLines).toBe(4); // trailing newline creates empty last line
    expect(result.details.filePath).toBe(filePath);
  });

  it('marks the file as read in the registry', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'content');

    expect(registry.hasBeenRead(filePath)).toBe(false);
    await readTool.execute({ file_path: filePath });
    expect(registry.hasBeenRead(filePath)).toBe(true);
  });

  it('reads with offset and limit', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const filePath = path.join(tmpDir, 'large.txt');
    fs.writeFileSync(filePath, lines.join('\n'));

    const result = await readTool.execute({
      file_path: filePath,
      offset: 5,
      limit: 3,
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('5\tline 5');
    expect(text).toContain('6\tline 6');
    expect(text).toContain('7\tline 7');
    expect(text).not.toContain('line 4');
    expect(text).not.toContain('line 8');
  });

  it('returns error for nonexistent file', async () => {
    const result = await readTool.execute({ file_path: '/nonexistent/file.txt' });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('File does not exist');
  });

  it('returns error for directory', async () => {
    const result = await readTool.execute({ file_path: tmpDir });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Cannot read a directory');
  });

  it('detects and returns image files as base64', async () => {
    const filePath = path.join(tmpDir, 'test.png');
    // Create a minimal PNG file (8-byte header)
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fs.writeFileSync(filePath, pngHeader);

    const result = await readTool.execute({ file_path: filePath });

    expect(result.content[0]?.type).toBe('image');
    const imageContent = result.content[0] as { type: 'image'; data: string; mimeType: string };
    expect(imageContent.mimeType).toBe('image/png');
    expect(imageContent.data).toBe(pngHeader.toString('base64'));
  });

  it('detects binary files', async () => {
    const filePath = path.join(tmpDir, 'binary.dat');
    const buffer = Buffer.alloc(1024);
    buffer[0] = 0x00; // null byte
    buffer[10] = 0x00;
    fs.writeFileSync(filePath, buffer);

    const result = await readTool.execute({ file_path: filePath });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Binary file detected');
  });

  it('handles empty files', async () => {
    const filePath = path.join(tmpDir, 'empty.txt');
    fs.writeFileSync(filePath, '');

    const result = await readTool.execute({ file_path: filePath });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('File is empty');
  });

  it('truncates long lines', async () => {
    const filePath = path.join(tmpDir, 'longline.txt');
    const longLine = 'x'.repeat(3000);
    fs.writeFileSync(filePath, longLine);

    const result = await readTool.execute({ file_path: filePath });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('... [truncated]');
    expect(result.details.truncatedChars).toBe(true);
  });

  it('handles UTF-8 content', async () => {
    const filePath = path.join(tmpDir, 'utf8.txt');
    fs.writeFileSync(filePath, 'Hello \u00e9\u00e8\u00ea \u4e16\u754c\n');

    const result = await readTool.execute({ file_path: filePath });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('\u00e9\u00e8\u00ea');
    expect(text).toContain('\u4e16\u754c');
  });

  it('returns PDF message for .pdf files instead of binary error', async () => {
    const filePath = path.join(tmpDir, 'document.pdf');
    // PDF files start with %PDF header and contain null bytes (binary)
    const pdfHeader = Buffer.from('%PDF-1.4 fake pdf content');
    const pdfContent = Buffer.concat([pdfHeader, Buffer.alloc(100)]);
    fs.writeFileSync(filePath, pdfContent);

    const result = await readTool.execute({ file_path: filePath });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('PDF file detected');
    expect(text).toContain('pdf-parse');
    expect(text).not.toContain('Binary file detected');
  });

  it('accepts the pages parameter for PDF files', async () => {
    const filePath = path.join(tmpDir, 'document.pdf');
    fs.writeFileSync(filePath, '%PDF-1.4 fake');

    const result = await readTool.execute({ file_path: filePath, pages: '1-5' });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('PDF file detected');
  });

  it('shows truncation notice when file exceeds limit', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const filePath = path.join(tmpDir, 'many-lines.txt');
    fs.writeFileSync(filePath, lines.join('\n'));

    const result = await readTool.execute({
      file_path: filePath,
      limit: 10,
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Showing lines');
    expect(text).toContain('of 100 total');
    expect(result.details.truncatedLines).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Device path blocking
  // -----------------------------------------------------------------------

  describe('device path blocking', () => {
    it('blocks /dev/zero', async () => {
      const result = await readTool.execute({ file_path: '/dev/zero' });
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('would block or produce infinite output');
    });

    it('blocks /dev/random', async () => {
      const result = await readTool.execute({ file_path: '/dev/random' });
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('would block or produce infinite output');
    });

    it('blocks /dev/stdin', async () => {
      const result = await readTool.execute({ file_path: '/dev/stdin' });
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('would block or produce infinite output');
    });

    it('blocks /dev/tty', async () => {
      const result = await readTool.execute({ file_path: '/dev/tty' });
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('would block or produce infinite output');
    });

    it('blocks /proc/self/fd/0', async () => {
      const result = await readTool.execute({ file_path: '/proc/self/fd/0' });
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('would block or produce infinite output');
    });

    it('blocks /proc/123/fd/1', async () => {
      const result = await readTool.execute({ file_path: '/proc/123/fd/1' });
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('would block or produce infinite output');
    });

    it('allows /dev/null (not blocked)', async () => {
      const result = await readTool.execute({ file_path: '/dev/null' });
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      // /dev/null is empty, should not trigger device blocking
      expect(text).not.toContain('would block');
    });
  });

  // -----------------------------------------------------------------------
  // File-unchanged dedup
  // -----------------------------------------------------------------------

  describe('file-unchanged dedup', () => {
    it('returns unchanged stub on re-read of same file', async () => {
      const filePath = path.join(tmpDir, 'stable.txt');
      fs.writeFileSync(filePath, 'hello world\n');

      // First read: returns content
      const first = await readTool.execute({ file_path: filePath });
      const firstText = (first.content[0] as { type: 'text'; text: string }).text;
      expect(firstText).toContain('hello world');

      // Second read (same file, same range): returns stub
      const second = await readTool.execute({ file_path: filePath });
      const secondText = (second.content[0] as { type: 'text'; text: string }).text;
      expect(secondText).toContain('File unchanged since last read');
    });

    it('returns full content when file is modified between reads', async () => {
      const filePath = path.join(tmpDir, 'changing.txt');
      fs.writeFileSync(filePath, 'version 1\n');

      // First read
      await readTool.execute({ file_path: filePath });

      // Modify the file (need to change mtime)
      // Touch the file with a different timestamp
      const futureTime = Date.now() + 2000;
      fs.utimesSync(filePath, futureTime / 1000, futureTime / 1000);

      // Second read: file changed, should return full content
      const second = await readTool.execute({ file_path: filePath });
      const secondText = (second.content[0] as { type: 'text'; text: string }).text;
      expect(secondText).toContain('version 1');
      expect(secondText).not.toContain('unchanged');
    });

    it('returns full content when different range is requested', async () => {
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
      const filePath = path.join(tmpDir, 'multirange.txt');
      fs.writeFileSync(filePath, lines.join('\n'));

      // Read lines 1-10
      await readTool.execute({ file_path: filePath, offset: 1, limit: 10 });

      // Read lines 20-30 (different range): should return full content
      const second = await readTool.execute({ file_path: filePath, offset: 20, limit: 10 });
      const secondText = (second.content[0] as { type: 'text'; text: string }).text;
      expect(secondText).toContain('line 20');
      expect(secondText).not.toContain('unchanged');
    });

    it('does not dedup after registry is cleared', async () => {
      const filePath = path.join(tmpDir, 'cleared.txt');
      fs.writeFileSync(filePath, 'content\n');

      // First read
      await readTool.execute({ file_path: filePath });

      // Clear registry (simulates new agentic loop)
      registry.clear();

      // Second read: no dedup, returns full content
      const second = await readTool.execute({ file_path: filePath });
      const secondText = (second.content[0] as { type: 'text'; text: string }).text;
      expect(secondText).toContain('content');
      expect(secondText).not.toContain('unchanged');
    });
  });
});
