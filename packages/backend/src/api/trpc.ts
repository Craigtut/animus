/**
 * tRPC Initialization
 *
 * Separated from the router to avoid circular imports
 * between api/index.ts and routers/*.ts.
 */

import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import type { JwtPayload } from '../plugins/auth.js';

// ============================================================================
// Context
// ============================================================================

export interface TRPCContext {
  req: CreateFastifyContextOptions['req'];
  res: CreateFastifyContextOptions['res'];
  userId: string | null;
}

export async function createTRPCContext({
  req,
  res,
}: CreateFastifyContextOptions): Promise<TRPCContext> {
  let userId: string | null = null;
  try {
    const decoded = await req.jwtVerify<JwtPayload>();
    userId = decoded.userId;
  } catch {
    // Not authenticated — that's fine for public procedures
  }

  return { req, res, userId };
}

// ============================================================================
// tRPC Instance
// ============================================================================

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
    },
  });
});
