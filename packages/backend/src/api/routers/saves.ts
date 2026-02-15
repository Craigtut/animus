/**
 * Saves Router — tRPC procedures for save/restore management.
 */

import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import { isMaintenanceMode, getMaintenanceReason } from '../../lib/maintenance.js';
import * as saveService from '../../services/save-service.js';
import { restoreFromSave } from '../../services/restore-service.js';

export const savesRouter = router({
  list: publicProcedure.query(async () => {
    return saveService.listSaves();
  }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      return saveService.createSave(input.name, input.description);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await saveService.deleteSave(input.id);
    }),

  restore: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await restoreFromSave(input.id);
    }),

  maintenanceStatus: publicProcedure.query(() => {
    return {
      active: isMaintenanceMode(),
      reason: getMaintenanceReason(),
    };
  }),
});
