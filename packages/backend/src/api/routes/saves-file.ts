/**
 * Saves File Routes — Native Fastify routes for binary file operations.
 *
 * These bypass tRPC because tRPC doesn't handle binary streams well.
 *   GET  /api/saves/:id/export          — Download save as .animus zip
 *   POST /api/saves/:id/export-to-path  — Deprecated, desktop writes exports through Tauri
 *   POST /api/saves/import              — Upload .animus zip to import
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
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
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
          const message = err instanceof Error ? err.message : 'Unknown error';
          const statusCode = message.startsWith('Invalid save ID') ? 400 : 500;
          return reply.status(statusCode).send({
            error: 'Export failed',
            message,
          });
        }
      }
  );

  // Deprecated: desktop exports now download the archive and write through Tauri.
  app.post<{ Params: { id: string }; Body: { destPath: string } }>(
    '/api/saves/:id/export-to-path',
    {
      preHandler: (app as any).authenticate,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      log.warn(`Rejected deprecated export-to-path request for save "${id}"`);
      return reply.status(410).send({
        error: 'DESKTOP_EXPORT_MOVED',
        message: 'Desktop exports are written by the desktop app. Use /api/saves/:id/export to download the archive.',
      });
    }
  );

  // Import a save from an uploaded .animus zip file
  app.post(
      '/api/saves/import',
      {
        preHandler: (app as any).authenticate,
        config: {
          rawBody: true,
          rateLimit: {
            max: 5,
            timeWindow: '10 minutes',
          },
        },
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
