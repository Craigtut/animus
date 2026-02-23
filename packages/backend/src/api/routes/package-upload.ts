/**
 * Package Upload Route — Native Fastify route for .anpk file upload.
 *
 * Bypasses tRPC because tRPC doesn't handle multipart uploads.
 *   POST /api/packages/upload  — Upload an .anpk file, returns the saved file path
 *
 * Upload flow:
 *   1. Frontend uploads .anpk file via POST /api/packages/upload
 *   2. File is saved to data/packages/{uuid}.anpk
 *   3. Returns the local file path for use with verifyPackage/installFromPackage
 */

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { generateUUID } from '@animus-labs/shared';
import { createLogger } from '../../lib/logger.js';
import { env } from '../../utils/env.js';

const log = createLogger('PackageUpload', 'server');

const MAX_PACKAGE_SIZE = 100 * 1024 * 1024; // 100 MB
const UPLOAD_DIR = path.resolve(path.dirname(env.DB_SYSTEM_PATH), 'package-uploads');

export async function registerPackageUploadRoutes(app: FastifyInstance): Promise<void> {
  // Register multipart in an encapsulated context so it doesn't conflict
  // with the media routes' multipart registration
  await app.register(async (instance) => {
    await instance.register(multipart, {
      limits: {
        fileSize: MAX_PACKAGE_SIZE,
        files: 1,
      },
    });

    // Ensure upload directory exists
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    /**
     * POST /api/packages/upload
     *
     * Accepts a single .anpk file via multipart form data.
     * Saves it to disk and returns the file path for the verify + install flow.
     */
    instance.post(
      '/api/packages/upload',
      {
        preHandler: (instance as any).authenticate,
      },
      async (request, reply) => {
        try {
          const data = await request.file();

          if (!data) {
            return reply.status(400).send({
              error: 'NO_FILE',
              message: 'No file was uploaded',
            });
          }

          const originalName = data.filename || 'unknown.anpk';
          if (!originalName.endsWith('.anpk')) {
            return reply.status(400).send({
              error: 'INVALID_FILE_TYPE',
              message: 'Only .anpk files are accepted',
            });
          }

          const id = generateUUID();
          const filePath = path.join(UPLOAD_DIR, `${id}.anpk`);

          // Stream file to disk
          const writeStream = fs.createWriteStream(filePath);
          let sizeBytes = 0;

          try {
            for await (const chunk of data.file) {
              sizeBytes += chunk.length;
              if (sizeBytes > MAX_PACKAGE_SIZE) {
                writeStream.destroy();
                try { fs.unlinkSync(filePath); } catch { /* ignore */ }
                return reply.status(413).send({
                  error: 'FILE_TOO_LARGE',
                  message: `Package exceeds maximum size of ${MAX_PACKAGE_SIZE / (1024 * 1024)}MB`,
                });
              }
              writeStream.write(chunk);
            }
          } catch (err) {
            writeStream.destroy();
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
            throw err;
          }

          writeStream.end();
          await new Promise<void>((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
          });

          log.info(`Package uploaded: ${originalName} (${(sizeBytes / 1024).toFixed(1)} KB) -> ${filePath}`);

          return reply.send({
            filePath,
            originalFilename: originalName,
            sizeBytes,
          });
        } catch (err) {
          log.error('Package upload failed:', err);
          return reply.status(500).send({
            error: 'UPLOAD_FAILED',
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    );
  });
}
