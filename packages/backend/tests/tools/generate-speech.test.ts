/**
 * Tests for the generate_speech tool handler.
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

describe('generate_speech handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any generated files
    const speechDir = path.resolve('data', 'media', 'speech');
    if (fs.existsSync(speechDir)) {
      fs.rmSync(speechDir, { recursive: true, force: true });
    }
  });

  it('returns error when speech service is not initialized', async () => {
    const { getSpeechService } = await import('../../src/speech/index.js');
    vi.mocked(getSpeechService).mockImplementation(() => {
      throw new Error('not initialized');
    });

    const { generateSpeechHandler } = await import(
      '../../src/tools/handlers/generate-speech.js'
    );

    const result = await generateSpeechHandler(
      { text: 'Hello world' },
      mockContext
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Speech service is not initialized');
  });

  it('returns error when TTS model is not available', async () => {
    const { getSpeechService } = await import('../../src/speech/index.js');
    vi.mocked(getSpeechService).mockReturnValue({
      stt: {} as any,
      tts: {
        isAvailable: () => false,
        ensureLoaded: vi.fn(),
        synthesize: vi.fn(),
        dispose: vi.fn(),
      },
      voices: {} as any,
      getStatus: vi.fn(),
      shutdown: vi.fn(),
    } as any);

    const { generateSpeechHandler } = await import(
      '../../src/tools/handlers/generate-speech.js'
    );

    const result = await generateSpeechHandler(
      { text: 'Hello world' },
      mockContext
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('TTS model files not found');
  });

  it('synthesizes text and saves WAV file', async () => {
    const mockWavBuffer = Buffer.alloc(1000);
    const mockSamples = new Float32Array(24000); // 1 second at 24kHz
    const mockSynthesize = vi.fn().mockResolvedValue({
      samples: mockSamples,
      sampleRate: 24000,
      wavBuffer: mockWavBuffer,
    });

    const { getSpeechService } = await import('../../src/speech/index.js');
    vi.mocked(getSpeechService).mockReturnValue({
      stt: {} as any,
      tts: {
        isAvailable: () => true,
        synthesize: mockSynthesize,
      },
      voices: {} as any,
      getStatus: vi.fn(),
      shutdown: vi.fn(),
    } as any);

    const { generateSpeechHandler } = await import(
      '../../src/tools/handlers/generate-speech.js'
    );

    const result = await generateSpeechHandler(
      { text: 'Hello world' },
      mockContext
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Generated speech audio');
    expect(result.content[0]!.text).toContain('1.0s');
    expect(result.content[0]!.text).toContain('.wav');
    expect(mockSynthesize).toHaveBeenCalledWith('Hello world', {
      speed: undefined,
      voiceId: undefined,
    });
  });

  it('passes speed and voiceId options', async () => {
    const mockSynthesize = vi.fn().mockResolvedValue({
      samples: new Float32Array(12000),
      sampleRate: 24000,
      wavBuffer: Buffer.alloc(500),
    });

    const { getSpeechService } = await import('../../src/speech/index.js');
    vi.mocked(getSpeechService).mockReturnValue({
      stt: {} as any,
      tts: {
        isAvailable: () => true,
        synthesize: mockSynthesize,
      },
      voices: {} as any,
      getStatus: vi.fn(),
      shutdown: vi.fn(),
    } as any);

    const { generateSpeechHandler } = await import(
      '../../src/tools/handlers/generate-speech.js'
    );

    const result = await generateSpeechHandler(
      { text: 'Fast speech', speed: 1.5, voiceId: 'alba' },
      mockContext
    );

    expect(result.isError).toBeUndefined();
    expect(mockSynthesize).toHaveBeenCalledWith('Fast speech', {
      speed: 1.5,
      voiceId: 'alba',
    });
  });

  it('handles synthesis failure gracefully', async () => {
    const { getSpeechService } = await import('../../src/speech/index.js');
    vi.mocked(getSpeechService).mockReturnValue({
      stt: {} as any,
      tts: {
        isAvailable: () => true,
        synthesize: vi.fn().mockRejectedValue(new Error('Model crashed')),
      },
      voices: {} as any,
      getStatus: vi.fn(),
      shutdown: vi.fn(),
    } as any);

    const { generateSpeechHandler } = await import(
      '../../src/tools/handlers/generate-speech.js'
    );

    const result = await generateSpeechHandler(
      { text: 'This will fail' },
      mockContext
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Speech synthesis failed');
    expect(result.content[0]!.text).toContain('Model crashed');
  });
});
