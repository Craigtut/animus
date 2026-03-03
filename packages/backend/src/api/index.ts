/**
 * tRPC App Router
 *
 * Composes all sub-routers into the app router.
 * Re-exports tRPC primitives from trpc.ts.
 */

export { createTRPCContext, router, publicProcedure, protectedProcedure } from './trpc.js';
export type { TRPCContext } from './trpc.js';

import { router, publicProcedure } from './trpc.js';
import { authRouter } from './routers/auth.js';
import { settingsRouter } from './routers/settings.js';
import { heartbeatRouter } from './routers/heartbeat.js';
import { messagesRouter } from './routers/messages.js';
import { contactsRouter } from './routers/contacts.js';
import { onboardingRouter } from './routers/onboarding.js';
import { personaRouter } from './routers/persona.js';
import { channelsRouter } from './routers/channels.js';
import { dataRouter } from './routers/data.js';
import { providerRouter } from './routers/provider.js';
import { memoryRouter } from './routers/memory.js';
import { goalsRouter } from './routers/goals.js';
import { tasksRouter } from './routers/tasks.js';
import { agentLogsRouter } from './routers/agent-logs.js';
import { codexAuthRouter } from './routers/codex-auth.js';
import { claudeAuthRouter } from './routers/claude-auth.js';
import { codexCliAuthRouter } from './routers/codex-cli-auth.js';
import { pluginsRouter } from './routers/plugins.js';
import { savesRouter } from './routers/saves.js';
import { toolsRouter } from './routers/tools.js';
import { speechRouter } from './routers/speech.js';
import { downloadsRouter } from './routers/downloads.js';
import { pluginOAuthRouter } from './routers/plugin-oauth.js';
import { vaultRouter } from './routers/vault.js';
import { sealRouter } from './routers/seal.js';

// ============================================================================
// App Router
// ============================================================================

export const appRouter = router({
  health: publicProcedure.query(() => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }),

  auth: authRouter,
  settings: settingsRouter,
  heartbeat: heartbeatRouter,
  messages: messagesRouter,
  contacts: contactsRouter,
  onboarding: onboardingRouter,
  persona: personaRouter,
  channels: channelsRouter,
  data: dataRouter,
  provider: providerRouter,
  codexAuth: codexAuthRouter,
  claudeAuth: claudeAuthRouter,
  codexCliAuth: codexCliAuthRouter,
  memory: memoryRouter,
  goals: goalsRouter,
  tasks: tasksRouter,
  agentLogs: agentLogsRouter,
  plugins: pluginsRouter,
  saves: savesRouter,
  tools: toolsRouter,
  speech: speechRouter,
  downloads: downloadsRouter,
  pluginOAuth: pluginOAuthRouter,
  vault: vaultRouter,
  seal: sealRouter,
});

export type AppRouter = typeof appRouter;
