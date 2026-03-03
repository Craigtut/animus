/**
 * Channel Router
 *
 * Central message routing: receives inbound messages from any channel,
 * resolves identity, checks permissions, stores messages, and queues ticks.
 * Outbound delivery is delegated to ChannelManager.
 *
 * See docs/architecture/channel-packages.md — "Outbound Routing"
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMessagesDb, getContactsDb } from '../db/index.js';
import * as messageStore from '../db/stores/message-store.js';
import * as contactStore from '../db/stores/contact-store.js';
import { resolveContact } from '../contacts/identity-resolver.js';
import { canPerformByTier } from '../contacts/permission-enforcer.js';
import { handleIncomingMessage } from '../heartbeat/index.js';
import { getEventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import { getChannelManager } from './channel-manager.js';
import type { ChannelType, Contact, Message, PermissionTier } from '@animus-labs/shared';

type IncomingMedia = {
  type: 'image' | 'audio' | 'video' | 'file';
  mimeType: string;
  url: string;
  filename?: string;
};

const log = createLogger('ChannelRouter', 'channels');

// ============================================================================
// Channel Router
// ============================================================================

export class ChannelRouter {
  /**
   * Handle an incoming message from any channel.
   *
   * 1. Resolve contact via identity resolver
   * 2. Check permissions
   * 3. Store message in messages.db
   * 4. Queue a message tick trigger
   * 5. Return the stored message (or null for unknown callers)
   */
  async handleIncoming(params: {
    channel: ChannelType;
    identifier: string;
    content: string;
    conversationId?: string;
    conversationType?: 'owned' | 'participated';
    media?: IncomingMedia[];
    metadata?: Record<string, unknown>;
    participant?: { displayName: string; avatarUrl?: string; isBot: boolean };
  }): Promise<Message | null> {
    const { channel, identifier, content, conversationId, conversationType, media, metadata, participant } = params;

    // Step 1: Resolve contact
    const resolved = resolveContact(channel, identifier);
    if (!resolved) {
      // If we have participant info (and they're not a bot), treat as recognized participant
      if (participant && !participant.isBot) {
        return this.handleRecognizedParticipant(channel, identifier, content, conversationId, conversationType, media, metadata, participant);
      }
      // Unknown caller — send canned response, notify primary
      this.handleUnknownCaller(channel, identifier, content);
      return null;
    }

    const { contact } = resolved;
    const tier: PermissionTier = contact.isPrimary
      ? 'primary'
      : contact.permissionTier;

    // Step 2: Check permissions
    if (!canPerformByTier(tier, 'trigger_tick')) {
      log.warn(
        `Contact ${contact.id} (${tier}) cannot trigger ticks`
      );
      return null;
    }

    // Step 2b: Auto-transcribe audio attachments (voice messages)
    let messageContent = content;
    let wasVoiceMessage = false;
    if (media && media.length > 0) {
      const audioAttachments = media.filter(m => m.type === 'audio');
      if (audioAttachments.length > 0 && (!content || content.trim() === '')) {
        // Voice message: audio with no text content
        try {
          const transcribed = await this.transcribeAudio(audioAttachments[0]!.url);
          if (transcribed) {
            messageContent = transcribed;
            wasVoiceMessage = true;
            log.info(`Auto-transcribed voice message: "${transcribed.substring(0, 80)}..."`);
          }
        } catch (err) {
          log.error('Failed to auto-transcribe voice message:', err);
          // Fall through — store original content (empty string)
        }
      }
    }

    // Combine metadata with external conversationId, conversationType, media, and voice message flag
    const combinedMetadata = {
      ...metadata,
      ...(conversationId ? { externalConversationId: conversationId } : {}),
      ...(conversationType ? { conversationType } : {}),
      ...(media && media.length > 0 ? { media } : {}),
      ...(wasVoiceMessage ? { wasVoiceMessage: true, originalMediaType: 'audio' } : {}),
    };

    // Step 3: Store message
    const msgDb = getMessagesDb();
    let conv = messageStore.getActiveConversation(msgDb, contact.id, channel);
    if (!conv) {
      conv = messageStore.createConversation(msgDb, {
        contactId: contact.id,
        channel,
      });
    }

    const msg = messageStore.createMessage(msgDb, {
      conversationId: conv.id,
      contactId: contact.id,
      direction: 'inbound',
      channel,
      content: messageContent,
      metadata: combinedMetadata,
    });

    // Step 4: Emit event and trigger tick
    getEventBus().emit('message:received', msg);

    const hasMetadata = Object.keys(combinedMetadata).length > 0;
    handleIncomingMessage({
      contactId: contact.id,
      contactName: contact.fullName,
      channel,
      content: messageContent,
      messageId: msg.id,
      conversationId: conv.id,
      ...(hasMetadata ? { metadata: combinedMetadata } : {}),
    });

    return msg;
  }

  /**
   * Send an outbound message — stores in messages.db and delivers via ChannelManager.
   */
  async sendOutbound(params: {
    contactId: string;
    channel: ChannelType;
    content: string;
    metadata?: Record<string, unknown>;
    media?: Array<{ type: 'image' | 'audio' | 'video' | 'file'; path: string; filename?: string }>;
    /** Override content sent to the channel adapter. DB always stores `content`. */
    channelContent?: string;
  }): Promise<Message | null> {
    const { contactId, channel, content, metadata, media } = params;

    // Store outbound message first (even if delivery fails, the message is persisted)
    const msgDb = getMessagesDb();
    let conv = messageStore.getActiveConversation(msgDb, contactId, channel);
    if (!conv) {
      conv = messageStore.createConversation(msgDb, {
        contactId,
        channel,
      });
    }

    const msg = messageStore.createMessage(msgDb, {
      conversationId: conv.id,
      contactId,
      direction: 'outbound',
      channel,
      content,
      deliveryStatus: 'pending',
      ...(metadata ? { metadata } : {}),
    });

    // Persist media attachments and build the delivery array
    let deliveryMedia: Array<{ type: string; path: string; mimeType: string; filename?: string }> | undefined;
    if (media && media.length > 0) {
      deliveryMedia = [];
      for (const m of media) {
        try {
          const stat = fs.statSync(m.path);
          const ext = path.extname(m.path).toLowerCase().replace('.', '');
          const mimeType = extToMime(ext);
          const filename = m.filename ?? path.basename(m.path);

          messageStore.createMediaAttachment(msgDb, {
            messageId: msg.id,
            type: m.type,
            mimeType,
            localPath: m.path,
            originalFilename: filename,
            sizeBytes: stat.size,
          });

          deliveryMedia.push({ type: m.type, path: m.path, mimeType, filename });
        } catch (err) {
          log.error(`Failed to process media attachment ${m.path}:`, err);
          // Skip this attachment, continue with others
        }
      }
      if (deliveryMedia.length === 0) deliveryMedia = undefined;
    }

    getEventBus().emit('message:sent', msg);

    // Deliver via ChannelManager (handles both built-in and package channels)
    const channelManager = getChannelManager();
    try {
      const result = await channelManager.sendToChannel(channel, contactId, params.channelContent ?? content, metadata, deliveryMedia);
      if (result.ok) {
        messageStore.updateDeliveryStatus(msgDb, msg.id, 'sent', result.externalId ? { externalId: result.externalId } : undefined);
        msg.deliveryStatus = 'sent';
        msg.externalId = result.externalId ?? null;
      } else {
        log.warn(`Message stored but delivery failed for channel ${channel}: ${result.error}`);
        messageStore.updateDeliveryStatus(msgDb, msg.id, 'failed', result.error ? { error: result.error } : undefined);
        msg.deliveryStatus = 'failed';
        msg.deliveryError = result.error ?? null;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to deliver via ${channel}:`, err);
      messageStore.updateDeliveryStatus(msgDb, msg.id, 'failed', { error: errorMsg });
      msg.deliveryStatus = 'failed';
      msg.deliveryError = errorMsg;
    }

    return msg;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  /**
   * Transcribe an audio file using the shared STT engine.
   * Returns null if STT is unavailable or transcription fails.
   */
  private async transcribeAudio(filePath: string): Promise<string | null> {
    const { getSpeechService } = await import('../speech/index.js');

    let speechService;
    try {
      speechService = getSpeechService();
    } catch {
      log.warn('Speech service not initialized — skipping auto-transcription');
      return null;
    }

    if (!speechService.stt.isAvailable()) {
      log.debug('STT model not available — skipping auto-transcription');
      return null;
    }

    const ext = path.extname(filePath).toLowerCase();
    let samples: Float32Array;
    let sampleRate: number;

    if (ext === '.wav') {
      const { readWavSamples } = await import('../speech/audio-utils.js');
      const wav = readWavSamples(filePath);
      samples = wav.samples;
      sampleRate = wav.sampleRate;
    } else {
      // OGG, WebM, MP3, etc. — convert via ffmpeg
      const { webmToPcm } = await import('../speech/audio-utils.js');
      const audioBuffer = fs.readFileSync(filePath);
      const pcm = await webmToPcm(audioBuffer);
      samples = pcm.samples;
      sampleRate = pcm.sampleRate;
    }

    const text = await speechService.stt.transcribe(samples, sampleRate);
    return text || null;
  }

  /**
   * Handle a message from a recognized participant (someone we have display info for
   * but who isn't in the contacts database). This happens in shared channels (e.g.,
   * Slack channels, Discord servers) where non-contacts can message.
   *
   * We store the message and trigger a tick, but do NOT create a contact record.
   */
  private async handleRecognizedParticipant(
    channel: ChannelType,
    identifier: string,
    content: string,
    conversationId?: string,
    conversationType?: 'owned' | 'participated',
    media?: IncomingMedia[],
    metadata?: Record<string, unknown>,
    participant?: { displayName: string; avatarUrl?: string; isBot: boolean },
  ): Promise<Message | null> {
    const participantName = participant?.displayName ?? identifier;
    log.info(`Recognized participant on ${channel}: ${participantName} (${identifier})`);

    // Combine metadata
    const combinedMetadata = {
      ...metadata,
      ...(conversationId ? { externalConversationId: conversationId } : {}),
      ...(conversationType ? { conversationType } : {}),
      ...(media && media.length > 0 ? { media } : {}),
      participantName,
      isRecognizedParticipant: true,
    };

    // Store message using a synthetic participant-based conversation
    const msgDb = getMessagesDb();
    // Use a synthetic contactId for recognized participants: rp:{channel}:{identifier}
    const syntheticContactId = `rp:${channel}:${identifier}`;
    let conv = messageStore.getActiveConversation(msgDb, syntheticContactId, channel);
    if (!conv) {
      conv = messageStore.createConversation(msgDb, {
        contactId: syntheticContactId,
        channel,
      });
    }

    const msg = messageStore.createMessage(msgDb, {
      conversationId: conv.id,
      contactId: syntheticContactId,
      direction: 'inbound',
      channel,
      content,
      metadata: combinedMetadata,
    });

    getEventBus().emit('message:received', msg);

    // Trigger tick with recognized participant metadata
    handleIncomingMessage({
      contactId: syntheticContactId,
      contactName: participantName,
      channel,
      content,
      messageId: msg.id,
      conversationId: conv.id,
      metadata: {
        ...combinedMetadata,
        participantName,
        isRecognizedParticipant: true,
      },
    });

    return msg;
  }

  private handleUnknownCaller(
    channel: ChannelType,
    identifier: string,
    content: string
  ): void {
    log.info(
      `Unknown caller on ${channel}: ${identifier}`
    );

    // Notify primary contact
    const cDb = getContactsDb();
    const primary = contactStore.getPrimaryContact(cDb);
    if (primary) {
      const preview =
        content.length > 100 ? content.substring(0, 100) + '...' : content;
      log.info(
        `Would notify primary: Unknown message from ${identifier} on ${channel}: "${preview}"`
      );
      // TODO: Send notification to primary contact when notification system is built
    }
  }
}

// ============================================================================
// Utilities
// ============================================================================

const MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  pdf: 'application/pdf', zip: 'application/zip',
  txt: 'text/plain', json: 'application/json',
};

function extToMime(ext: string): string {
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

// ============================================================================
// Singleton
// ============================================================================

let router: ChannelRouter | null = null;

export function getChannelRouter(): ChannelRouter {
  if (!router) {
    router = new ChannelRouter();
  }
  return router;
}
