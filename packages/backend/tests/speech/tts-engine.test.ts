import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock @animus/tts-native before importing TTSEngine
const mockGenerate = vi.fn().mockResolvedValue(new Float32Array([0.1, -0.2, 0.3, -0.4]));
const mockCreateVoiceState = vi.fn().mockResolvedValue({ __voiceState: true });
const mockLoad = vi.fn().mockResolvedValue({
  generate: mockGenerate,
  createVoiceState: mockCreateVoiceState,
  sampleRate: 24000,
});

vi.mock('@animus/tts-native', () => ({
  PocketTTS: {
    load: mockLoad,
  },
}));

// Mock logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { TTSEngine, type TTSEngineConfig } from '../../src/speech/tts-engine.js';
import type { VoiceManager, VoiceEntry } from '../../src/speech/voice-manager.js';

function createMockVoiceManager(voices: VoiceEntry[] = []): VoiceManager {
  return {
    listVoices: vi.fn().mockReturnValue(voices),
    getVoice: vi.fn().mockImplementation((id: string) => voices.find((v) => v.id === id) ?? null),
    loadVoiceSamples: vi.fn().mockResolvedValue({
      samples: new Float32Array([0.5, -0.5]),
      sampleRate: 16000,
    }),
    loadVoiceWavBuffer: vi.fn().mockResolvedValue(Buffer.from('RIFF fake wav data')),
    initialize: vi.fn(),
    addCustomVoice: vi.fn(),
    removeCustomVoice: vi.fn(),
  } as unknown as VoiceManager;
}

function createTtsModelFiles(modelsPath: string): void {
  const ttsDir = path.join(modelsPath, 'tts');
  fs.mkdirSync(ttsDir, { recursive: true });
  fs.writeFileSync(path.join(ttsDir, 'tts_b6369a24.safetensors'), '');
  fs.writeFileSync(path.join(ttsDir, 'tokenizer.model'), '');
}

describe('TTSEngine', () => {
  let tmpDir: string;
  let config: TTSEngineConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animus-test-'));
    config = { modelsPath: tmpDir, defaultSpeed: 1.0 };
    vi.clearAllMocks();
    // Reset mock implementations after clearAllMocks
    mockGenerate.mockResolvedValue(new Float32Array([0.1, -0.2, 0.3, -0.4]));
    mockCreateVoiceState.mockResolvedValue({ __voiceState: true });
    mockLoad.mockResolvedValue({
      generate: mockGenerate,
      createVoiceState: mockCreateVoiceState,
      sampleRate: 24000,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ============================================================================
  // isAvailable
  // ============================================================================

  describe('isAvailable', () => {
    it('returns false when model files do not exist', () => {
      const vm = createMockVoiceManager();
      const engine = new TTSEngine(config, vm);
      expect(engine.isAvailable()).toBe(false);
    });

    it('returns true when all model files exist', () => {
      createTtsModelFiles(tmpDir);
      const vm = createMockVoiceManager();
      const engine = new TTSEngine(config, vm);
      expect(engine.isAvailable()).toBe(true);
    });
  });

  // ============================================================================
  // synthesize
  // ============================================================================

  describe('synthesize', () => {
    it('returns TTSResult with samples, sampleRate, and wavBuffer', async () => {
      createTtsModelFiles(tmpDir);
      const voice: VoiceEntry = {
        id: 'alba',
        name: 'Alba',
        type: 'builtin',
        filePath: 'builtin/alba.wav',
        addedAt: new Date().toISOString(),
      };
      const vm = createMockVoiceManager([voice]);
      const engine = new TTSEngine(config, vm);

      const result = await engine.synthesize('Hello world');

      expect(result.samples).toBeInstanceOf(Float32Array);
      expect(result.samples.length).toBe(4);
      expect(result.sampleRate).toBe(24000);
      expect(result.wavBuffer).toBeInstanceOf(Buffer);
      // WAV header starts with RIFF
      expect(result.wavBuffer.toString('ascii', 0, 4)).toBe('RIFF');
    });

    it('calls PocketTTS.load with the tts model directory', async () => {
      createTtsModelFiles(tmpDir);
      const voice: VoiceEntry = {
        id: 'alba',
        name: 'Alba',
        type: 'builtin',
        filePath: 'builtin/alba.wav',
        addedAt: new Date().toISOString(),
      };
      const vm = createMockVoiceManager([voice]);
      const engine = new TTSEngine(config, vm);

      await engine.synthesize('Hello');

      expect(mockLoad).toHaveBeenCalledWith(path.join(tmpDir, 'tts'));
    });

    it('uses specified voiceId when provided', async () => {
      createTtsModelFiles(tmpDir);
      const voice: VoiceEntry = {
        id: 'custom-1',
        name: 'Custom',
        type: 'custom',
        filePath: 'custom/custom-1.wav',
        addedAt: new Date().toISOString(),
      };
      const vm = createMockVoiceManager([voice]);
      const engine = new TTSEngine(config, vm);

      await engine.synthesize('Test', { voiceId: 'custom-1' });

      expect(vm.loadVoiceWavBuffer).toHaveBeenCalledWith('custom-1');
    });

    it('creates voice state from WAV buffer', async () => {
      createTtsModelFiles(tmpDir);
      const voice: VoiceEntry = {
        id: 'alba',
        name: 'Alba',
        type: 'builtin',
        filePath: 'builtin/alba.wav',
        addedAt: new Date().toISOString(),
      };
      const vm = createMockVoiceManager([voice]);
      const engine = new TTSEngine(config, vm);

      await engine.synthesize('Hello');

      expect(mockCreateVoiceState).toHaveBeenCalledTimes(1);
      expect(mockGenerate).toHaveBeenCalledWith('Hello', { __voiceState: true });
    });

    it('throws when models are not available', async () => {
      const vm = createMockVoiceManager();
      const engine = new TTSEngine(config, vm);

      await expect(engine.synthesize('Hello')).rejects.toThrow('TTS model files not found');
    });

    it('throws when no voices are available', async () => {
      createTtsModelFiles(tmpDir);
      const vm = createMockVoiceManager([]); // no voices
      const engine = new TTSEngine(config, vm);

      await expect(engine.synthesize('Hello')).rejects.toThrow('No voices available');
    });
  });

  // ============================================================================
  // Voice caching
  // ============================================================================

  describe('voice caching', () => {
    it('loads the same voice only once', async () => {
      createTtsModelFiles(tmpDir);
      const voice: VoiceEntry = {
        id: 'alba',
        name: 'Alba',
        type: 'builtin',
        filePath: 'builtin/alba.wav',
        addedAt: new Date().toISOString(),
      };
      const vm = createMockVoiceManager([voice]);
      const engine = new TTSEngine(config, vm);

      await engine.synthesize('First');
      await engine.synthesize('Second');

      // loadVoiceWavBuffer and createVoiceState should only be called once due to caching
      expect(vm.loadVoiceWavBuffer).toHaveBeenCalledTimes(1);
      expect(mockCreateVoiceState).toHaveBeenCalledTimes(1);
    });

    it('reloads when a different voice is requested', async () => {
      createTtsModelFiles(tmpDir);
      const voices: VoiceEntry[] = [
        { id: 'alba', name: 'Alba', type: 'builtin', filePath: 'builtin/alba.wav', addedAt: new Date().toISOString() },
        { id: 'marius', name: 'Marius', type: 'builtin', filePath: 'builtin/marius.wav', addedAt: new Date().toISOString() },
      ];
      const vm = createMockVoiceManager(voices);
      const engine = new TTSEngine(config, vm);

      await engine.synthesize('First', { voiceId: 'alba' });
      await engine.synthesize('Second', { voiceId: 'marius' });

      expect(vm.loadVoiceWavBuffer).toHaveBeenCalledTimes(2);
      expect(vm.loadVoiceWavBuffer).toHaveBeenCalledWith('alba');
      expect(vm.loadVoiceWavBuffer).toHaveBeenCalledWith('marius');
      expect(mockCreateVoiceState).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================================
  // setDefaultVoice
  // ============================================================================

  describe('setDefaultVoice', () => {
    it('updates the cached voice', async () => {
      createTtsModelFiles(tmpDir);
      const voice: VoiceEntry = {
        id: 'alba',
        name: 'Alba',
        type: 'builtin',
        filePath: 'builtin/alba.wav',
        addedAt: new Date().toISOString(),
      };
      const vm = createMockVoiceManager([voice]);
      const engine = new TTSEngine(config, vm);

      // Need to load the model first
      await engine.ensureLoaded();
      await engine.setDefaultVoice('alba');
      expect(vm.loadVoiceWavBuffer).toHaveBeenCalledWith('alba');

      // Subsequent synthesize should not reload (already cached)
      await engine.synthesize('Test');
      expect(vm.loadVoiceWavBuffer).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // dispose
  // ============================================================================

  describe('dispose', () => {
    it('clears internal state', async () => {
      createTtsModelFiles(tmpDir);
      const voice: VoiceEntry = {
        id: 'alba',
        name: 'Alba',
        type: 'builtin',
        filePath: 'builtin/alba.wav',
        addedAt: new Date().toISOString(),
      };
      const vm = createMockVoiceManager([voice]);
      const engine = new TTSEngine(config, vm);

      await engine.ensureLoaded();
      engine.dispose();

      // After dispose, ensureLoaded should re-load
      await engine.ensureLoaded();
      // PocketTTS.load should have been called twice
      expect(mockLoad).toHaveBeenCalledTimes(2);
    });
  });
});
