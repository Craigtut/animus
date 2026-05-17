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
import { computeMcpToolPreview } from '@animus-labs/shared';
import type { ToolPermissionMode, PluginMcpServer } from '@animus-labs/shared';
import path from 'path';
import { fileURLToPath } from 'url';

import { initializeDatabases, closeDatabases, getSystemDb, getPersonaDb, DATABASE_COUNT } from './db/index.js';
import * as pluginStore from './db/stores/plugin-store.js';
import { createTRPCContext, appRouter } from './api/index.js';
import authPlugin from './plugins/auth.js';
import { initializeHeartbeat, stopHeartbeat, handleAgentComplete, handleScheduledTask } from './heartbeat/index.js';
import { LifecycleManager } from './lib/lifecycle.js';
import { MemorySubsystem } from './memory/index.js';
import { GoalSubsystem } from './goals/index.js';
import { TaskSubsystem } from './tasks/index.js';
import { AgentSubsystem } from './heartbeat/agent-subsystem.js';
import { getAutosaveSubsystem } from './services/autosave-subsystem.js';
import { env, DATA_DIR } from './utils/env.js';
import {
  loadVault,
  resolveUnlockPassword,
  unseal,
  hasLegacySecrets,
  setSealState,
  getSealState,
  isUnsealed,
  scrubPasswordSources,
  clearDek as vaultClearDek,
} from './lib/vault-manager.js';
import { setDek, clearDek } from './lib/encryption-service.js';
import { createLogger, updateCategoryCache } from './lib/logger.js';
import { logProcessIdentity } from './lib/process-diagnostics.js';
import { isMaintenanceMode, getMaintenanceReason } from './lib/maintenance.js';
import { formatStartupSummary } from './lib/startup-summary.js';
import { getTelemetryService } from './services/telemetry-service.js';
import * as systemStore from './db/stores/system-store.js';

const log = createLogger('Server', 'server');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Prevent core dumps from exposing in-memory DEK
  try {
    const proc = process as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (typeof proc.setrlimit === 'function') {
      proc.setrlimit('core', { soft: 0, hard: 0 });
    }
  } catch {
    // setrlimit not available on all platforms
  }

  const startupStartedAt = Date.now();

  // macOS dock icon suppression: propagate the addon path into DYLD_INSERT_LIBRARIES
  // so child processes that inherit process.env receive the same background policy.
  // This avoids relying on NODE_OPTIONS, which is stripped by some child launchers.
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

  // ---------------------------------------------------------------------------
  // Vault-based encryption: resolve seal state before DB init
  // ---------------------------------------------------------------------------
  const vault = loadVault();
  const unlockPassword = resolveUnlockPassword();

  if (vault && unlockPassword) {
    // Auto-unseal: password available (Docker env var, dev .env, Docker secret)
    try {
      await unseal(unlockPassword, vault);
      const { getDek } = await import('./lib/vault-manager.js');
      setDek(getDek());
      scrubPasswordSources();
      log.info('Vault auto-unsealed from password source');
    } catch (err) {
      log.error('Auto-unseal failed (wrong password?):', err);
      setSealState('sealed');
    }
  } else if (vault && !unlockPassword) {
    // Vault exists but no password: start sealed, wait for manual unlock
    setSealState('sealed');
    log.info('Vault is sealed: waiting for manual unlock via web UI');
  } else if (!vault && hasLegacySecrets()) {
    // Legacy .secrets file exists: needs migration
    setSealState('needs-migration');
    log.info('Legacy .secrets detected: migration to vault required');
  } else {
    // No vault, no legacy secrets: first run, registration will create vault
    setSealState('no-vault');
    log.info('No vault found: first-run mode (registration will create vault)');
  }

  // Initialize databases (opens 7 DBs, runs migrations)
  await initializeDatabases();

  // Load log category settings into logger cache
  const logCategories = systemStore.getLogCategories(getSystemDb());
  updateCategoryCache(logCategories);

  // Initialize telemetry (after DB init so settings are available)
  const telemetry = getTelemetryService();
  telemetry.initialize();
  telemetry.captureInstall();
  telemetry.printFirstRunNotice();

  // Verify encryption only when unsealed. Cortex credentials are resolved
  // lazily through CortexCredentialService rather than loaded into process.env.
  if (isUnsealed()) {
    const { verifyEncryptionKey } = await import('./lib/encryption-service.js');
    verifyEncryptionKey(getSystemDb());
  } else {
    log.info('Vault is sealed or absent: skipping encryption verification');
  }

  // Model registry and provider management are handled by the Cortex package.
  // See packages/cortex/src/provider-registry.ts for model resolution.

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

  // Register speech streaming route (chunked TTS preview)
  const { registerSpeechStreamRoute } = await import('./api/routes/speech-stream.js');
  await registerSpeechStreamRoute(fastify);

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

  fastify.addContentTypeParser(
    'audio/wav',
    { bodyLimit: 50 * 1024 * 1024 },
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

  // Graceful shutdown endpoint (used by Tauri on Windows where SIGTERM is not available).
  // Only accepts requests from localhost to prevent external shutdown triggers.
  fastify.post('/api/shutdown', async (request, reply) => {
    const remoteIp = request.ip;
    if (remoteIp !== '127.0.0.1' && remoteIp !== '::1' && remoteIp !== '::ffff:127.0.0.1') {
      return reply.status(403).send({ error: 'Shutdown only allowed from localhost' });
    }
    log.info('Received shutdown request via /api/shutdown (Tauri IPC)');
    reply.status(200).send({ status: 'shutting_down' });
    // Defer shutdown to after the response is sent
    setImmediate(() => {
      shutdown('HTTP_SHUTDOWN').catch((err) => {
        log.error('Shutdown failed:', err);
        process.exit(1);
      });
    });
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

      // Check for streaming signal from reply-streaming capable channels.
      // The child process handles auth and reportIncoming(), then signals
      // the parent to take over SSE streaming by returning { streaming: true }.
      const body = resp.body as Record<string, unknown> | undefined;
      if (resp.status === 200 && body?.['streaming'] === true) {
        const { bridgeReplyStream } = await import('./channels/reply-stream-bridge.js');
        const { getEventBus } = await import('./lib/event-bus.js');
        const streamRequestId = body['requestId'] as string | undefined;
        bridgeReplyStream(reply.raw, channelType, getEventBus(), streamRequestId);
        return;
      }

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

  // Parse the user's install-time per-tool mode choices from a plugin's
  // stored consent tokens (`toolmode:<seededKey>=<mode>`).
  function readInstallToolModes(pluginName: string): Map<string, ToolPermissionMode> {
    const modes = new Map<string, ToolPermissionMode>();
    try {
      const rec = pluginStore.getPlugin(getSystemDb(), pluginName);
      if (!rec?.permissionsGranted) return modes;
      const tokens: unknown = JSON.parse(rec.permissionsGranted);
      if (!Array.isArray(tokens)) return modes;
      for (const tok of tokens) {
        if (typeof tok !== 'string') continue;
        const m = /^toolmode:(.+)=(off|ask|always_allow)$/.exec(tok);
        if (m) modes.set(m[1]!, m[2] as ToolPermissionMode);
      }
    } catch {
      // Malformed token blob: ignore, fall back to manifest defaults.
    }
    return modes;
  }

  // Helper: collect plugin MCP tool info for the seeder. Uses the shared
  // computeMcpToolPreview so seeded rows match the install-time preview
  // exactly, then layers any install-time mode choices on top.
  function collectPluginTools() {
    const mcpConfigs = pluginManager.getMcpConfigs();
    // Regroup namespaced configs (`<plugin>__<server>`) into per-plugin
    // server maps for computeMcpToolPreview.
    const byPlugin = new Map<string, Record<string, PluginMcpServer>>();
    for (const [namespacedKey, config] of Object.entries(mcpConfigs)) {
      const sepIdx = namespacedKey.indexOf('__');
      const pluginName = sepIdx > 0 ? namespacedKey.slice(0, sepIdx) : namespacedKey;
      const serverName = sepIdx > 0 ? namespacedKey.slice(sepIdx + 2) : namespacedKey;
      const servers = byPlugin.get(pluginName) ?? {};
      servers[serverName] = config;
      byPlugin.set(pluginName, servers);
    }
    return Array.from(byPlugin.entries()).map(([pluginName, servers]) => {
      const installModes = readInstallToolModes(pluginName);
      const tools = computeMcpToolPreview(pluginName, servers).map((p) => {
        const chosen = installModes.get(p.toolName);
        return {
          name: p.toolName,
          description: p.description,
          riskTier: p.riskTier,
          // Only include `mode` when the user actually chose one;
          // omitting it lets the seeder use the manifest tier default.
          ...(chosen !== undefined ? { mode: chosen } : {}),
        };
      });
      return { name: pluginName, tools };
    });
  }

  const seededToolPermissions = seedToolPermissions(getSystemDb(), collectPluginTools());

  // Set up approval notifier (event bus listener for tool approval lifecycle)
  const { setupApprovalNotifier } = await import('./tools/approval-notifier.js');
  const { getEventBus } = await import('./lib/event-bus.js');
  setupApprovalNotifier(getEventBus());

  // Re-seed tool permissions when plugins change at runtime
  getEventBus().on('plugin:changed', () => {
    const reseeded = seedToolPermissions(getSystemDb(), collectPluginTools());
    log.info('Re-seeded tool permissions after plugin change');
    log.debug(`Tool permissions count after re-seed: ${reseeded}`);
  });

  // Re-seed tool permissions when the cortex provider changes at runtime.
  getEventBus().on('system:settings_updated', (payload) => {
    if ('cortexProvider' in payload) {
      const reseeded = seedToolPermissions(getSystemDb(), collectPluginTools());
      log.info('Re-seeded tool permissions after cortex provider change');
      log.debug(`Tool permissions count after re-seed: ${reseeded}`);
    }
  });

  // Initialize speech service (lazy-loads models on first use)
  const { initSpeechService } = await import('./speech/index.js');
  const speechService = await initSpeechService({ dataDir: DATA_DIR });

  // Wire TTS default voice to persona setting
  const personaStoreModule = await import('./db/stores/persona-store.js');
  speechService.tts.setVoiceIdProvider(() => {
    try {
      const persona = personaStoreModule.getPersona(getPersonaDb());
      return persona?.voiceId ?? null;
    } catch {
      return null;
    }
  });

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

  // Log permanent download failures (all retries exhausted)
  getEventBus().on('download:failed', (payload) => {
    if (payload.retriesRemaining === 0) {
      log.error(`Download permanently failed: ${payload.label} (${payload.category}) - ${payload.error}`);
    }
  });

  // Feature telemetry listeners (deduped per-day inside the service)
  getEventBus().on('goal:created', () => { try { telemetry.captureFeatureUsed('goals'); } catch {} });
  getEventBus().on('seed:created', () => { try { telemetry.captureFeatureUsed('goals'); } catch {} });
  getEventBus().on('memory:stored', () => { try { telemetry.captureFeatureUsed('memory'); } catch {} });
  getEventBus().on('channel:installed', () => { try { telemetry.captureFeatureUsed('channels'); } catch {} });
  getEventBus().on('plugin:changed', () => { try { telemetry.captureFeatureUsed('plugins'); } catch {} });
  getEventBus().on('energy:updated', () => { try { telemetry.captureFeatureUsed('sleep_energy'); } catch {} });

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
    .register(taskSubsystem)
    .register(getAutosaveSubsystem());
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
  const speechStatus = speechService.getStatus();
  const startupSummary = formatStartupSummary({
    dbCount: DATABASE_COUNT,
    cortexProvider: settings.cortexProvider,
    cortexModel: settings.cortexModel,
    modelDataCount: 0,
    pluginsLoaded: pluginStats.loaded,
    pluginsEnabled: pluginStats.enabled,
    pluginSkills: pluginStats.pluginSkills,
    toolsSeeded: seededToolPermissions,
    channelsInstalled: channelStats.installed,
    channelsRunning: channelStats.running,
    speechSttReady: speechStatus.sttAvailable,
    speechTtsReady: speechStatus.ttsAvailable,
    speechFfmpegAvailable: speechStatus.ffmpegAvailable,
    telemetryEnabled: telemetry.isEnabled(),
    resumedAfterRestart: heartbeatInit.resumedAfterRestart,
    nextTickInMs: heartbeatInit.nextTickInMs,
    startupMs: Date.now() - startupStartedAt,
    address: `${env.HOST}:${env.PORT}`,
    environment: env.NODE_ENV,
  });
  log.info(`\n${startupSummary}`);

  // Fire app_started telemetry event
  telemetry.captureAppStarted({
    provider: settings.cortexProvider ?? 'unknown',
    channelCount: channelStats.installed,
    pluginCount: pluginStats.loaded,
  });

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
    await stopHeartbeat({ preserveDesiredState: true });
    await lifecycle.stopAll();
    await pluginManager.stopTriggers();
    await pluginManager.cleanupSkills();
    // Cancel any in-progress downloads
    downloadManager.cancelAll();
    // Stop all channel child processes
    await channelManager.stopAll();
    // Release speech engine resources
    await speechService.shutdown();
    // Flush pending telemetry events
    await telemetry.shutdown();
    await fastify.close();
    closeDatabases();
    // Wipe DEK from memory
    clearDek();
    vaultClearDek();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Capture unhandled errors for telemetry (max 5/day, deduped by hash)
  process.on('uncaughtException', (err) => {
    try { telemetry.captureError(err); } catch {}
  });
  process.on('unhandledRejection', (reason) => {
    try { telemetry.captureError(reason); } catch {}
  });
}

main().catch((err) => {
  log.error('Failed to start server:', err);
  process.exit(1);
});
