/**
 * Channels Config Router — tRPC procedures for channel configuration.
 *
 * Manages channel adapter settings (SMS/Twilio, Discord, API).
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb } from '../../db/index.js';
import * as systemStore from '../../db/stores/system-store.js';
import {
  channelConfigTypeSchema,
  smsChannelConfigSchema,
  discordChannelConfigSchema,
} from '@animus/shared';

export const channelsRouter = router({
  /**
   * Get all channel configurations.
   */
  getConfigs: protectedProcedure.query(() => {
    return systemStore.getChannelConfigs(getSystemDb());
  }),

  /**
   * Save channel configuration.
   */
  configure: protectedProcedure
    .input(
      z.object({
        channelType: channelConfigTypeSchema,
        config: z.record(z.unknown()),
        isEnabled: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => {
      // Validate channel-specific config
      switch (input.channelType) {
        case 'sms':
          smsChannelConfigSchema.parse(input.config);
          break;
        case 'discord':
          discordChannelConfigSchema.parse(input.config);
          break;
        case 'openai_api':
        case 'ollama_api':
          // No required fields for now
          break;
      }

      const configData: Parameters<typeof systemStore.upsertChannelConfig>[1] = {
        channelType: input.channelType,
        config: JSON.stringify(input.config),
      };
      if (input.isEnabled !== undefined) configData.isEnabled = input.isEnabled;
      return systemStore.upsertChannelConfig(getSystemDb(), configData);
    }),

  /**
   * Test channel connection (stub — returns success for now).
   */
  validate: protectedProcedure
    .input(z.object({ channelType: channelConfigTypeSchema }))
    .mutation(({ input }) => {
      // TODO: Implement actual connection testing per channel type
      // For now, just verify config exists
      const config = systemStore.getChannelConfig(getSystemDb(), input.channelType);
      if (!config) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No configuration found for channel: ${input.channelType}`,
        });
      }
      return { success: true, message: 'Connection test not yet implemented' };
    }),
});
