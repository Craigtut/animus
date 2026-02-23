/**
 * transcribe_audio handler — transcribe an audio file to text.
 *
 * Mind-only tool. Uses the shared STT engine (Parakeet TDT v3) via
 * the SpeechService singleton. Supports WAV directly; other formats
 * require ffmpeg for conversion.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import type { ToolHandler, ToolResult } from '../types.js';
import { transcribeAudioDef } from '@animus-labs/shared';

type TranscribeAudioInput = z.infer<typeof transcribeAudioDef.inputSchema>;

export const transcribeAudioHandler: ToolHandler<TranscribeAudioInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  // Validate file exists
  if (!fs.existsSync(input.filePath)) {
    return {
      content: [{ type: 'text', text: `Audio file not found: ${input.filePath}` }],
      isError: true,
    };
  }

  // Lazy import speech service to avoid circular deps and allow graceful failure
  const { getSpeechService } = await import('../../speech/index.js');

  let speechService;
  try {
    speechService = getSpeechService();
  } catch {
    return {
      content: [{ type: 'text', text: 'Speech service is not initialized. STT is unavailable.' }],
      isError: true,
    };
  }

  if (!speechService.stt.isAvailable()) {
    return {
      content: [{ type: 'text', text: 'STT model files not found. Download Parakeet TDT v3 to data/models/stt/' }],
      isError: true,
    };
  }

  try {
    const ext = path.extname(input.filePath).toLowerCase();
    let samples: Float32Array;
    let sampleRate: number;

    if (ext === '.wav') {
      // Read WAV directly
      const { readWavSamples } = await import('../../speech/audio-utils.js');
      const wav = readWavSamples(input.filePath);
      samples = wav.samples;
      sampleRate = wav.sampleRate;
    } else {
      // Convert via ffmpeg
      const { webmToPcm } = await import('../../speech/audio-utils.js');
      const audioBuffer = fs.readFileSync(input.filePath);
      const pcm = await webmToPcm(audioBuffer);
      samples = pcm.samples;
      sampleRate = pcm.sampleRate;
    }

    const text = await speechService.stt.transcribe(samples, sampleRate);

    if (!text) {
      return {
        content: [{ type: 'text', text: 'Transcription produced no text. The audio may be silent or too short.' }],
      };
    }

    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Transcription failed: ${String(error)}` }],
      isError: true,
    };
  }
};
