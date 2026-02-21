/**
 * generate_speech handler — synthesize text to speech audio.
 *
 * Mind-only tool. Uses the shared TTS engine (Pocket TTS) via
 * the SpeechService singleton. Saves output WAV to data/media/speech/.
 * Pairs with send_media to deliver the audio to the user.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { ToolHandler, ToolResult } from '../types.js';
import { generateSpeechDef } from '@animus/shared';

type GenerateSpeechInput = z.infer<typeof generateSpeechDef.inputSchema>;

export const generateSpeechHandler: ToolHandler<GenerateSpeechInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  // Lazy import speech service to avoid circular deps and allow graceful failure
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

    // Save WAV to data/media/speech/
    const dataDir = path.dirname(path.dirname(process.cwd()));
    const speechDir = path.resolve('data', 'media', 'speech');
    fs.mkdirSync(speechDir, { recursive: true });

    const filename = `${randomUUID()}.wav`;
    const outputPath = path.join(speechDir, filename);
    fs.writeFileSync(outputPath, result.wavBuffer);

    const durationSec = (result.samples.length / result.sampleRate).toFixed(1);

    return {
      content: [{
        type: 'text',
        text: `Generated speech audio (${durationSec}s, ${result.sampleRate}Hz) saved to: ${outputPath}`,
      }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Speech synthesis failed: ${String(error)}` }],
      isError: true,
    };
  }
};
