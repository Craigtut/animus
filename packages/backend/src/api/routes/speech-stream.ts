/**
 * Speech Stream Route -- chunked HTTP streaming for TTS voice preview.
 *
 * POST /api/speech/preview-stream
 *   Body: { voiceId: string }
 *   Response: chunked application/octet-stream
 *     - 8-byte binary header: sampleRate (u32le) + reserved flags (u32le)
 *     - Then Int16LE PCM chunks as they are generated
 *
 * This bypasses tRPC because tRPC doesn't support chunked binary streaming.
 */

import type { FastifyInstance } from 'fastify';
import { getSpeechService } from '../../speech/index.js';
import { getPersonaDb } from '../../db/index.js';
import * as personaStore from '../../db/stores/persona-store.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('SpeechStream', 'speech');

/** Convert Float32 samples (-1..1) to Int16LE PCM buffer. */
function float32ToInt16LE(samples: Float32Array): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    // Clamp to [-1, 1] and scale to Int16 range
    const s = Math.max(-1, Math.min(1, samples[i]!));
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    buf.writeInt16LE(Math.round(val), i * 2);
  }
  return buf;
}

export async function registerSpeechStreamRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { voiceId: string } }>(
    '/api/speech/preview-stream',
    {
      preHandler: (app as any).authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['voiceId'],
          properties: {
            voiceId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { voiceId } = request.body;
      let headersSent = false;

      try {
        const speech = getSpeechService();
        const persona = personaStore.getPersona(getPersonaDb());
        const name = persona?.name || 'Animus';
        const text = `Hello, this is ${name}. This is what I sound like. What do you think of this voice?`;

        const stream = speech.tts.synthesizeStream(text, { voiceId });

        // Set chunked streaming headers
        reply.raw.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Transfer-Encoding': 'chunked',
          'X-Audio-Sample-Rate': '24000',
          'X-Audio-Format': 'pcm-s16le',
          'X-Audio-Channels': '1',
          'Cache-Control': 'no-cache',
        });
        headersSent = true;

        // Write 8-byte binary header: sampleRate (u32le) + reserved flags (u32le)
        const header = Buffer.alloc(8);
        header.writeUInt32LE(24000, 0);
        header.writeUInt32LE(0, 4); // reserved
        reply.raw.write(header);

        // Track if client disconnected
        let aborted = false;
        request.raw.on('close', () => { aborted = true; });

        for await (const chunk of stream) {
          if (aborted) break;

          const pcmBuf = float32ToInt16LE(chunk);
          const canContinue = reply.raw.write(pcmBuf);

          // Backpressure: wait for drain if kernel buffer is full
          if (!canContinue && !aborted) {
            await new Promise<void>((resolve) => {
              reply.raw.once('drain', resolve);
              // Also resolve on close to avoid hanging
              request.raw.once('close', resolve);
            });
          }
        }

        reply.raw.end();
      } catch (err) {
        log.error('Speech streaming failed:', err);

        if (!headersSent) {
          return reply.status(500).send({
            error: 'SPEECH_STREAM_FAILED',
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
        // Headers already sent, just close the connection
        reply.raw.end();
      }
    },
  );
}
