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
});

export type AppRouter = typeof appRouter;
