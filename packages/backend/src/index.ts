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
import * as systemStore from './db/stores/system-store.js';

const log = createLogger('Server', 'server');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Initialize databases (opens 5 DBs, runs migrations)
  log.info('Initializing databases...');
  await initializeDatabases();

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

  // Health check endpoint
  fastify.get('/api/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
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
