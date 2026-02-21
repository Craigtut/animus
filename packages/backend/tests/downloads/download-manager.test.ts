import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

// Mock logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock event bus
const mockEventBus = new EventEmitter();
const emitSpy = vi.fn((...args: unknown[]) => {
  mockEventBus.emit(args[0] as string, args[1]);
});
vi.mock('../../src/lib/event-bus.js', () => ({
  getEventBus: () => ({
    on: (ev: string, fn: (...args: unknown[]) => void) => mockEventBus.on(ev, fn),
    off: (ev: string, fn: (...args: unknown[]) => void) => mockEventBus.off(ev, fn),
    emit: emitSpy,
  }),
}));

// Mock unbzip2-stream (CJS require)
vi.mock('unbzip2-stream', () => {
  const { PassThrough } = require('node:stream');
  return { default: () => new PassThrough() };
});

import { DownloadManager } from '../../src/downloads/download-manager.js';
import {
  initDownloadManager,
  getDownloadManager,
  _resetDownloadManager,
} from '../../src/downloads/index.js';
import {
  ASSET_REGISTRY,
  getSpeechAssets,
  getAssetsByCategory,
  type AssetDefinition,
} from '../../src/downloads/asset-registry.js';

// ============================================================================
// Test asset
// ============================================================================

function makeTestAsset(overrides: Partial<AssetDefinition> = {}): AssetDefinition {
  return {
    id: 'test-asset',
    label: 'Test Asset',
    category: 'test',
    url: 'https://example.com/test.tar.bz2',
    estimatedBytes: 1000,
    extractionConfig: {
      type: 'tar.bz2' as const,
      stripComponents: 1,
      targetDir: 'models/test',
    },
    requiredFiles: ['model.onnx'],
    ...overrides,
  };
}

describe('Asset Registry', () => {
  it('has STT and TTS entries', () => {
    expect(ASSET_REGISTRY['stt-parakeet-tdt-v3']).toBeDefined();
    expect(ASSET_REGISTRY['tts-pocket-tts']).toBeDefined();
  });

  it('getSpeechAssets returns all in order', () => {
    const assets = getSpeechAssets();
    expect(assets).toHaveLength(3);
    expect(assets[0].id).toBe('stt-parakeet-tdt-v3');
    expect(assets[1].id).toBe('tts-pocket-tts');
    expect(assets[2].id).toBe('tts-pocket-voices');
  });

  it('getAssetsByCategory filters correctly', () => {
    const speech = getAssetsByCategory('speech');
    expect(speech).toHaveLength(3);
    expect(speech.every((a) => a.category === 'speech')).toBe(true);
  });

  it('getAssetsByCategory returns empty for unknown category', () => {
    expect(getAssetsByCategory('nonexistent')).toHaveLength(0);
  });

  it('STT asset has correct required files', () => {
    const stt = ASSET_REGISTRY['stt-parakeet-tdt-v3'];
    expect(stt.requiredFiles).toContain('encoder.int8.onnx');
    expect(stt.requiredFiles).toContain('decoder.int8.onnx');
    expect(stt.requiredFiles).toContain('joiner.int8.onnx');
    expect(stt.requiredFiles).toContain('tokens.txt');
  });

  it('TTS asset has correct required files', () => {
    const tts = ASSET_REGISTRY['tts-pocket-tts'];
    expect(tts.requiredFiles).toContain('tts_b6369a24.safetensors');
    expect(tts.requiredFiles).toContain('tokenizer.model');
    expect(tts.requiredFiles).toContain('b6369a24.yaml');
  });
});

describe('DownloadManager', () => {
  let tmpDir: string;
  let manager: DownloadManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animus-dl-test-'));
    manager = new DownloadManager(tmpDir);
    emitSpy.mockClear();
    mockEventBus.removeAllListeners();
  });

  afterEach(() => {
    manager.cancelAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // isAssetPresent
  // ==========================================================================

  describe('isAssetPresent', () => {
    it('returns false when files are missing', () => {
      const asset = makeTestAsset();
      expect(manager.isAssetPresent(asset)).toBe(false);
    });

    it('returns true when all required files exist', () => {
      const asset = makeTestAsset();
      const dir = path.join(tmpDir, 'models', 'test');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'model.onnx'), 'data');

      expect(manager.isAssetPresent(asset)).toBe(true);
    });

    it('returns false when only some files exist', () => {
      const asset = makeTestAsset({
        requiredFiles: ['model.onnx', 'tokens.txt'],
      });
      const dir = path.join(tmpDir, 'models', 'test');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'model.onnx'), 'data');
      // tokens.txt is missing

      expect(manager.isAssetPresent(asset)).toBe(false);
    });
  });

  // ==========================================================================
  // enqueue
  // ==========================================================================

  describe('enqueue', () => {
    it('skips assets that are already present', () => {
      const asset = makeTestAsset();
      const dir = path.join(tmpDir, 'models', 'test');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'model.onnx'), 'data');

      manager.enqueue([asset]);
      expect(manager.getAll()).toHaveLength(0);
    });

    it('adds missing assets to state', () => {
      const asset = makeTestAsset();
      // Mock fetch to prevent actual network call
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        new Promise(() => {}), // Never resolves, just hangs
      );

      manager.enqueue([asset]);
      const states = manager.getAll();
      expect(states).toHaveLength(1);
      expect(states[0].assetId).toBe('test-asset');
    });

    it('does not duplicate already-queued assets', () => {
      const asset = makeTestAsset();
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        new Promise(() => {}),
      );

      manager.enqueue([asset]);
      manager.enqueue([asset]); // duplicate
      expect(manager.getAll()).toHaveLength(1);
    });
  });

  // ==========================================================================
  // cancel / cancelAll
  // ==========================================================================

  describe('cancel', () => {
    it('removes asset from state', () => {
      const asset = makeTestAsset();
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        new Promise(() => {}),
      );

      manager.enqueue([asset]);
      expect(manager.getAll()).toHaveLength(1);

      manager.cancel('test-asset');
      expect(manager.getAll()).toHaveLength(0);
    });
  });

  describe('cancelAll', () => {
    it('clears all state', () => {
      const asset1 = makeTestAsset({ id: 'a1' });
      const asset2 = makeTestAsset({ id: 'a2' });
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        new Promise(() => {}),
      );

      manager.enqueue([asset1, asset2]);
      manager.cancelAll();
      expect(manager.getAll()).toHaveLength(0);
    });
  });

  // ==========================================================================
  // get
  // ==========================================================================

  describe('get', () => {
    it('returns undefined for unknown asset', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });

    it('returns state for queued asset', () => {
      const asset = makeTestAsset();
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        new Promise(() => {}),
      );

      manager.enqueue([asset]);
      const state = manager.get('test-asset');
      expect(state).toBeDefined();
      expect(state!.label).toBe('Test Asset');
      expect(state!.category).toBe('test');
    });
  });
});

describe('Singleton', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animus-dl-singleton-'));
    _resetDownloadManager();
  });

  afterEach(() => {
    _resetDownloadManager();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws before initialization', () => {
    expect(() => getDownloadManager()).toThrow('DownloadManager not initialized');
  });

  it('returns singleton after init', () => {
    const dm = initDownloadManager(tmpDir);
    expect(dm).toBeInstanceOf(DownloadManager);
    expect(getDownloadManager()).toBe(dm);
  });

  it('returns same instance on repeated init', () => {
    const first = initDownloadManager(tmpDir);
    const second = initDownloadManager(tmpDir);
    expect(first).toBe(second);
  });

  it('reset clears singleton', () => {
    initDownloadManager(tmpDir);
    _resetDownloadManager();
    expect(() => getDownloadManager()).toThrow('DownloadManager not initialized');
  });
});
