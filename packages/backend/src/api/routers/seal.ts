/**
 * Seal Router -- tRPC procedures for vault seal state, unlock, and password change.
 *
 * These endpoints manage the encryption vault lifecycle: checking if the server
 * is sealed, unlocking it with a password, and changing the password.
 *
 * Status and unlock are public (no JWT required) because the frontend needs
 * to query vault state and unlock the server before any authenticated
 * session exists.
 */

import { z } from 'zod';
import * as argon2 from 'argon2';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import {
  getSealState,
  loadVault,
  unseal,
  rewrapVault,
  isUnsealed,
  getDek,
} from '../../lib/vault-manager.js';
import { setDek } from '../../lib/encryption-service.js';
import { loadCredentialsIntoEnv, ensureClaudeOnboardingFile } from '../../services/credential-service.js';
import { getSystemDb } from '../../db/index.js';
import * as systemStore from '../../db/stores/system-store.js';
import { COOKIE_OPTIONS } from '../../plugins/auth.js';
import type { JwtPayload } from '../../plugins/auth.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('Seal', 'server');

export const sealRouter = router({
  /**
   * Public status check: returns the current vault seal state.
   * The frontend checks this before deciding which page to show.
   */
  status: publicProcedure.query(() => {
    return { sealState: getSealState() };
  }),

  /**
   * Unlock the vault with a password.
   * Derives the password key, unwraps the DEK, verifies the sentinel,
   * loads credentials, and issues a JWT session.
   */
  unlock: publicProcedure
    .input(z.object({ password: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const vault = loadVault();
      if (!vault) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No vault found. Registration may not be complete.',
        });
      }

      try {
        await unseal(input.password, vault);
        setDek(getDek());
      } catch (err) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: err instanceof Error ? err.message : 'Wrong password',
        });
      }

      // Vault is now unsealed: verify encryption sentinel and load credentials
      const db = getSystemDb();
      try {
        const { verifyEncryptionKey } = await import('../../lib/encryption-service.js');
        verifyEncryptionKey(db);
      } catch (err) {
        log.error('Encryption sentinel verification failed after unlock:', err);
      }

      loadCredentialsIntoEnv(db);
      ensureClaudeOnboardingFile();

      // Start deferred subsystems (channels, plugins, heartbeat full mode)
      try {
        const { getChannelManager } = await import('../../channels/channel-manager.js');
        const channelManager = getChannelManager();
        await channelManager.loadAll();
      } catch (err) {
        log.error('Failed to start channels after unlock:', err);
      }

      // Re-validate plugin configs now that decryption is available.
      // During initial loadAll(), config checks were skipped because the vault
      // was sealed. Now we can verify and disable any plugins truly missing config.
      try {
        const { getPluginManager } = await import('../../plugins/index.js');
        getPluginManager().revalidateConfigs();
      } catch (err) {
        log.error('Failed to revalidate plugin configs after unlock:', err);
      }

      // Trigger a heartbeat tick so the agent wakes up immediately,
      // but only if the user had the heartbeat enabled (respect paused state)
      try {
        const { getHeartbeatDb } = await import('../../db/index.js');
        const { getHeartbeatState } = await import('../../db/stores/heartbeat-state-store.js');
        const hbState = getHeartbeatState(getHeartbeatDb());
        if (hbState.isRunning) {
          const { triggerTick } = await import('../../heartbeat/index.js');
          triggerTick().catch(err => log.error('Failed to trigger post-unlock tick:', err));
        } else {
          log.info('Heartbeat is paused, skipping post-unlock tick');
        }
      } catch {
        // Heartbeat may not be initialized yet
      }

      // Issue JWT session if a user exists
      const user = (() => {
        try {
          const count = systemStore.getUserCount(db);
          if (count > 0) {
            const firstUser = db.prepare('SELECT id, email FROM users LIMIT 1').get() as
              | { id: string; email: string }
              | undefined;
            return firstUser ?? null;
          }
          return null;
        } catch {
          return null;
        }
      })();

      if (user && typeof ctx.req.server.jwt?.sign === 'function') {
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

        log.info('Vault unlocked, session issued');
        return { success: true, user: { userId: user.id, email: user.email } };
      }

      log.info('Vault unlocked (no user session)');
      return { success: true, user: null };
    }),

  /**
   * Change the user's password: re-wraps the DEK with a new password-derived key
   * and updates the password hash in the users table.
   */
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8),
        confirmNewPassword: z.string().min(8),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.newPassword !== input.confirmNewPassword) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'New passwords do not match',
        });
      }

      if (!isUnsealed()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Vault must be unsealed to change password',
        });
      }

      // Verify current password against stored hash
      const db = getSystemDb();
      const user = systemStore.getUserById(db, ctx.userId);
      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      const hash = systemStore.getPasswordHash(db, user.email);
      if (!hash) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'No password hash found' });
      }

      const valid = await argon2.verify(hash, input.currentPassword);
      if (!valid) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current password is incorrect' });
      }

      // Re-wrap vault DEK with new password
      try {
        await rewrapVault(input.currentPassword, input.newPassword);
      } catch (err) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : 'Failed to re-wrap vault',
        });
      }

      // Update password hash in users table
      const newHash = await argon2.hash(input.newPassword);
      systemStore.updatePasswordHash(db, user.email, newHash);

      log.info('Password changed and vault re-wrapped');
      return { success: true };
    }),

  /**
   * Migrate from legacy .secrets file to vault.json.
   * User provides a password to protect the new vault.
   */
  migrate: publicProcedure
    .input(z.object({ password: z.string().min(8) }))
    .mutation(async ({ input, ctx }) => {
      if (getSealState() !== 'needs-migration') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Migration is not needed',
        });
      }

      const { migrateToVault } = await import('../../lib/vault-migration.js');
      const db = getSystemDb();

      try {
        const result = await migrateToVault(input.password, db);

        // Load credentials now that the vault is unsealed
        loadCredentialsIntoEnv(db);
        ensureClaudeOnboardingFile();

        // Start channels
        try {
          const { getChannelManager } = await import('../../channels/channel-manager.js');
          const channelManager = getChannelManager();
          await channelManager.loadAll();
        } catch (err) {
          log.error('Failed to start channels after migration:', err);
        }

        // Re-validate plugin configs now that decryption is available
        try {
          const { getPluginManager } = await import('../../plugins/index.js');
          getPluginManager().revalidateConfigs();
        } catch (err) {
          log.error('Failed to revalidate plugin configs after migration:', err);
        }

        // Trigger a heartbeat tick so the agent wakes up immediately,
        // but only if the user had the heartbeat enabled (respect paused state)
        try {
          const { getHeartbeatDb } = await import('../../db/index.js');
          const { getHeartbeatState } = await import('../../db/stores/heartbeat-state-store.js');
          const hbState = getHeartbeatState(getHeartbeatDb());
          if (hbState.isRunning) {
            const { triggerTick } = await import('../../heartbeat/index.js');
            triggerTick().catch(err => log.error('Failed to trigger post-migration tick:', err));
          } else {
            log.info('Heartbeat is paused, skipping post-migration tick');
          }
        } catch {
          // Heartbeat may not be initialized yet
        }

        // Issue JWT session if a user exists
        const user = (() => {
          try {
            const count = systemStore.getUserCount(db);
            if (count > 0) {
              const firstUser = db.prepare('SELECT id, email FROM users LIMIT 1').get() as
                | { id: string; email: string }
                | undefined;
              return firstUser ?? null;
            }
            return null;
          } catch {
            return null;
          }
        })();

        if (user && typeof ctx.req.server.jwt?.sign === 'function') {
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
        }

        return {
          success: true,
          migratedCredentials: result.migratedCredentials,
          migratedPluginConfigs: result.migratedPluginConfigs,
          user: user ? { userId: user.id, email: user.email } : null,
        };
      } catch (err) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : 'Migration failed',
        });
      }
    }),
});
