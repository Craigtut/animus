/**
 * Tests for the transcribe_audio tool handler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ToolHandlerContext } from '../../src/tools/types.js';

// Mock the speech service module
vi.mock('../../src/speech/index.js', () => ({
  getSpeechService: vi.fn(),
}));

vi.mock('../../src/speech/audio-utils.js', () => ({
  readWavSamples: vi.fn(),
  webmToPcm: vi.fn(),
}));

const mockContext: ToolHandlerContext = {
  agentTaskId: 'test-task',
  contactId: 'test-contact',
  sourceChannel: 'web',
  conversationId: 'test-conv',
  stores: {
    messages: { createMessage: vi.fn().mockReturnValue({ id: 'msg-1' }) },
    heartbeat: {},
    memory: { retrieveRelevant: vi.fn().mockResolvedValue([]) },
  },
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as any,
};

describe('transcribe_audio handler', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animus-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns error when file does not exist', async () => {
    const { transcribeAudioHandler } = await import(
      '../../src/tools/handlers/transcribe-audio.js'
    );

    const result = await transcribeAudioHandler(
      { filePath: '/nonexistent/audio.wav' },
      mockContext
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Audio file not found');
  });

  it('returns error when speech service is not initialized', async () => {
    const { getSpeechService } = await import('../../src/speech/index.js');
    vi.mocked(getSpeechService).mockImplementation(() => {
      throw new Error('not initialized');
    });

    const audioPath = path.join(tmpDir, 'test.wav');
    fs.writeFileSync(audioPath, Buffer.alloc(100));

    const { transcribeAudioHandler } = await import(
      '../../src/tools/handlers/transcribe-audio.js'
    );

    const result = await transcribeAudioHandler(
      { filePath: audioPath },
      mockContext
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Speech service is not initialized');
  });

  it('returns error when STT model is not available', async () => {
    const { getSpeechService } = await import('../../src/speech/index.js');
    vi.mocked(getSpeechService).mockReturnValue({
      stt: {
        isAvailable: () => false,
        ensureLoaded: vi.fn(),
        transcribe: vi.fn(),
        dispose: vi.fn(),
      },
      tts: {} as any,
      voices: {} as any,
      getStatus: vi.fn(),
      shutdown: vi.fn(),
    } as any);

    const audioPath = path.join(tmpDir, 'test.wav');
    fs.writeFileSync(audioPath, Buffer.alloc(100));

    const { transcribeAudioHandler } = await import(
      '../../src/tools/handlers/transcribe-audio.js'
    );

    const result = await transcribeAudioHandler(
      { filePath: audioPath },
      mockContext
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('STT model files not found');
  });

  it('transcribes WAV file successfully', async () => {
    const { getSpeechService } = await import('../../src/speech/index.js');
    const mockTranscribe = vi.fn().mockResolvedValue('Hello world');
    vi.mocked(getSpeechService).mockReturnValue({
      stt: {
        isAvailable: () => true,
        transcribe: mockTranscribe,
      },
      tts: {} as any,
      voices: {} as any,
      getStatus: vi.fn(),
      shutdown: vi.fn(),
    } as any);

    const { readWavSamples } = await import('../../src/speech/audio-utils.js');
    vi.mocked(readWavSamples).mockReturnValue({
      samples: new Float32Array([0.1, 0.2]),
      sampleRate: 16000,
    });

    const audioPath = path.join(tmpDir, 'test.wav');
    fs.writeFileSync(audioPath, Buffer.alloc(100));

    const { transcribeAudioHandler } = await import(
      '../../src/tools/handlers/transcribe-audio.js'
    );

    const result = await transcribeAudioHandler(
      { filePath: audioPath },
      mockContext
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toBe('Hello world');
    expect(mockTranscribe).toHaveBeenCalledWith(
      expect.any(Float32Array),
      16000
    );
  });

  it('converts non-WAV files via webmToPcm', async () => {
    const { getSpeechService } = await import('../../src/speech/index.js');
    const mockTranscribe = vi.fn().mockResolvedValue('Converted audio');
    vi.mocked(getSpeechService).mockReturnValue({
      stt: {
        isAvailable: () => true,
        transcribe: mockTranscribe,
      },
      tts: {} as any,
      voices: {} as any,
      getStatus: vi.fn(),
      shutdown: vi.fn(),
    } as any);

    const { webmToPcm } = await import('../../src/speech/audio-utils.js');
    vi.mocked(webmToPcm).mockResolvedValue({
      samples: new Float32Array([0.3, 0.4]),
      sampleRate: 16000,
    });

    const audioPath = path.join(tmpDir, 'test.webm');
    fs.writeFileSync(audioPath, Buffer.alloc(100));

    const { transcribeAudioHandler } = await import(
      '../../src/tools/handlers/transcribe-audio.js'
    );

    const result = await transcribeAudioHandler(
      { filePath: audioPath },
      mockContext
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toBe('Converted audio');
    expect(webmToPcm).toHaveBeenCalled();
  });

  it('handles empty transcription gracefully', async () => {
    const { getSpeechService } = await import('../../src/speech/index.js');
    vi.mocked(getSpeechService).mockReturnValue({
      stt: {
        isAvailable: () => true,
        transcribe: vi.fn().mockResolvedValue(''),
      },
      tts: {} as any,
      voices: {} as any,
      getStatus: vi.fn(),
      shutdown: vi.fn(),
    } as any);

    const { readWavSamples } = await import('../../src/speech/audio-utils.js');
    vi.mocked(readWavSamples).mockReturnValue({
      samples: new Float32Array([0]),
      sampleRate: 16000,
    });

    const audioPath = path.join(tmpDir, 'silence.wav');
    fs.writeFileSync(audioPath, Buffer.alloc(100));

    const { transcribeAudioHandler } = await import(
      '../../src/tools/handlers/transcribe-audio.js'
    );

    const result = await transcribeAudioHandler(
      { filePath: audioPath },
      mockContext
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('no text');
  });
});
