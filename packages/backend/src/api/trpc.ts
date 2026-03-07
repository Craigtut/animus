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
import { loadJwtSecret } from '../lib/jwt-key.js';

// ============================================================================
// WebSocket Auth Helpers
// ============================================================================

const COOKIE_NAME = 'animus_session';

/** Verifier for WebSocket connections where Fastify decorations aren't available.
 *  Lazy-initialized because jwt.key is read at startup. */
let _verifyJwt: ReturnType<typeof createVerifier> | null = null;
function verifyJwt(token: string) {
  if (!_verifyJwt) {
    const secret = loadJwtSecret();
    if (!secret) throw new Error('JWT secret not available');
    _verifyJwt = createVerifier({ key: secret });
  }
  return _verifyJwt(token);
}

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

export async function createTRPCContext(
  opts: CreateFastifyContextOptions,
): Promise<TRPCContext> {
  const { req, res } = opts;
  let userId: string | null = null;
  try {
    if (typeof (req as any).jwtVerify === 'function') {
      // Normal HTTP request — use Fastify's JWT decoration
      const decoded = await (req as any).jwtVerify() as JwtPayload;
      userId = decoded.userId;
    } else {
      // WebSocket raw IncomingMessage — try cookie first
      let token = extractCookieValue(req.headers.cookie, COOKIE_NAME);

      // Fallback: use connectionParams. WKWebView on macOS doesn't reliably
      // send cookies with WebSocket upgrade requests. The client sends the
      // JWT via tRPC's connectionParams (first message after WS connect),
      // which the server receives in info.connectionParams.
      if (!token) {
        const info = (opts as any).info as { connectionParams?: Record<string, string> | null } | undefined;
        token = info?.connectionParams?.['token'] ?? null;
      }

      if (token) {
        const decoded = await verifyJwt(token) as JwtPayload;
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
