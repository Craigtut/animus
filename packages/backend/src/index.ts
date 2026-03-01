/**
 * Animus Backend Server
 *
 * Main entry point for the Fastify server with tRPC integration.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import path from 'path';
import { fileURLToPath } from 'url';

import { initializeDatabases, closeDatabases, getSystemDb, DATABASE_COUNT } from './db/index.js';
import { createTRPCContext, appRouter } from './api/index.js';
import authPlugin from './plugins/auth.js';
import { initializeHeartbeat, stopHeartbeat, handleAgentComplete, handleScheduledTask } from './heartbeat/index.js';
import { LifecycleManager } from './lib/lifecycle.js';
import { MemorySubsystem } from './memory/index.js';
import { GoalSubsystem } from './goals/index.js';
import { TaskSubsystem } from './tasks/index.js';
import { AgentSubsystem } from './heartbeat/agent-subsystem.js';
import { loadCredentialsIntoEnv, ensureClaudeOnboardingFile } from './services/credential-service.js';
import { env, DATA_DIR } from './utils/env.js';
import { resolveSecrets, persistSecretsIfNeeded } from './lib/secrets-manager.js';
import { createLogger, updateCategoryCache } from './lib/logger.js';
import { logProcessIdentity } from './lib/process-diagnostics.js';
import { isMaintenanceMode, getMaintenanceReason } from './lib/maintenance.js';
import { formatStartupSummary } from './lib/startup-summary.js';
import * as systemStore from './db/stores/system-store.js';

const log = createLogger('Server', 'server');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const startupStartedAt = Date.now();

  // macOS dock icon suppression: propagate the addon path into DYLD_INSERT_LIBRARIES
  // so ALL child processes (including Observer/Reflector sessions that don't pass
  // explicit env) automatically inherit it. The Claude SDK uses { ...process.env }
  // as the default env for child processes, but strips NODE_OPTIONS. By setting
  // DYLD_INSERT_LIBRARIES in process.env here, we ensure universal coverage.
  // This runs AFTER the sidecar's own native addons are loaded, so it won't
  // interfere with onnxruntime or other native modules in this process.
  if (process.platform === 'darwin') {
    const addonPath = process.env['ANIMUS_DOCK_SUPPRESS_ADDON'];
    if (addonPath) {
      process.env['DYLD_INSERT_LIBRARIES'] = addonPath;
    }
  }

  // Create data subdirectories before anything that might log
  const fsMod = await import('node:fs');
  fsMod.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });
  fsMod.mkdirSync(path.join(DATA_DIR, 'workspace'), { recursive: true });

  // Log process identity for production diagnostics
  logProcessIdentity('sidecar');

  // Resolve encryption key + JWT secret (auto-generate if needed)
  resolveSecrets();

  // Initialize databases (opens 6 DBs, runs migrations)
  await initializeDatabases();

  // Verify encryption key matches what was used to encrypt existing data
  const { verifyEncryptionKey } = await import('./lib/encryption-service.js');
  verifyEncryptionKey(getSystemDb());

  // Persist .secrets file now that the key is verified
  persistSecretsIfNeeded();

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
  const modelRegistry = initModelRegistry({
    cacheDir: path.join(DATA_DIR, 'cache'),
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

  // ── Security Hardening ──

  // Security headers (CSP, X-Content-Type-Options, X-Frame-Options, etc.)
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null, // Disable — app runs over HTTP on LAN
      },
    },
    crossOriginEmbedderPolicy: false, // Allow loading cross-origin resources (media, etc.)
    hsts: false, // Disable — self-hosted app may run over plain HTTP
  });

  // Rate limiting — generous for single-user, prevents abuse
  await fastify.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      // Use authenticated user ID if available, otherwise IP
      return (request as any).userId ?? request.ip;
    },
  });

  // CORS — In development the frontend runs on a different port (5173) so we
  // explicitly allow it. In production the backend serves the frontend
  // statically (same origin), so we accept any origin here and let the
  // onRequest hook below enforce same-origin via Host header comparison.
  // This approach naturally supports any deployment: localhost, LAN IP, Docker,
  // Tailscale — no hardcoded addresses needed.
  await fastify.register(cors, {
    origin: env.NODE_ENV === 'development' ? ['http://localhost:5173'] : true,
    credentials: true,
  });

  await fastify.register(cookie);
  await fastify.register(websocket);
  await fastify.register(authPlugin);

  // Origin validation — prevents cross-site WebSocket hijacking (same class
  // of vulnerability as OpenClaw CVE-2026-25253) and cross-origin abuse.
  //
  // In production the frontend is served from the same host as the API, so
  // the browser's Origin header will always match the request's Host header.
  // This naturally supports any deployment: localhost, LAN IP, Docker, Tailscale, etc.
  if (env.NODE_ENV === 'production') {
    fastify.addHook('onRequest', async (request, reply) => {
      const origin = request.headers['origin'];
      if (!origin) return; // Non-browser requests (curl, webhooks) have no Origin

      // Compare origin's host against the request's Host header.
      // The Host header reflects the address the user typed into their browser,
      // so this is a same-origin check that works for any deployment topology.
      try {
        const originHost = new URL(origin).host;     // e.g. "192.168.1.50:3000"
        const requestHost = request.headers['host']; // e.g. "192.168.1.50:3000"
        if (originHost === requestHost) return; // Same-origin — allow
      } catch {
        // Malformed origin — fall through to reject
      }

      log.warn(`Rejected request from untrusted origin: ${origin}`);
      return reply.status(403).send({ error: 'Forbidden: untrusted origin' });
    });
  }

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

  // Register package upload route (.anpk files)
  const { registerPackageUploadRoutes } = await import('./api/routes/package-upload.js');
  await registerPackageUploadRoutes(fastify);

  // Register OAuth callback route (plugin OAuth authorization code flow)
  const { registerOAuthCallbackRoute } = await import('./api/routes/oauth-callback.js');
  await registerOAuthCallbackRoute(fastify);

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
  const { getPluginManager } = await import('./plugins/index.js');
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

  // Re-seed tool permissions when the agent provider changes at runtime.
  // Without this, switching providers leaves stale SDK tools in the DB
  // (e.g. Codex tools when switching to Claude) and the new provider's
  // unique tools (Read, Glob, WebFetch, etc.) never get permission records.
  getEventBus().on('system:settings_updated', (payload) => {
    if ('defaultAgentProvider' in payload) {
      const provider = (payload as Record<string, unknown>)['defaultAgentProvider'] as string;
      const reseeded = seedToolPermissions(getSystemDb(), provider, collectPluginTools());
      log.info(`Re-seeded tool permissions after provider change to "${provider}"`);
      log.debug(`Tool permissions count after re-seed: ${reseeded}`);
    }
  });

  // Initialize speech service (lazy-loads models on first use)
  const { initSpeechService } = await import('./speech/index.js');
  const speechService = await initSpeechService({ dataDir: DATA_DIR });

  // Initialize download manager
  const { initDownloadManager, getSpeechAssets } = await import('./downloads/index.js');
  const downloadManager = initDownloadManager(DATA_DIR);

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

  // Construct and start subsystems via lifecycle manager
  const memorySubsystem = new MemorySubsystem();
  const goalSubsystem = new GoalSubsystem(memorySubsystem);
  const agentSubsystem = new AgentSubsystem(handleAgentComplete);
  const taskSubsystem = new TaskSubsystem(handleScheduledTask);

  const lifecycle = new LifecycleManager();
  lifecycle.register(memorySubsystem)
    .register(goalSubsystem)
    .register(agentSubsystem)
    .register(taskSubsystem);
  await lifecycle.startAll();

  // Initialize heartbeat system (receives pre-started subsystem references)
  const heartbeatInit = await initializeHeartbeat({
    memory: memorySubsystem,
    goals: goalSubsystem,
    agents: agentSubsystem,
  });

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
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down all subsystems...`);
    await stopHeartbeat();
    await lifecycle.stopAll();
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

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('Failed to start server:', err);
  process.exit(1);
});
