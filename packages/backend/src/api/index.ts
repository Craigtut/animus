/**
 * tRPC API Router
 *
 * Defines all API procedures and exports the router and context.
 */

import { initTRPC } from '@trpc/server';
import type { FastifyRequest, FastifyReply } from 'fastify';

// ============================================================================
// Context
// ============================================================================

export interface TRPCContext {
  req: FastifyRequest;
  res: FastifyReply;
  userId: string | null;
}

export async function createTRPCContext({
  req,
  res,
}: {
  req: FastifyRequest;
  res: FastifyReply;
}): Promise<TRPCContext> {
  // TODO: Extract user ID from session/JWT
  const userId = null;

  return {
    req,
    res,
    userId,
  };
}

// ============================================================================
// tRPC Initialization
// ============================================================================

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Protected procedure that requires authentication
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new Error('UNAUTHORIZED');
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
    },
  });
});

// ============================================================================
// Routers
// ============================================================================

// Import sub-routers (will be created as we build out features)
// import { authRouter } from './routers/auth.js';
// import { heartbeatRouter } from './routers/heartbeat.js';
// import { agentRouter } from './routers/agent.js';
// import { settingsRouter } from './routers/settings.js';

// ============================================================================
// App Router
// ============================================================================

export const appRouter = router({
  // Health check
  health: publicProcedure.query(() => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }),

  // Sub-routers will be added here
  // auth: authRouter,
  // heartbeat: heartbeatRouter,
  // agent: agentRouter,
  // settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
