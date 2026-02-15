/**
 * Animus Backend Server
 *
 * Main entry point for the Fastify server with tRPC integration.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import path from 'path';
import { fileURLToPath } from 'url';

import { initializeDatabases, closeDatabases, getSystemDb } from './db/index.js';
import { createTRPCContext, appRouter } from './api/index.js';
import authPlugin from './plugins/auth.js';
import { initializeHeartbeat, stopHeartbeat } from './heartbeat/index.js';
import { loadCredentialsIntoEnv, ensureClaudeOnboardingFile } from './services/credential-service.js';
import { env } from './utils/env.js';
import { createLogger, updateCategoryCache } from './lib/logger.js';
import { isMaintenanceMode, getMaintenanceReason } from './lib/maintenance.js';
import * as systemStore from './db/stores/system-store.js';

const log = createLogger('Server', 'server');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Initialize databases (opens 5 DBs, runs migrations)
  log.info('Initializing databases...');
  await initializeDatabases();

  // Verify encryption key matches what was used to encrypt existing data
  const { verifyEncryptionKey } = await import('./lib/encryption-service.js');
  verifyEncryptionKey(getSystemDb());

  // Load log category settings into logger cache
  const logCategories = systemStore.getLogCategories(getSystemDb());
  updateCategoryCache(logCategories);

  // Load stored credentials into environment
  log.info('Loading stored credentials...');
  loadCredentialsIntoEnv(getSystemDb());
  ensureClaudeOnboardingFile();

  // Create Fastify instance
  const fastify = Fastify({
    logger: false,
  });

  // Register plugins
  await fastify.register(cors, {
    origin: env.NODE_ENV === 'development' ? ['http://localhost:5173'] : true,
    credentials: true,
  });

  await fastify.register(cookie);
  await fastify.register(websocket);
  await fastify.register(authPlugin);

  // Maintenance mode guard — return 503 for all routes except health check
  fastify.addHook('onRequest', async (request, reply) => {
    if (isMaintenanceMode() && request.url !== '/api/health') {
      return reply.status(503).send({
        error: 'Service temporarily unavailable',
        reason: getMaintenanceReason(),
      });
    }
  });

  // Serve static frontend files in production
  if (env.NODE_ENV === 'production') {
    await fastify.register(staticPlugin, {
      root: path.join(__dirname, 'public'),
      prefix: '/',
    });
  }

  // tRPC integration via Fastify adapter
  await fastify.register(fastifyTRPCPlugin, {
    prefix: '/api/trpc',
    useWSS: true,
    trpcOptions: {
      router: appRouter,
      createContext: createTRPCContext,
    },
  });

  // Register binary file routes for saves (export/import)
  const { registerSaveFileRoutes } = await import('./api/routes/saves-file.js');
  await registerSaveFileRoutes(fastify);

  // Register content type parser for binary uploads (save import)
  fastify.addContentTypeParser(
    'application/octet-stream',
    { bodyLimit: 500 * 1024 * 1024 },
    async (request, payload) => {
      const chunks: Buffer[] = [];
      for await (const chunk of payload) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
  );

  // Capture raw body for channel webhook routes (needed for signature validation)
  fastify.addHook('preParsing', async (request, _reply, payload) => {
    if (request.url.startsWith('/channels/')) {
      const chunks: Buffer[] = [];
      for await (const chunk of payload) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks);
      (request as any).rawBody = rawBody;
      const { Readable } = await import('node:stream');
      return Readable.from(rawBody);
    }
    return payload;
  });

  // Health check endpoint
  fastify.get('/api/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });

  // Channel webhook catch-all route — forwards to channel child processes
  // Must be registered before SPA fallback
  fastify.all('/channels/:channelType/*', async (request, reply) => {
    const { channelType } = request.params as { channelType: string };
    const { getChannelManager: getCM } = await import('./channels/channel-manager.js');
    const cm = getCM();
    const processHost = cm.getProcess(channelType);

    if (!processHost) {
      return reply.status(404).send({ error: `Channel ${channelType} not installed` });
    }
    if (!processHost.isRunning) {
      return reply.status(503).send({ error: `Channel ${channelType} is not currently running` });
    }

    // Build the sub-path (everything after /channels/:channelType/)
    const fullUrl = request.url;
    const prefix = `/channels/${channelType}`;
    const subPath = fullUrl.substring(prefix.length);

    // Forward to child process
    const result = await processHost.forwardRequest({
      method: request.method,
      url: subPath,
      headers: request.headers as Record<string, string>,
      body: request.body,
      rawBody: (request as any).rawBody ?? Buffer.alloc(0),
      query: request.query as Record<string, string>,
    });

    if (result.type === 'response') {
      const resp = result.data;
      if (resp.headers) {
        for (const [key, value] of Object.entries(resp.headers)) {
          reply.header(key, value);
        }
      }
      return reply.status(resp.status).send(resp.body);
    } else {
      // Streaming response
      reply.raw.writeHead(result.status, result.headers);
      try {
        for await (const chunk of result.stream) {
          reply.raw.write(chunk);
        }
      } catch (streamErr) {
        // Log but don't crash — the client connection may have closed
        const { createLogger } = await import('./lib/logger.js');
        createLogger('Channels', 'channels').error('Stream error:', streamErr);
      } finally {
        reply.raw.end();
      }
    }
  });

  // SPA fallback for client-side routing (production only)
  if (env.NODE_ENV === 'production') {
    fastify.setNotFoundHandler(async (request, reply) => {
      if (!request.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Not found' });
    });
  }

  // Initialize plugin manager (must be before heartbeat so plugins are available)
  log.info('Initializing plugin manager...');
  const { getPluginManager } = await import('./services/plugin-manager.js');
  const pluginManager = getPluginManager();
  await pluginManager.loadAll();

  // Initialize channel manager (after plugins, before heartbeat)
  log.info('Initializing channel manager...');
  const { getChannelManager } = await import('./channels/channel-manager.js');

  const channelManager = getChannelManager();

  // Register web as a built-in channel. Its "send" is a no-op because
  // the tRPC subscription pushes messages to the frontend via EventBus.
  channelManager.registerBuiltIn('web', async (_contactId, _content, _metadata) => {
    // No-op: web outbound is handled by message:sent event → tRPC subscription
  });

  // Load installed channel packages
  await channelManager.loadAll();

  // Initialize heartbeat system
  log.info('Initializing heartbeat system...');
  await initializeHeartbeat();

  // Start server
  try {
    const address = await fastify.listen({
      port: env.PORT,
      host: env.HOST,
    });
    log.info(`Listening at ${address}`);
    log.info(`Environment: ${env.NODE_ENV}`);
  } catch (err) {
    log.error('Server start failed:', err);
    process.exit(1);
  }

  // Graceful shutdown handler
  const shutdown = async () => {
    log.info('Shutting down...');
    await stopHeartbeat();
    await pluginManager.stopTriggers();
    await pluginManager.cleanupSkills();
    // Stop all channel child processes
    await channelManager.stopAll();
    await fastify.close();
    closeDatabases();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error('Failed to start server:', err);
  process.exit(1);
});
