import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock sherpa-onnx-node
vi.mock('sherpa-onnx-node', () => ({
  OfflineRecognizerConfig: vi.fn().mockImplementation((cfg: any) => cfg),
  OfflineModelConfig: vi.fn().mockImplementation((cfg: any) => cfg),
  OfflineTransducerModelConfig: vi.fn().mockImplementation((cfg: any) => cfg),
  OfflineRecognizer: vi.fn().mockImplementation(() => ({
    createStream: vi.fn(),
    decode: vi.fn(),
  })),
  OfflineTtsConfig: vi.fn().mockImplementation((cfg: any) => cfg),
  OfflineTtsModelConfig: vi.fn().mockImplementation((cfg: any) => cfg),
  OfflineTtsKokoroModelConfig: vi.fn().mockImplementation((cfg: any) => cfg),
  OfflineTts: vi.fn().mockImplementation(() => ({
    generate: vi.fn(),
  })),
  GenerationConfig: vi.fn().mockImplementation((cfg: any) => cfg),
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

import {
  SpeechService,
  getSpeechService,
  initSpeechService,
  _resetSpeechService,
} from '../../src/speech/speech-service.js';

describe('SpeechService', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animus-test-'));
    _resetSpeechService();
  });

  afterEach(() => {
    _resetSpeechService();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ============================================================================
  // getSpeechService
  // ============================================================================

  describe('getSpeechService', () => {
    it('throws before initialization', () => {
      expect(() => getSpeechService()).toThrow('Speech service not initialized');
    });
  });

  // ============================================================================
  // initSpeechService
  // ============================================================================

  describe('initSpeechService', () => {
    it('creates and returns singleton', async () => {
      const service = await initSpeechService({ dataDir: tmpDir });

      expect(service).toBeInstanceOf(SpeechService);
      expect(getSpeechService()).toBe(service);
    });

    it('returns existing instance on second call', async () => {
      const first = await initSpeechService({ dataDir: tmpDir });
      const second = await initSpeechService({ dataDir: tmpDir });

      expect(first).toBe(second);
    });

    it('creates voice directory structure', async () => {
      await initSpeechService({ dataDir: tmpDir });

      expect(fs.existsSync(path.join(tmpDir, 'voices', 'builtin'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'voices', 'custom'))).toBe(true);
    });
  });

  // ============================================================================
  // getStatus
  // ============================================================================

  describe('getStatus', () => {
    it('returns availability info', async () => {
      const service = await initSpeechService({ dataDir: tmpDir });
      const status = service.getStatus();

      expect(status).toEqual({
        sttAvailable: false, // no model files in temp dir
        ttsAvailable: false,
        voiceCount: 0,
      });
    });

    it('reflects STT availability when model files exist', async () => {
      const sttDir = path.join(tmpDir, 'models', 'stt');
      fs.mkdirSync(sttDir, { recursive: true });
      fs.writeFileSync(path.join(sttDir, 'encoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'decoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'joiner.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'tokens.txt'), '');

      const service = await initSpeechService({ dataDir: tmpDir });
      const status = service.getStatus();

      expect(status.sttAvailable).toBe(true);
      expect(status.ttsAvailable).toBe(false);
    });
  });

  // ============================================================================
  // shutdown
  // ============================================================================

  describe('shutdown', () => {
    it('disposes STT and TTS engines', async () => {
      const service = await initSpeechService({ dataDir: tmpDir });

      const sttDispose = vi.spyOn(service.stt, 'dispose');
      const ttsDispose = vi.spyOn(service.tts, 'dispose');

      await service.shutdown();

      expect(sttDispose).toHaveBeenCalled();
      expect(ttsDispose).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // _resetSpeechService
  // ============================================================================

  describe('_resetSpeechService', () => {
    it('clears the singleton', async () => {
      await initSpeechService({ dataDir: tmpDir });
      expect(() => getSpeechService()).not.toThrow();

      _resetSpeechService();

      expect(() => getSpeechService()).toThrow('Speech service not initialized');
    });
  });
});
