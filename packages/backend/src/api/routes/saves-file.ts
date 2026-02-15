/**
 * Saves File Routes — Native Fastify routes for binary file operations.
 *
 * These bypass tRPC because tRPC doesn't handle binary streams well.
 *   GET  /api/saves/:id/export  — Download save as .animus zip
 *   POST /api/saves/import      — Upload .animus zip to import
 */

import type { FastifyInstance } from 'fastify';
import { exportSave, importSave } from '../../services/save-service.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('SavesFileRoutes', 'saves');

export async function registerSaveFileRoutes(app: FastifyInstance): Promise<void> {
  // Export a save as a .animus zip file
  app.get<{ Params: { id: string } }>(
    '/api/saves/:id/export',
    {
      preHandler: (app as any).authenticate,
    },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const { buffer, name } = await exportSave(id);
        return reply
          .header('Content-Type', 'application/zip')
          .header('Content-Disposition', `attachment; filename="${name}.animus"`)
          .send(buffer);
      } catch (err) {
        log.error('Export failed:', err);
        return reply.status(500).send({
          error: 'Export failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );

  // Import a save from an uploaded .animus zip file
  app.post(
    '/api/saves/import',
    {
      preHandler: (app as any).authenticate,
      config: { rawBody: true },
      bodyLimit: 500 * 1024 * 1024, // 500 MB
    },
    async (request, reply) => {
      try {
        const buffer = request.body as Buffer;
        if (!buffer || buffer.length === 0) {
          return reply.status(400).send({ error: 'No file data received' });
        }

        const saveInfo = await importSave(buffer);
        return reply.send(saveInfo);
      } catch (err) {
        log.error('Import failed:', err);
        return reply.status(500).send({
          error: 'Import failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );
}
