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
import path from 'path';
import { fileURLToPath } from 'url';

import { initializeDatabases } from './db/index.js';
import { createTRPCContext, appRouter } from './api/index.js';
import { initializeHeartbeat } from './heartbeat/index.js';
import { env } from './utils/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Initialize databases
  console.log('Initializing databases...');
  await initializeDatabases();

  // Create Fastify instance
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
  });

  // Register plugins
  await fastify.register(cors, {
    origin: env.NODE_ENV === 'development' ? ['http://localhost:5173'] : true,
    credentials: true,
  });

  await fastify.register(cookie);
  await fastify.register(websocket);

  // Serve static frontend files in production
  if (env.NODE_ENV === 'production') {
    await fastify.register(staticPlugin, {
      root: path.join(__dirname, 'public'),
      prefix: '/',
    });
  }

  // tRPC HTTP handler
  fastify.all('/api/trpc/*', async (request, reply) => {
    // tRPC adapter integration will go here
    // For now, return a placeholder
    return { status: 'tRPC endpoint ready' };
  });

  // tRPC WebSocket handler for subscriptions
  fastify.get('/api/trpc', { websocket: true }, (socket, request) => {
    // tRPC WebSocket adapter integration will go here
    console.log('WebSocket connection established');

    socket.on('message', (message) => {
      console.log('Received:', message.toString());
    });

    socket.on('close', () => {
      console.log('WebSocket connection closed');
    });
  });

  // Health check endpoint
  fastify.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // SPA fallback for client-side routing (production only)
  if (env.NODE_ENV === 'production') {
    fastify.setNotFoundHandler(async (request, reply) => {
      // Only serve index.html for non-API routes
      if (!request.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Not found' });
    });
  }

  // Initialize heartbeat system
  console.log('Initializing heartbeat system...');
  await initializeHeartbeat();

  // Start server
  try {
    const address = await fastify.listen({
      port: env.PORT,
      host: env.HOST,
    });
    console.log(`Server listening at ${address}`);
    console.log(`Environment: ${env.NODE_ENV}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  process.exit(0);
});

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
