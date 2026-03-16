import { describe, it, expect, beforeEach } from 'vitest';
import { ReadRegistry } from '../../../src/tools/shared/read-registry.js';

describe('ReadRegistry', () => {
  let registry: ReadRegistry;

  beforeEach(() => {
    registry = new ReadRegistry();
  });

  it('starts empty', () => {
    expect(registry.size).toBe(0);
    expect(registry.hasBeenRead('/some/file.txt')).toBe(false);
  });

  it('marks a file as read', () => {
    registry.markRead('/some/file.txt');
    expect(registry.hasBeenRead('/some/file.txt')).toBe(true);
    expect(registry.size).toBe(1);
  });

  it('handles multiple files', () => {
    registry.markRead('/file1.txt');
    registry.markRead('/file2.txt');
    expect(registry.hasBeenRead('/file1.txt')).toBe(true);
    expect(registry.hasBeenRead('/file2.txt')).toBe(true);
    expect(registry.hasBeenRead('/file3.txt')).toBe(false);
    expect(registry.size).toBe(2);
  });

  it('normalizes paths to absolute', () => {
    const cwd = process.cwd();
    registry.markRead('relative/path.txt');
    expect(registry.hasBeenRead(`${cwd}/relative/path.txt`)).toBe(true);
  });

  it('clears all tracked files', () => {
    registry.markRead('/file1.txt');
    registry.markRead('/file2.txt');
    expect(registry.size).toBe(2);
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.hasBeenRead('/file1.txt')).toBe(false);
  });

  it('does not double-count re-reads of the same file', () => {
    registry.markRead('/file.txt');
    registry.markRead('/file.txt');
    expect(registry.size).toBe(1);
  });
});
