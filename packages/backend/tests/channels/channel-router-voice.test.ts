/**
 * Tests for inbound voice message auto-transcription in the channel router.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSystemDb, createTestMessagesDb, createTestContactsDb } from '../helpers.js';
import * as contactStore from '../../src/db/stores/contact-store.js';

// Mock DB access
let mockSysDb: Database.Database;
let mockMsgDb: Database.Database;
let mockContactsDb: Database.Database;

vi.mock('../../src/db/index.js', () => ({
  getSystemDb: () => mockSysDb,
  getMessagesDb: () => mockMsgDb,
  getContactsDb: () => mockContactsDb,
  getHeartbeatDb: vi.fn(),
}));

// Mock heartbeat
const mockHandleIncomingMessage = vi.fn();
vi.mock('../../src/heartbeat/index.js', () => ({
  handleIncomingMessage: (...args: unknown[]) => mockHandleIncomingMessage(...args),
}));

// Mock event bus
vi.mock('../../src/lib/event-bus.js', () => ({
  getEventBus: () => ({
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

// Mock channel manager
vi.mock('../../src/channels/channel-manager.js', () => ({
  getChannelManager: () => ({
    sendToChannel: vi.fn(async () => true),
  }),
}));

// Mock speech service
const mockTranscribe = vi.fn();
const mockSttIsAvailable = vi.fn(() => true);

vi.mock('../../src/speech/index.js', () => ({
  getSpeechService: vi.fn(() => ({
    stt: {
      isAvailable: () => mockSttIsAvailable(),
      transcribe: (...args: unknown[]) => mockTranscribe(...args),
    },
    tts: {} as any,
    voices: {} as any,
  })),
}));

// Mock audio utils
vi.mock('../../src/speech/audio-utils.js', () => ({
  readWavSamples: vi.fn(() => ({
    samples: new Float32Array(16000),
    sampleRate: 16000,
  })),
  webmToPcm: vi.fn(async () => ({
    samples: new Float32Array(16000),
    sampleRate: 16000,
  })),
}));

const { ChannelRouter } = await import('../../src/channels/channel-router.js');

describe('channel-router voice auto-transcription', () => {
  let router: InstanceType<typeof ChannelRouter>;

  beforeEach(() => {
    mockSysDb = createTestSystemDb();
    mockMsgDb = createTestMessagesDb();
    mockContactsDb = createTestContactsDb();
    router = new ChannelRouter();
    mockTranscribe.mockReset();
    mockSttIsAvailable.mockReturnValue(true);
    mockHandleIncomingMessage.mockReset();
  });

  function createTestContact() {
    const contact = contactStore.createContact(mockContactsDb, {
      fullName: 'Test User',
      isPrimary: true,
    });
    contactStore.createContactChannel(mockContactsDb, {
      contactId: contact.id,
      channel: 'discord',
      identifier: 'user123',
    });
    return contact;
  }

  it('auto-transcribes audio attachment when content is empty', async () => {
    createTestContact();
    mockTranscribe.mockResolvedValue('Hello, this is a voice message');

    const result = await router.handleIncoming({
      channel: 'discord',
      identifier: 'user123',
      content: '',
      media: [{ type: 'audio', mimeType: 'audio/ogg', url: '/tmp/voice.wav' }],
    });

    expect(result).not.toBeNull();
    expect(result!.content).toBe('Hello, this is a voice message');
    // Verify metadata includes voice message flag
    const metadata = result!.metadata as Record<string, unknown>;
    expect(metadata.wasVoiceMessage).toBe(true);
    expect(metadata.originalMediaType).toBe('audio');
  });

  it('does NOT transcribe when content has text (caption + audio)', async () => {
    createTestContact();
    mockTranscribe.mockResolvedValue('Should not be called');

    const result = await router.handleIncoming({
      channel: 'discord',
      identifier: 'user123',
      content: 'Check out this audio clip',
      media: [{ type: 'audio', mimeType: 'audio/mp3', url: '/tmp/clip.mp3' }],
    });

    expect(result).not.toBeNull();
    expect(result!.content).toBe('Check out this audio clip');
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it('does NOT transcribe non-audio attachments', async () => {
    createTestContact();

    const result = await router.handleIncoming({
      channel: 'discord',
      identifier: 'user123',
      content: '',
      media: [{ type: 'image', mimeType: 'image/png', url: '/tmp/photo.png' }],
    });

    expect(result).not.toBeNull();
    expect(result!.content).toBe('');
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it('gracefully falls back when STT is unavailable', async () => {
    createTestContact();
    mockSttIsAvailable.mockReturnValue(false);

    const result = await router.handleIncoming({
      channel: 'discord',
      identifier: 'user123',
      content: '',
      media: [{ type: 'audio', mimeType: 'audio/ogg', url: '/tmp/voice.wav' }],
    });

    expect(result).not.toBeNull();
    expect(result!.content).toBe('');
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it('gracefully falls back when transcription fails', async () => {
    createTestContact();
    mockTranscribe.mockRejectedValue(new Error('Model error'));

    const result = await router.handleIncoming({
      channel: 'discord',
      identifier: 'user123',
      content: '',
      media: [{ type: 'audio', mimeType: 'audio/ogg', url: '/tmp/voice.wav' }],
    });

    expect(result).not.toBeNull();
    // Falls back to empty content
    expect(result!.content).toBe('');
  });

  it('passes transcribed content to handleIncomingMessage', async () => {
    const contact = createTestContact();
    mockTranscribe.mockResolvedValue('transcribed text');

    await router.handleIncoming({
      channel: 'discord',
      identifier: 'user123',
      content: '',
      media: [{ type: 'audio', mimeType: 'audio/ogg', url: '/tmp/voice.wav' }],
    });

    expect(mockHandleIncomingMessage).toHaveBeenCalledTimes(1);
    const callArgs = mockHandleIncomingMessage.mock.calls[0]![0];
    expect(callArgs.content).toBe('transcribed text');
    expect(callArgs.contactId).toBe(contact.id);
  });
});
