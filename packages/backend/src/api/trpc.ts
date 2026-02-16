/**
 * tRPC Initialization
 *
 * Separated from the router to avoid circular imports
 * between api/index.ts and routers/*.ts.
 */

import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { createVerifier } from 'fast-jwt';
import type { JwtPayload } from '../plugins/auth.js';
import { env } from '../utils/env.js';

// ============================================================================
// WebSocket Auth Helpers
// ============================================================================

const COOKIE_NAME = 'animus_session';

/** Verifier for WebSocket connections where Fastify decorations aren't available */
const verifyJwt = createVerifier({ key: env.JWT_SECRET });

function extractCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] ?? null : null;
}

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
    if (typeof (req as any).jwtVerify === 'function') {
      // Normal HTTP request — use Fastify's JWT decoration
      const decoded = await (req as any).jwtVerify() as JwtPayload;
      userId = decoded.userId;
    } else {
      // WebSocket raw IncomingMessage — manually verify JWT from cookie
      const token = extractCookieValue(req.headers.cookie, COOKIE_NAME);
      if (token) {
        const decoded = verifyJwt(token) as JwtPayload;
        userId = decoded.userId;
      }
    }
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
