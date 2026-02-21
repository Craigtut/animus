/**
 * Tests for the send_voice_reply tool handler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolHandlerContext } from '../../src/tools/types.js';

// Mock the speech service module
vi.mock('../../src/speech/index.js', () => ({
  getSpeechService: vi.fn(),
}));

const mockSendOutbound = vi.fn();

function buildContext(overrides?: Partial<ToolHandlerContext>): ToolHandlerContext {
  return {
    agentTaskId: 'test-task',
    contactId: 'test-contact-id',
    sourceChannel: 'discord',
    conversationId: 'test-conv',
    stores: {
      messages: { createMessage: vi.fn().mockReturnValue({ id: 'msg-1' }) },
      heartbeat: {},
      memory: { retrieveRelevant: vi.fn().mockResolvedValue([]) },
      channels: {
        sendOutbound: mockSendOutbound,
      },
    },
    eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as any,
    ...overrides,
  };
}

describe('send_voice_reply handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendOutbound.mockResolvedValue({ id: 'msg-123' });
  });

  afterEach(() => {
    // Clean up any generated files
    const speechDir = path.resolve('data', 'media', 'speech');
    if (fs.existsSync(speechDir)) {
      fs.rmSync(speechDir, { recursive: true, force: true });
    }
  });

  it('returns error when channels store is not available (sub-agent)', async () => {
    const context = buildContext();
    delete context.stores.channels;

    const { sendVoiceReplyHandler } = await import(
      '../../src/tools/handlers/send-voice-reply.js'
    );

    const result = await sendVoiceReplyHandler(
      { text: 'Hello' },
      context
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('only available to the mind session');
  });

  it('returns error when no contactId', async () => {
    const context = buildContext({ contactId: '' });

    const { sendVoiceReplyHandler } = await import(
      '../../src/tools/handlers/send-voice-reply.js'
    );

    const result = await sendVoiceReplyHandler(
      { text: 'Hello' },
      context
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('No active contact');
  });

  it('returns error when speech service is not initialized', async () => {
    const { getSpeechService } = await import('../../src/speech/index.js');
    vi.mocked(getSpeechService).mockImplementation(() => {
      throw new Error('not initialized');
    });

    const { sendVoiceReplyHandler } = await import(
      '../../src/tools/handlers/send-voice-reply.js'
    );

    const result = await sendVoiceReplyHandler(
      { text: 'Hello' },
      buildContext()
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Speech service is not initialized');
  });

  it('returns error when TTS is unavailable', async () => {
    const { getSpeechService } = await import('../../src/speech/index.js');
    vi.mocked(getSpeechService).mockReturnValue({
      stt: {} as any,
      tts: {
        isAvailable: () => false,
        synthesize: vi.fn(),
      },
      voices: {} as any,
      getStatus: vi.fn(),
      shutdown: vi.fn(),
    } as any);

    const { sendVoiceReplyHandler } = await import(
      '../../src/tools/handlers/send-voice-reply.js'
    );

    const result = await sendVoiceReplyHandler(
      { text: 'Hello' },
      buildContext()
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('TTS model files not found');
  });

  it('synthesizes, saves, and sends voice reply', async () => {
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

    const { sendVoiceReplyHandler } = await import(
      '../../src/tools/handlers/send-voice-reply.js'
    );

    const context = buildContext();
    const result = await sendVoiceReplyHandler(
      { text: 'Hello friend' },
      context
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Voice reply sent');
    expect(result.content[0]!.text).toContain('1.0s');
    expect(result.content[0]!.text).toContain('msg-123');

    // Verify TTS was called
    expect(mockSynthesize).toHaveBeenCalledWith('Hello friend', {
      speed: undefined,
      voiceId: undefined,
    });

    // Verify sendOutbound was called with text as content + audio as media
    expect(mockSendOutbound).toHaveBeenCalledTimes(1);
    const outboundArgs = mockSendOutbound.mock.calls[0]![0];
    expect(outboundArgs.contactId).toBe('test-contact-id');
    expect(outboundArgs.channel).toBe('discord');
    expect(outboundArgs.content).toBe('Hello friend'); // Text stored in messages.db
    expect(outboundArgs.media).toHaveLength(1);
    expect(outboundArgs.media[0].type).toBe('audio');
    expect(outboundArgs.media[0].filename).toBe('voice-reply.wav');
  });

  it('passes speed and voiceId options to TTS', async () => {
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

    const { sendVoiceReplyHandler } = await import(
      '../../src/tools/handlers/send-voice-reply.js'
    );

    await sendVoiceReplyHandler(
      { text: 'Fast voice', speed: 1.5, voiceId: 'alba' },
      buildContext()
    );

    expect(mockSynthesize).toHaveBeenCalledWith('Fast voice', {
      speed: 1.5,
      voiceId: 'alba',
    });
  });

  it('returns error when delivery fails', async () => {
    mockSendOutbound.mockResolvedValue(null);

    const mockSynthesize = vi.fn().mockResolvedValue({
      samples: new Float32Array(24000),
      sampleRate: 24000,
      wavBuffer: Buffer.alloc(1000),
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

    const { sendVoiceReplyHandler } = await import(
      '../../src/tools/handlers/send-voice-reply.js'
    );

    const result = await sendVoiceReplyHandler(
      { text: 'Hello' },
      buildContext()
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('delivery failed');
  });

  it('handles TTS synthesis failure', async () => {
    const { getSpeechService } = await import('../../src/speech/index.js');
    vi.mocked(getSpeechService).mockReturnValue({
      stt: {} as any,
      tts: {
        isAvailable: () => true,
        synthesize: vi.fn().mockRejectedValue(new Error('TTS crashed')),
      },
      voices: {} as any,
      getStatus: vi.fn(),
      shutdown: vi.fn(),
    } as any);

    const { sendVoiceReplyHandler } = await import(
      '../../src/tools/handlers/send-voice-reply.js'
    );

    const result = await sendVoiceReplyHandler(
      { text: 'This will fail' },
      buildContext()
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Voice reply failed');
    expect(result.content[0]!.text).toContain('TTS crashed');
  });
});
