/**
 * Speech Stream Routes -- chunked HTTP streaming for TTS.
 *
 * POST /api/speech/preview-stream
 *   Body: { voiceId: string }
 *   Auth: JWT (frontend)
 *   Response: chunked application/octet-stream (Int16LE PCM)
 *
 * POST /api/speech/synthesize-stream
 *   Body: { text: string, voice_id?: string, speed?: number }
 *   Auth: JWT (frontend) or Bearer channel API key (HA integration)
 *   Response: chunked application/octet-stream (Int16LE PCM)
 *
 * Both routes use the same binary protocol:
 *   - 8-byte header: sampleRate (u32le) + reserved flags (u32le)
 *   - Then Int16LE PCM chunks as they are generated
 *
 * This bypasses tRPC because tRPC doesn't support chunked binary streaming.
 */

import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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

/**
 * Validate a Bearer token against a channel's stored API key.
 * Returns true if the token matches any speech-capable channel's API key.
 */
async function validateChannelApiKey(request: FastifyRequest): Promise<boolean> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7);
  if (!token) return false;

  try {
    const { getChannelManager } = await import('../../channels/channel-manager.js');
    const cm = getChannelManager();

    for (const channelType of cm.getInstalledChannelTypes()) {
      const processHost = cm.getProcess(channelType);
      if (!processHost) continue;

      const config = processHost.getDecryptedConfig?.();
      const storedKey = config?.['apiKey'] as string | undefined;
      if (!storedKey) continue;

      const tokenBuf = Buffer.from(token, 'utf-8');
      const keyBuf = Buffer.from(storedKey, 'utf-8');
      if (tokenBuf.length === keyBuf.length && timingSafeEqual(tokenBuf, keyBuf)) {
        return true;
      }
    }
  } catch {
    // Channel manager not available
  }

  return false;
}

/**
 * Auth preHandler that accepts either JWT (frontend) or channel Bearer token.
 */
async function authenticateJwtOrChannelKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Try JWT first
  try {
    await (request as any).jwtVerify();
    return;
  } catch {
    // JWT failed, try channel API key
  }

  if (await validateChannelApiKey(request)) {
    return;
  }

  reply.status(401).send({ error: 'UNAUTHORIZED' });
}

/** Stream TTS audio chunks over a chunked HTTP response. */
async function streamTtsResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  text: string,
  voiceId?: string,
  speed?: number,
): Promise<void> {
  let headersSent = false;

  try {
    const speech = getSpeechService();
    const opts: import('../../speech/tts-engine.js').TTSSynthesisOptions = {};
    if (voiceId != null) opts.voiceId = voiceId;
    if (speed != null) opts.speed = speed;
    const stream = speech.tts.synthesizeStream(text, opts);

    reply.raw.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Transfer-Encoding': 'chunked',
      'X-Audio-Sample-Rate': '24000',
      'X-Audio-Format': 'pcm-s16le',
      'X-Audio-Channels': '1',
      'Cache-Control': 'no-cache',
    });
    headersSent = true;

    const header = Buffer.alloc(8);
    header.writeUInt32LE(24000, 0);
    header.writeUInt32LE(0, 4);
    reply.raw.write(header);

    let aborted = false;
    request.raw.on('close', () => { aborted = true; });

    for await (const chunk of stream) {
      if (aborted) break;

      const pcmBuf = float32ToInt16LE(chunk);
      const canContinue = reply.raw.write(pcmBuf);

      if (!canContinue && !aborted) {
        await new Promise<void>((resolve) => {
          reply.raw.once('drain', resolve);
          request.raw.once('close', resolve);
        });
      }
    }

    reply.raw.end();
  } catch (err) {
    log.error('Speech streaming failed:', err);

    if (!headersSent) {
      reply.status(500).send({
        error: 'SPEECH_STREAM_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      return;
    }
    reply.raw.end();
  }
}

export async function registerSpeechStreamRoute(app: FastifyInstance): Promise<void> {
  // Voice preview (JWT auth only, hardcoded sample text)
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
      const persona = personaStore.getPersona(getPersonaDb());
      const name = persona?.name || 'Animus';
      const text = `Hello, this is ${name}. This is what I sound like. What do you think of this voice?`;
      await streamTtsResponse(request, reply, text, voiceId);
    },
  );

  // General-purpose streaming TTS (JWT or channel API key auth)
  app.post<{ Body: { text: string; voice_id?: string; speed?: number } }>(
    '/api/speech/synthesize-stream',
    {
      preHandler: authenticateJwtOrChannelKey,
      schema: {
        body: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 10000 },
            voice_id: { type: 'string' },
            speed: { type: 'number', minimum: 0.5, maximum: 2.0 },
          },
        },
      },
    },
    async (request, reply) => {
      const { text, voice_id, speed } = request.body;
      await streamTtsResponse(request, reply, text, voice_id ?? undefined, speed ?? undefined);
    },
  );
}
