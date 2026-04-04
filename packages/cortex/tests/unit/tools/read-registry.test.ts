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

  // -----------------------------------------------------------------------
  // ReadState tracking (new)
  // -----------------------------------------------------------------------

  it('stores and retrieves read state with metadata', () => {
    registry.markRead('/file.txt', { timestamp: 1000, offset: 1, limit: 100 });

    const state = registry.getState('/file.txt');
    expect(state).toBeDefined();
    expect(state!.timestamp).toBe(1000);
    expect(state!.offset).toBe(1);
    expect(state!.limit).toBe(100);
  });

  it('returns undefined state for unread files', () => {
    expect(registry.getState('/unread.txt')).toBeUndefined();
  });

  it('creates default state when markRead is called without state', () => {
    registry.markRead('/file.txt');

    const state = registry.getState('/file.txt');
    expect(state).toBeDefined();
    expect(state!.timestamp).toBeGreaterThan(0);
    expect(state!.offset).toBeUndefined();
    expect(state!.limit).toBeUndefined();
  });

  it('overwrites state on re-read of the same file', () => {
    registry.markRead('/file.txt', { timestamp: 1000, offset: 1, limit: 10 });
    registry.markRead('/file.txt', { timestamp: 2000, offset: 20, limit: 5 });

    const state = registry.getState('/file.txt');
    expect(state!.timestamp).toBe(2000);
    expect(state!.offset).toBe(20);
    expect(state!.limit).toBe(5);
  });

  it('clears all state on clear()', () => {
    registry.markRead('/file.txt', { timestamp: 1000 });
    registry.clear();

    expect(registry.getState('/file.txt')).toBeUndefined();
  });
});
