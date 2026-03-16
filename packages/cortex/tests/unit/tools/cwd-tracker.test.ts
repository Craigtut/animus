import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'node:path';
import { CwdTracker } from '../../../src/tools/shared/cwd-tracker.js';

describe('CwdTracker', () => {
  let tracker: CwdTracker;
  const defaultDir = '/home/user/workspace';

  beforeEach(() => {
    tracker = new CwdTracker(defaultDir);
  });

  it('starts at the default directory', () => {
    expect(tracker.getCwd()).toBe(path.resolve(defaultDir));
  });

  it('returns the default directory', () => {
    expect(tracker.getDefaultDir()).toBe(path.resolve(defaultDir));
  });

  it('updates the working directory', () => {
    tracker.updateCwd('/tmp/other');
    expect(tracker.getCwd()).toBe(path.resolve('/tmp/other'));
  });

  it('resolves relative paths to absolute', () => {
    tracker.updateCwd('subdir');
    // Should resolve relative to process.cwd()
    expect(path.isAbsolute(tracker.getCwd())).toBe(true);
  });

  it('resets to the default directory', () => {
    tracker.updateCwd('/tmp/other');
    expect(tracker.getCwd()).toBe(path.resolve('/tmp/other'));
    tracker.reset();
    expect(tracker.getCwd()).toBe(path.resolve(defaultDir));
  });

  it('tracks multiple updates', () => {
    tracker.updateCwd('/first');
    expect(tracker.getCwd()).toBe(path.resolve('/first'));
    tracker.updateCwd('/second');
    expect(tracker.getCwd()).toBe(path.resolve('/second'));
    tracker.updateCwd('/third');
    expect(tracker.getCwd()).toBe(path.resolve('/third'));
  });
});
