/**
 * Tests for logger utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  defaultLogger,
  createTaggedLogger,
  createSilentLogger,
  createCollectingLogger,
} from '../../src/logger.js';

describe('defaultLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('has all required methods', () => {
    expect(typeof defaultLogger.debug).toBe('function');
    expect(typeof defaultLogger.info).toBe('function');
    expect(typeof defaultLogger.warn).toBe('function');
    expect(typeof defaultLogger.error).toBe('function');
  });

  it('calls console.info for info level', () => {
    defaultLogger.info('Test message');
    expect(console.info).toHaveBeenCalled();
  });

  it('calls console.warn for warn level', () => {
    defaultLogger.warn('Warning message');
    expect(console.warn).toHaveBeenCalled();
  });

  it('calls console.error for error level', () => {
    defaultLogger.error('Error message');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('createTaggedLogger', () => {
  it('prefixes messages with tag', () => {
    const collector = createCollectingLogger();
    const tagged = createTaggedLogger('MyComponent', collector);

    tagged.info('Test message');

    expect(collector.entries.length).toBe(1);
    expect(collector.entries[0].message).toContain('[MyComponent]');
    expect(collector.entries[0].message).toContain('Test message');
  });

  it('passes context through', () => {
    const collector = createCollectingLogger();
    const tagged = createTaggedLogger('Tag', collector);

    tagged.info('Message', { key: 'value' });

    expect(collector.entries[0].context).toEqual({ key: 'value' });
  });

  it('uses default logger when base not provided', () => {
    const tagged = createTaggedLogger('Test');

    // Should not throw
    expect(() => tagged.info('Test')).not.toThrow();
  });
});

describe('createSilentLogger', () => {
  it('produces no output', () => {
    const silent = createSilentLogger();

    // These should not throw
    silent.debug('debug');
    silent.info('info');
    silent.warn('warn');
    silent.error('error');
  });

  it('has all required methods', () => {
    const silent = createSilentLogger();

    expect(typeof silent.debug).toBe('function');
    expect(typeof silent.info).toBe('function');
    expect(typeof silent.warn).toBe('function');
    expect(typeof silent.error).toBe('function');
  });
});

describe('createCollectingLogger', () => {
  it('collects log entries', () => {
    const collector = createCollectingLogger();

    collector.debug('Debug message');
    collector.info('Info message');
    collector.warn('Warn message');
    collector.error('Error message');

    expect(collector.entries.length).toBe(4);
  });

  it('records level correctly', () => {
    const collector = createCollectingLogger();

    collector.debug('d');
    collector.info('i');
    collector.warn('w');
    collector.error('e');

    expect(collector.entries[0].level).toBe('debug');
    expect(collector.entries[1].level).toBe('info');
    expect(collector.entries[2].level).toBe('warn');
    expect(collector.entries[3].level).toBe('error');
  });

  it('records message', () => {
    const collector = createCollectingLogger();

    collector.info('Test message');

    expect(collector.entries[0].message).toBe('Test message');
  });

  it('records context', () => {
    const collector = createCollectingLogger();

    collector.info('Message', { key: 'value', num: 42 });

    expect(collector.entries[0].context).toEqual({ key: 'value', num: 42 });
  });

  it('records timestamp', () => {
    const before = new Date();
    const collector = createCollectingLogger();
    collector.info('Message');
    const after = new Date();

    const timestamp = collector.entries[0].timestamp;
    expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('clears entries', () => {
    const collector = createCollectingLogger();

    collector.info('Message 1');
    collector.info('Message 2');
    expect(collector.entries.length).toBe(2);

    collector.clear();
    expect(collector.entries.length).toBe(0);
  });
});
