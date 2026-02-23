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

import { initializeDatabases, closeDatabases, getSystemDb, DATABASE_COUNT } from './db/index.js';
import { createTRPCContext, appRouter } from './api/index.js';
import authPlugin from './plugins/auth.js';
import { initializeHeartbeat, stopHeartbeat } from './heartbeat/index.js';
import { loadCredentialsIntoEnv, ensureClaudeOnboardingFile } from './services/credential-service.js';
import { env } from './utils/env.js';
import { createLogger, updateCategoryCache } from './lib/logger.js';
import { isMaintenanceMode, getMaintenanceReason } from './lib/maintenance.js';
import { formatStartupSummary } from './lib/startup-summary.js';
import * as systemStore from './db/stores/system-store.js';

const log = createLogger('Server', 'server');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const startupStartedAt = Date.now();

  // Initialize databases (opens 5 DBs, runs migrations)
  await initializeDatabases();

  // Verify encryption key matches what was used to encrypt existing data
  const { verifyEncryptionKey } = await import('./lib/encryption-service.js');
  verifyEncryptionKey(getSystemDb());

  // Load log category settings into logger cache
  const logCategories = systemStore.getLogCategories(getSystemDb());
  updateCategoryCache(logCategories);

  // Load stored credentials into environment
  const credentialSummary = loadCredentialsIntoEnv(getSystemDb());
  ensureClaudeOnboardingFile();

  // Route agents package logs through the backend logger so all output
  // uses the same format (timestamps, level labels, file logging, categories).
  const { setDefaultLogger, initModelRegistry } = await import('@animus-labs/agents');
  const agentsLog = createLogger('Agents', 'agents');
  setDefaultLogger({
    debug(msg: string, ctx?: Record<string, unknown>) {
      agentsLog.debug(ctx ? `${msg} ${JSON.stringify(ctx)}` : msg);
    },
    info(msg: string, ctx?: Record<string, unknown>) {
      agentsLog.info(ctx ? `${msg} ${JSON.stringify(ctx)}` : msg);
    },
    warn(msg: string, ctx?: Record<string, unknown>) {
      agentsLog.warn(ctx ? `${msg} ${JSON.stringify(ctx)}` : msg);
    },
    error(msg: string, ctx?: Record<string, unknown>) {
      agentsLog.error(ctx ? `${msg} ${JSON.stringify(ctx)}` : msg);
    },
  });

  // Initialize model registry with disk cache for LiteLLM pricing data
  const dataDir = path.dirname(env.DB_SYSTEM_PATH);
  const modelRegistry = initModelRegistry({
    cacheDir: path.join(dataDir, 'cache'),
    cacheTtlMs: 24 * 60 * 60 * 1000,
  });
  modelRegistry.refresh().then(
    ({ updated, errors }) => {
      if (errors.length > 0) {
        log.warn('Model registry refresh had errors', { errors });
      } else {
        log.debug(`Model registry initialized (${modelRegistry.size} models, ${updated} pricing updates)`);
      }
    },
    (err) => log.warn('Model registry refresh failed (local data still available)', { error: String(err) }),
  );

  // Create Fastify instance
  const fastify = Fastify({
    logger: false,
    routerOptions: {
      maxParamLength: 500,
    },
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

  // Register media upload/serve routes
  const { registerMediaRoutes } = await import('./api/routes/media.js');
  await registerMediaRoutes(fastify);

  // Register content type parser for binary uploads (save import)
  fastify.addContentTypeParser(
    'application/octet-stream',
    { bodyLimit: 500 * 1024 * 1024 },
    async (request: import('fastify').FastifyRequest, payload: import('stream').Readable) => {
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
  const { getPluginManager } = await import('./services/plugin-manager.js');
  const pluginManager = getPluginManager();
  await pluginManager.loadAll();

  // Seed tool permissions (after migrations + plugins, before heartbeat)
  const { seedToolPermissions } = await import('./tools/permission-seeder.js');
  const settings = systemStore.getSystemSettings(getSystemDb());

  // Helper: collect plugin MCP tool info for the seeder
  function collectPluginTools() {
    const mcpConfigs = pluginManager.getMcpConfigs();
    const pluginToolMap = new Map<string, Array<{ name: string; description?: string }>>();
    for (const [namespacedKey, config] of Object.entries(mcpConfigs)) {
      // Key format: "pluginName__serverName"
      const sepIdx = namespacedKey.indexOf('__');
      const pluginName = sepIdx > 0 ? namespacedKey.substring(0, sepIdx) : namespacedKey;
      const tools = pluginToolMap.get(pluginName) ?? [];
      tools.push({
        name: `mcp__${namespacedKey}`,
        description: config.description ?? `MCP tools from ${pluginName}`,
      });
      pluginToolMap.set(pluginName, tools);
    }
    return Array.from(pluginToolMap.entries()).map(
      ([name, tools]) => ({ name, tools })
    );
  }

  const seededToolPermissions = seedToolPermissions(getSystemDb(), settings.defaultAgentProvider ?? 'claude', collectPluginTools());

  // Set up approval notifier (event bus listener for tool approval lifecycle)
  const { setupApprovalNotifier } = await import('./tools/approval-notifier.js');
  const { getEventBus } = await import('./lib/event-bus.js');
  setupApprovalNotifier(getEventBus());

  // Re-seed tool permissions when plugins change at runtime
  getEventBus().on('plugin:changed', () => {
    const currentSettings = systemStore.getSystemSettings(getSystemDb());
    const reseeded = seedToolPermissions(getSystemDb(), currentSettings.defaultAgentProvider ?? 'claude', collectPluginTools());
    log.info('Re-seeded tool permissions after plugin change');
    log.debug(`Tool permissions count after re-seed: ${reseeded}`);
  });

  // Initialize speech service (lazy-loads models on first use)
  const { initSpeechService } = await import('./speech/index.js');
  const speechService = await initSpeechService({ dataDir: path.dirname(env.DB_SYSTEM_PATH) });

  // Initialize download manager
  const { initDownloadManager, getSpeechAssets } = await import('./downloads/index.js');
  const downloadManager = initDownloadManager(dataDir);

  // Re-initialize voice manager when speech models finish downloading
  getEventBus().on('download:completed', async (payload) => {
    if (payload.category === 'speech') {
      log.info(`Speech model downloaded: ${payload.label}, re-initializing voices...`);
      await speechService.voices.initialize();
    }
  });

  // Initialize channel manager (after plugins, before heartbeat)
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
  const heartbeatInit = await initializeHeartbeat();

  // Auto-download missing speech models if onboarding is complete
  const onboardingState = systemStore.getOnboardingState(getSystemDb());
  if (onboardingState.isComplete) {
    const missingAssets = getSpeechAssets().filter((a) => !downloadManager.isAssetPresent(a));
    if (missingAssets.length > 0) {
      log.info(`Auto-downloading ${missingAssets.length} missing speech model(s)...`);
      downloadManager.enqueue(missingAssets);
    }
  }

  const pluginStats = pluginManager.getRuntimeStats();
  const channelStats = channelManager.getRuntimeStats();
  const startupSummary = formatStartupSummary({
    dbCount: DATABASE_COUNT,
    credentialsStored: credentialSummary.storedCount,
    cliDetectedProviders: credentialSummary.cliDetectedProviders,
    modelDataCount: modelRegistry.size,
    pluginsLoaded: pluginStats.loaded,
    pluginsEnabled: pluginStats.enabled,
    deployedSkills: pluginStats.deployedSkills,
    toolsSeeded: seededToolPermissions,
    channelsInstalled: channelStats.installed,
    channelsRunning: channelStats.running,
    resumedAfterRestart: heartbeatInit.resumedAfterRestart,
    nextTickInMs: heartbeatInit.nextTickInMs,
    startupMs: Date.now() - startupStartedAt,
    address: `${env.HOST}:${env.PORT}`,
    environment: env.NODE_ENV,
  });
  log.info(`\n${startupSummary}`);

  // Start server
  try {
    const address = await fastify.listen({
      port: env.PORT,
      host: env.HOST,
    });
    log.info(`Listening at ${address}`);
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
    // Cancel any in-progress downloads
    downloadManager.cancelAll();
    // Stop all channel child processes
    await channelManager.stopAll();
    // Release speech engine resources
    await speechService.shutdown();
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
