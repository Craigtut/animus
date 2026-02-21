import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock sherpa-onnx-node before importing STTEngine
vi.mock('sherpa-onnx-node', () => {
  const mockStream = {
    acceptWaveform: vi.fn(),
  };

  const MockOfflineRecognizer = vi.fn().mockImplementation(() => ({
    createStream: vi.fn().mockReturnValue(mockStream),
    decode: vi.fn(),
    getResult: vi.fn().mockReturnValue({ text: '  Hello world  ' }),
  }));

  return {
    default: {
      OfflineRecognizer: MockOfflineRecognizer,
    },
  };
});

// Mock logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { STTEngine } from '../../src/speech/stt-engine.js';

describe('STTEngine', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animus-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ============================================================================
  // isAvailable
  // ============================================================================

  describe('isAvailable', () => {
    it('returns false when model files do not exist', () => {
      const engine = new STTEngine(tmpDir);
      expect(engine.isAvailable()).toBe(false);
    });

    it('returns false when only some model files exist', () => {
      const sttDir = path.join(tmpDir, 'stt');
      fs.mkdirSync(sttDir, { recursive: true });
      fs.writeFileSync(path.join(sttDir, 'encoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'decoder.int8.onnx'), '');

      const engine = new STTEngine(tmpDir);
      expect(engine.isAvailable()).toBe(false);
    });

    it('returns true when all model files exist', () => {
      const sttDir = path.join(tmpDir, 'stt');
      fs.mkdirSync(sttDir, { recursive: true });
      fs.writeFileSync(path.join(sttDir, 'encoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'decoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'joiner.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'tokens.txt'), '');

      const engine = new STTEngine(tmpDir);
      expect(engine.isAvailable()).toBe(true);
    });
  });

  // ============================================================================
  // ensureLoaded
  // ============================================================================

  describe('ensureLoaded', () => {
    it('throws when models are not available', async () => {
      const engine = new STTEngine(tmpDir);
      await expect(engine.ensureLoaded()).rejects.toThrow('STT model files not found');
    });

    it('loads successfully when models exist', async () => {
      const sttDir = path.join(tmpDir, 'stt');
      fs.mkdirSync(sttDir, { recursive: true });
      fs.writeFileSync(path.join(sttDir, 'encoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'decoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'joiner.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'tokens.txt'), '');

      const engine = new STTEngine(tmpDir);
      await expect(engine.ensureLoaded()).resolves.not.toThrow();
    });

    it('is idempotent (second call is a no-op)', async () => {
      const sttDir = path.join(tmpDir, 'stt');
      fs.mkdirSync(sttDir, { recursive: true });
      fs.writeFileSync(path.join(sttDir, 'encoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'decoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'joiner.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'tokens.txt'), '');

      const engine = new STTEngine(tmpDir);
      await engine.ensureLoaded();
      await expect(engine.ensureLoaded()).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // transcribe
  // ============================================================================

  describe('transcribe', () => {
    it('returns trimmed transcribed text', async () => {
      const sttDir = path.join(tmpDir, 'stt');
      fs.mkdirSync(sttDir, { recursive: true });
      fs.writeFileSync(path.join(sttDir, 'encoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'decoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'joiner.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'tokens.txt'), '');

      const engine = new STTEngine(tmpDir);
      const samples = new Float32Array([0.1, 0.2, 0.3]);
      const text = await engine.transcribe(samples, 16000);
      expect(text).toBe('Hello world');
    });
  });

  // ============================================================================
  // dispose
  // ============================================================================

  describe('dispose', () => {
    it('clears internal state', async () => {
      const sttDir = path.join(tmpDir, 'stt');
      fs.mkdirSync(sttDir, { recursive: true });
      fs.writeFileSync(path.join(sttDir, 'encoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'decoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'joiner.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'tokens.txt'), '');

      const engine = new STTEngine(tmpDir);
      await engine.ensureLoaded();
      engine.dispose();

      // After dispose, ensureLoaded should re-load (not throw because files still exist)
      await expect(engine.ensureLoaded()).resolves.not.toThrow();
    });
  });
});
