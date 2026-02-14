/**
 * API Channel Adapter — STUB
 *
 * Placeholder for OpenAI/Ollama compatible REST API endpoints.
 * Actual implementation deferred.
 *
 * See docs/architecture/channels.md — "API Channel: OpenAI-Compatible" and "Ollama-Compatible"
 */

import type { FastifyInstance } from 'fastify';
import type { IChannelAdapter } from '../types.js';
import type { ChannelType } from '@animus/shared';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('ApiAdapter', 'channels');

export class ApiChannelAdapter implements IChannelAdapter {
  readonly channelType: ChannelType = 'api';
  private enabled = false;

  async start(): Promise<void> {
    this.enabled = true;
    log.info('Started (stub mode)');
  }

  async stop(): Promise<void> {
    this.enabled = false;
    log.info('Stopped');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Send an outbound message via the API channel.
   * API is stateless — outbound is returned as part of the response, not pushed.
   */
  async send(
    contactId: string,
    content: string,
    _metadata?: Record<string, unknown>
  ): Promise<void> {
    // API responses are synchronous — the reply is part of the HTTP response
    log.info(
      `Would send API response to contact ${contactId}: "${content.substring(0, 50)}..."`
    );
  }

  /**
   * Register OpenAI-compatible and Ollama-compatible API routes.
   * STUB: Returns placeholder responses.
   */
  async registerRoutes(fastify: FastifyInstance): Promise<void> {
    // ----- OpenAI-compatible endpoints -----

    // GET /api/openai/v1/models
    fastify.get('/api/openai/v1/models', async (_request, _reply) => {
      // TODO: Return actual model info
      return {
        object: 'list',
        data: [
          {
            id: 'animus',
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'animus',
          },
        ],
      };
    });

    // POST /api/openai/v1/chat/completions
    fastify.post('/api/openai/v1/chat/completions', async (request, reply) => {
      // TODO: Extract last user message from request body
      // TODO: Route through channel router as API channel message
      // TODO: Support streaming (SSE) and non-streaming responses

      const body = request.body as Record<string, unknown>;
      const stream = body.stream !== false;

      if (stream) {
        // TODO: Implement SSE streaming
        reply.type('text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');

        const id = `chatcmpl-${Date.now()}`;
        const chunk = JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'animus',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'API endpoint stub — not yet connected to the mind.' },
              finish_reason: 'stop',
            },
          ],
        });

        return `data: ${chunk}\n\ndata: [DONE]\n\n`;
      }

      return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'animus',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'API endpoint stub — not yet connected to the mind.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    });

    // ----- Ollama-compatible endpoints -----

    // GET /api/ollama/api/tags
    fastify.get('/api/ollama/api/tags', async (_request, _reply) => {
      return {
        models: [
          {
            name: 'animus',
            model: 'animus',
            modified_at: new Date().toISOString(),
            size: 0,
            digest: '',
            details: {
              parent_model: '',
              format: 'gguf',
              family: 'animus',
              parameter_size: 'unknown',
              quantization_level: 'none',
            },
          },
        ],
      };
    });

    // POST /api/ollama/api/chat
    fastify.post('/api/ollama/api/chat', async (request, reply) => {
      // TODO: Extract last user message, route through channel router
      // TODO: Support NDJSON streaming

      const body = request.body as Record<string, unknown>;
      const stream = body.stream !== false;

      if (stream) {
        reply.type('application/x-ndjson');

        const chunk = JSON.stringify({
          model: 'animus',
          created_at: new Date().toISOString(),
          message: {
            role: 'assistant',
            content: 'Ollama endpoint stub — not yet connected to the mind.',
          },
          done: true,
          total_duration: 0,
          eval_count: 0,
        });

        return chunk + '\n';
      }

      return {
        model: 'animus',
        created_at: new Date().toISOString(),
        message: {
          role: 'assistant',
          content: 'Ollama endpoint stub — not yet connected to the mind.',
        },
        done: true,
        total_duration: 0,
        eval_count: 0,
      };
    });

    // POST /api/ollama/api/generate (legacy)
    fastify.post('/api/ollama/api/generate', async (_request, _reply) => {
      return {
        model: 'animus',
        created_at: new Date().toISOString(),
        response: 'Generate endpoint stub — not yet connected to the mind.',
        done: true,
      };
    });

    log.info('API routes registered (OpenAI + Ollama stubs)');
  }
}
