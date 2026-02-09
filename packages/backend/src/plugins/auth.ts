/**
 * Auth Plugin — Fastify plugin for JWT authentication.
 *
 * Registers @fastify/jwt with cookie-based transport.
 * Decorates fastify with an `authenticate` preHandler hook.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fp from 'fastify-plugin';
import { env } from '../utils/env.js';

export interface JwtPayload {
  userId: string;
  email: string;
}

const COOKIE_NAME = 'animus_session';

async function authPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
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

export const COOKIE_OPTIONS = {
  cookieName: COOKIE_NAME,
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: env.SESSION_EXPIRY_DAYS * 24 * 60 * 60, // seconds
};

export default fp(authPlugin, {
  name: 'auth',
});
