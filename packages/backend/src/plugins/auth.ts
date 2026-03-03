/**
 * Auth Plugin -- Fastify plugin for JWT authentication.
 *
 * Registers @fastify/jwt with cookie-based transport.
 * Decorates fastify with an `authenticate` preHandler hook.
 *
 * JWT secret is loaded from data/jwt.key (separate from the vault DEK).
 * On first run (before registration), the secret won't exist yet;
 * a temporary secret is used until registration creates the real one.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fp from 'fastify-plugin';
import { env } from '../utils/env.js';
import { loadJwtSecret } from '../lib/jwt-key.js';

export interface JwtPayload {
  userId: string;
  email: string;
}

const COOKIE_NAME = 'animus_session';

async function authPlugin(fastify: FastifyInstance): Promise<void> {
  // Load JWT secret from file. Falls back to env var for legacy installs,
  // then to a temporary secret for first-run (before registration creates jwt.key).
  const jwtSecret = loadJwtSecret() ?? env.JWT_SECRET ?? 'animus-temp-jwt-secret-pre-registration';

  await fastify.register(fastifyJwt, {
    secret: jwtSecret,
    cookie: {
      cookieName: COOKIE_NAME,
      signed: false,
    },
  });

  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch {
        reply.status(401).send({ error: 'UNAUTHORIZED' });
      }
    }
  );
}

// Secure cookies require HTTPS. The Tauri desktop app serves over http://127.0.0.1,
// so we only set Secure when both in production AND not on localhost (i.e. Docker/reverse proxy).
const isLocalhost = ['127.0.0.1', 'localhost', '0.0.0.0'].includes(env.HOST);

export const COOKIE_OPTIONS = {
  cookieName: COOKIE_NAME,
  httpOnly: true,
  secure: env.NODE_ENV === 'production' && !isLocalhost,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: env.SESSION_EXPIRY_DAYS * 24 * 60 * 60, // seconds
};

export default fp(authPlugin, {
  name: 'auth',
});
