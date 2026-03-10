/**
 * send_voice_reply handler — reply with a voice message.
 *
 * Mind-only tool. Combines TTS synthesis + channel delivery + text storage
 * in one call. The text is stored as message content in messages.db so
 * future ticks see "what was said" in conversation history.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR } from '../../utils/env.js';
import type { z } from 'zod/v3';
import type { ToolHandler, ToolResult } from '../types.js';
import { sendVoiceReplyDef } from '@animus-labs/shared';
import type { ChannelType } from '@animus-labs/shared';

type SendVoiceReplyInput = z.infer<typeof sendVoiceReplyDef.inputSchema>;

export const sendVoiceReplyHandler: ToolHandler<SendVoiceReplyInput> = async (
  input,
  context
): Promise<ToolResult> => {
  // Guard: mind-only tool (needs channel router)
  if (!context.stores.channels) {
    return {
      content: [{ type: 'text', text: 'send_voice_reply is only available to the mind session.' }],
      isError: true,
    };
  }

  if (!context.contactId) {
    return {
      content: [{ type: 'text', text: 'No active contact — cannot send voice reply.' }],
      isError: true,
    };
  }

  // 1. Synthesize speech via TTS engine
  const { getSpeechService } = await import('../../speech/index.js');

  let speechService;
  try {
    speechService = getSpeechService();
  } catch {
    return {
      content: [{ type: 'text', text: 'Speech service is not initialized. TTS is unavailable.' }],
      isError: true,
    };
  }

  if (!speechService.tts.isAvailable()) {
    return {
      content: [{ type: 'text', text: 'TTS model files not found. Download Pocket TTS to data/models/tts/' }],
      isError: true,
    };
  }

  try {
    const result = await speechService.tts.synthesize(input.text, {
      speed: input.speed,
      voiceId: input.voiceId,
    });

    // 2. Save WAV to data/media/speech/
    const speechDir = path.join(DATA_DIR, 'media', 'speech');
    fs.mkdirSync(speechDir, { recursive: true });

    const filename = `${randomUUID()}.wav`;
    const outputPath = path.join(speechDir, filename);
    fs.writeFileSync(outputPath, result.wavBuffer);

    // 3. Send through channel router — text stored in messages.db, only audio delivered to channel
    const msg = await context.stores.channels.sendOutbound({
      contactId: context.contactId,
      channel: context.sourceChannel as ChannelType,
      content: input.text,      // Stored in messages.db for future context
      channelContent: '',       // Don't deliver text to channel — audio only
      media: [{ type: 'audio', path: outputPath, filename: 'voice-reply.wav' }],
    });

    // 4. Return result
    const durationSec = (result.samples.length / result.sampleRate).toFixed(1);

    if (!msg) {
      return {
        content: [{
          type: 'text',
          text: `Voice reply synthesized (${durationSec}s) but delivery failed. Audio saved to: ${outputPath}`,
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: 'text',
        text: `Voice reply sent (${durationSec}s). Message ID: ${msg.id}`,
      }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Voice reply failed: ${String(error)}` }],
      isError: true,
    };
  }
};
