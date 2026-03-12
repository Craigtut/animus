/**
 * Speech Router — tRPC procedures for voice management and speech status.
 *
 * Exposes the VoiceManager and SpeechService status to the frontend
 * for the persona Voice tab.
 */

import { z } from 'zod/v3';
import { router, protectedProcedure } from '../trpc.js';
import { getSpeechService } from '../../speech/index.js';
import { getPersonaDb } from '../../db/index.js';
import * as personaStore from '../../db/stores/persona-store.js';

export const speechRouter = router({
  /** List all available voices (built-in + custom). */
  listVoices: protectedProcedure.query(() => {
    return getSpeechService().voices.listVoices();
  }),

  /** Get speech system status (STT/TTS availability, voice count). */
  getStatus: protectedProcedure.query(() => {
    return getSpeechService().getStatus();
  }),

  /** Upload a custom voice (base64-encoded WAV). */
  uploadCustomVoice: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        wavBase64: z.string(),
        description: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const wavBuffer = Buffer.from(input.wavBase64, 'base64');
      return getSpeechService().voices.addCustomVoice(
        input.name,
        wavBuffer,
        input.description,
      );
    }),

  /** Remove a custom voice by ID. */
  removeCustomVoice: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await getSpeechService().voices.removeCustomVoice(input.id);
      return { success: true };
    }),

  /** Preview a voice by synthesizing a short sample phrase. Returns base64-encoded WAV. */
  previewVoice: protectedProcedure
    .input(z.object({ voiceId: z.string() }))
    .mutation(async ({ input }) => {
      const speech = getSpeechService();
      const persona = personaStore.getPersona(getPersonaDb());
      const name = persona?.name || 'Animus';
      const text = `Hello, this is ${name}. This is what I sound like. What do you think of this voice?`;
      const result = await speech.tts.synthesize(
        text,
        { voiceId: input.voiceId },
      );
      return { wavBase64: result.wavBuffer.toString('base64') };
    }),
});
