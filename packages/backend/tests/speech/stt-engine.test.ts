import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  mockStream,
  mockCreateStream,
  mockDecodeAsync,
  MockOfflineRecognizer,
} = vi.hoisted(() => {
  const mockStream = {
    acceptWaveform: vi.fn(),
  };
  const mockCreateStream = vi.fn().mockReturnValue(mockStream);
  const mockDecodeAsync = vi.fn().mockResolvedValue({ text: '  Hello world  ' });
  const MockOfflineRecognizer = vi.fn().mockImplementation(() => ({
    createStream: mockCreateStream,
    decodeAsync: mockDecodeAsync,
  }));

  return {
    mockStream,
    mockCreateStream,
    mockDecodeAsync,
    MockOfflineRecognizer,
  };
});

// Mock sherpa-onnx-node before importing STTEngine
vi.mock('sherpa-onnx-node', () => {
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
    vi.clearAllMocks();
    mockCreateStream.mockReturnValue(mockStream);
    mockDecodeAsync.mockResolvedValue({ text: '  Hello world  ' });
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
      const samples = new Float32Array(1600).fill(0.1);
      const text = await engine.transcribe(samples, 16000);
      expect(text).toBe('Hello world');
    });

    it('rejects empty audio before calling the native recognizer', async () => {
      const sttDir = path.join(tmpDir, 'stt');
      fs.mkdirSync(sttDir, { recursive: true });
      fs.writeFileSync(path.join(sttDir, 'encoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'decoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'joiner.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'tokens.txt'), '');

      const engine = new STTEngine(tmpDir);
      await expect(engine.transcribe(new Float32Array(0), 16000)).rejects.toThrow(
        'Audio contains no PCM samples',
      );
      expect(mockCreateStream).not.toHaveBeenCalled();
      expect(mockDecodeAsync).not.toHaveBeenCalled();
    });

    it('surfaces native decode failures as rejected transcription errors', async () => {
      const sttDir = path.join(tmpDir, 'stt');
      fs.mkdirSync(sttDir, { recursive: true });
      fs.writeFileSync(path.join(sttDir, 'encoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'decoder.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'joiner.int8.onnx'), '');
      fs.writeFileSync(path.join(sttDir, 'tokens.txt'), '');
      mockDecodeAsync.mockRejectedValue(new Error('Invalid input shape: {0,128}'));

      const engine = new STTEngine(tmpDir);
      await expect(engine.transcribe(new Float32Array(1600).fill(0.1), 16000)).rejects.toThrow(
        'Invalid input shape',
      );
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
