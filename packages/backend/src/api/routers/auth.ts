/**
 * Auth Router — tRPC procedures for registration, login, logout, status.
 *
 * First-user bootstrap: registration is locked after the first user is created.
 */

import { TRPCError } from '@trpc/server';
import * as argon2 from 'argon2';
import { loginInputSchema, registerInputSchema } from '@animus-labs/shared';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import * as systemStore from '../../db/stores/system-store.js';
import * as contactStore from '../../db/stores/contact-store.js';
import { getSystemDb, getContactsDb } from '../../db/index.js';
import { COOKIE_OPTIONS } from '../../plugins/auth.js';
import type { JwtPayload } from '../../plugins/auth.js';

export const authRouter = router({
  /**
   * Public status check — returns whether a user exists and if the caller is authenticated.
   */
  status: publicProcedure.query(async ({ ctx }) => {
    const db = getSystemDb();
    const hasUser = systemStore.getUserCount(db) > 0;

    let isAuthenticated = false;
    try {
      await ctx.req.jwtVerify();
      isAuthenticated = true;
    } catch {
      // Not authenticated
    }

    return { hasUser, isAuthenticated };
  }),

  /**
   * Register the first user. Fails if a user already exists.
   */
  register: publicProcedure.input(registerInputSchema).mutation(async ({ input, ctx }) => {
    const db = getSystemDb();

    if (systemStore.getUserCount(db) > 0) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Registration is locked — a user already exists',
      });
    }

    const passwordHash = await argon2.hash(input.password);
    const user = systemStore.createUser(db, {
      email: input.email,
      passwordHash,
    });

    // Create the primary contact linked to this user (in contacts.db)
    const contactsDb = getContactsDb();
    const contact = contactStore.createContact(contactsDb, {
      fullName: input.email.split('@')[0] ?? 'User',
      userId: user.id,
      email: input.email,
      isPrimary: true,
      permissionTier: 'primary',
    });

    // Link user to contact (in system.db)
    systemStore.updateUserContactId(db, user.id, contact.id);

    // Create web channel for the contact (in contacts.db)
    contactStore.createContactChannel(contactsDb, {
      contactId: contact.id,
      channel: 'web',
      identifier: user.email,
    });

    // Sign JWT and set cookie
    const payload: JwtPayload = { userId: user.id, email: user.email };
    const token = ctx.req.server.jwt.sign(payload, {
      expiresIn: `${COOKIE_OPTIONS.maxAge}s`,
    });
    (ctx.res as any).setCookie(COOKIE_OPTIONS.cookieName, token, {
      httpOnly: COOKIE_OPTIONS.httpOnly,
      secure: COOKIE_OPTIONS.secure,
      sameSite: COOKIE_OPTIONS.sameSite,
      path: COOKIE_OPTIONS.path,
      maxAge: COOKIE_OPTIONS.maxAge,
    });

    return { userId: user.id, email: user.email };
  }),

  /**
   * Login with email and password.
   */
  login: publicProcedure.input(loginInputSchema).mutation(async ({ input, ctx }) => {
    const db = getSystemDb();

    const user = systemStore.getUserByEmail(db, input.email);
    if (!user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
    }

    const hash = systemStore.getPasswordHash(db, input.email);
    if (!hash) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
    }

    const valid = await argon2.verify(hash, input.password);
    if (!valid) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
    }

    const payload: JwtPayload = { userId: user.id, email: user.email };
    const token = ctx.req.server.jwt.sign(payload, {
      expiresIn: `${COOKIE_OPTIONS.maxAge}s`,
    });
    (ctx.res as any).setCookie(COOKIE_OPTIONS.cookieName, token, {
      httpOnly: COOKIE_OPTIONS.httpOnly,
      secure: COOKIE_OPTIONS.secure,
      sameSite: COOKIE_OPTIONS.sameSite,
      path: COOKIE_OPTIONS.path,
      maxAge: COOKIE_OPTIONS.maxAge,
    });

    return { userId: user.id, email: user.email };
  }),

  /**
   * Logout — clear the session cookie.
   */
  logout: publicProcedure.mutation(({ ctx }) => {
    (ctx.res as any).clearCookie(COOKIE_OPTIONS.cookieName, {
      path: COOKIE_OPTIONS.path,
    });
    return { success: true };
  }),

  /**
   * Get current authenticated user.
   */
  me: protectedProcedure.query(({ ctx }) => {
    const db = getSystemDb();
    const user = systemStore.getUserById(db, ctx.userId);
    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }
    return { userId: user.id, email: user.email };
  }),
});
