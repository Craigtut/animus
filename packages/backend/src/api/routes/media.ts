/**
 * Media Routes — Native Fastify routes for file upload and serving.
 *
 * Bypasses tRPC because tRPC doesn't handle multipart uploads or binary streams.
 *   POST /api/media/upload  — Upload one or more files, returns pending attachment metadata
 *   GET  /api/media/:id     — Serve a media file by attachment ID
 *
 * Upload flow:
 *   1. Frontend uploads files via POST /api/media/upload
 *   2. Files are saved to data/media/{uuid}.{ext}, metadata held in memory
 *   3. Frontend sends message via tRPC messages.send with attachmentIds[]
 *   4. messages.send creates media_attachments DB records linked to the message
 */

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { generateUUID } from '@animus-labs/shared';
import { getMessagesDb } from '../../db/index.js';
import * as messageStore from '../../db/stores/message-store.js';
import { createLogger } from '../../lib/logger.js';
import { DATA_DIR } from '../../utils/env.js';

const log = createLogger('MediaRoutes', 'server');

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const MAX_FILES = 10;
const PENDING_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const MEDIA_DIR = path.join(DATA_DIR, 'media');

const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif',
  // Audio
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/aac', 'audio/flac', 'audio/mp4',
  // Video
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
  // Documents
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
  'application/json',
  'application/zip',
]);

function classifyMimeType(mimeType: string): 'image' | 'audio' | 'video' | 'file' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/avif': '.avif',
    'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav',
    'audio/webm': '.weba', 'audio/aac': '.aac', 'audio/flac': '.flac', 'audio/mp4': '.m4a',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv', 'video/quicktime': '.mov',
    'application/pdf': '.pdf', 'text/plain': '.txt', 'text/csv': '.csv',
    'text/markdown': '.md', 'application/json': '.json', 'application/zip': '.zip',
  };
  return map[mimeType] || '.bin';
}

// ============================================================================
// Pending Uploads — in-memory store for files awaiting message attachment
// ============================================================================

export interface PendingUpload {
  id: string;
  type: 'image' | 'audio' | 'video' | 'file';
  mimeType: string;
  localPath: string;
  originalFilename: string | null;
  sizeBytes: number;
  uploadedAt: number;
}

const pendingUploads = new Map<string, PendingUpload>();

/** Get and remove a pending upload by ID. Returns null if not found or expired. */
export function consumePendingUpload(id: string): PendingUpload | null {
  const upload = pendingUploads.get(id);
  if (!upload) return null;
  pendingUploads.delete(id);
  if (Date.now() - upload.uploadedAt > PENDING_TTL_MS) {
    // Expired — clean up the file
    try { fs.unlinkSync(upload.localPath); } catch { /* ignore */ }
    return null;
  }
  return upload;
}

/** Peek at a pending upload without removing it. */
export function getPendingUpload(id: string): PendingUpload | null {
  const upload = pendingUploads.get(id);
  if (!upload) return null;
  if (Date.now() - upload.uploadedAt > PENDING_TTL_MS) {
    pendingUploads.delete(id);
    try { fs.unlinkSync(upload.localPath); } catch { /* ignore */ }
    return null;
  }
  return upload;
}

// Periodic cleanup of expired pending uploads
setInterval(() => {
  const now = Date.now();
  for (const [id, upload] of pendingUploads) {
    if (now - upload.uploadedAt > PENDING_TTL_MS) {
      pendingUploads.delete(id);
      try { fs.unlinkSync(upload.localPath); } catch { /* ignore */ }
      log.debug(`Cleaned up expired pending upload: ${id}`);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

// ============================================================================
// Route registration
// ============================================================================

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  // Encapsulate multipart registration so it doesn't conflict with other
  // routes that also need @fastify/multipart (e.g. package-upload).
  await app.register(async (instance) => {
    await instance.register(multipart, {
      limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILES,
      },
    });

    // Ensure media directory exists
    fs.mkdirSync(MEDIA_DIR, { recursive: true });

    /**
     * POST /api/media/upload
     *
     * Accepts multipart form data with one or more files.
     * Files are saved to disk and tracked in memory as pending uploads.
     * Returns an array of pending attachment metadata (id, type, mimeType, etc.).
     */
    instance.post(
      '/api/media/upload',
      {
        preHandler: (instance as any).authenticate,
      },
      async (request, reply) => {
      try {
        const parts = request.parts();
        const uploaded: PendingUpload[] = [];

        for await (const part of parts) {
          if (part.type !== 'file') continue;

          const mimeType = part.mimetype || 'application/octet-stream';
          if (!ALLOWED_MIME_TYPES.has(mimeType)) {
            log.warn(`Rejected upload: unsupported MIME type ${mimeType}`);
            return reply.status(400).send({
              error: 'UNSUPPORTED_FILE_TYPE',
              message: `File type ${mimeType} is not supported`,
            });
          }

          const id = generateUUID();
          const ext = mimeToExt(mimeType);
          const filePath = path.join(MEDIA_DIR, `${id}${ext}`);

          // Stream file to disk
          const writeStream = fs.createWriteStream(filePath);
          let sizeBytes = 0;

          try {
            for await (const chunk of part.file) {
              sizeBytes += chunk.length;
              if (sizeBytes > MAX_FILE_SIZE) {
                writeStream.destroy();
                try { fs.unlinkSync(filePath); } catch { /* ignore */ }
                return reply.status(413).send({
                  error: 'FILE_TOO_LARGE',
                  message: `File exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
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

          const pending: PendingUpload = {
            id,
            type: classifyMimeType(mimeType),
            mimeType,
            localPath: filePath,
            originalFilename: part.filename || null,
            sizeBytes,
            uploadedAt: Date.now(),
          };

          pendingUploads.set(id, pending);
          uploaded.push(pending);
        }

        if (uploaded.length === 0) {
          return reply.status(400).send({
            error: 'NO_FILES',
            message: 'No files were uploaded',
          });
        }

        return reply.send({
          attachments: uploaded.map(({ id, type, mimeType, originalFilename, sizeBytes }) => ({
            id, type, mimeType, originalFilename, sizeBytes,
          })),
        });
      } catch (err) {
        log.error('Media upload failed:', err);
        return reply.status(500).send({
          error: 'UPLOAD_FAILED',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * GET /api/media/:id
   *
   * Serves a media file by its attachment ID.
   * First checks persisted media_attachments table, then falls back to pending uploads.
   */
  instance.get<{ Params: { id: string } }>(
    '/api/media/:id',
    {
      preHandler: (instance as any).authenticate,
    },
    async (request, reply) => {
      const { id } = request.params;

      try {
        // Check persisted attachments first
        const db = getMessagesDb();
        const attachment = messageStore.getMediaAttachment(db, id);

        let filePath: string;
        let mimeType: string;
        let fileSize: number;

        if (attachment) {
          filePath = attachment.localPath;
          mimeType = attachment.mimeType;
          fileSize = attachment.sizeBytes;
        } else {
          // Check pending uploads (for previews before message send)
          const pending = getPendingUpload(id);
          if (!pending) {
            return reply.status(404).send({ error: 'NOT_FOUND', message: 'Attachment not found' });
          }
          filePath = pending.localPath;
          mimeType = pending.mimeType;
          fileSize = pending.sizeBytes;
        }

        if (!fs.existsSync(filePath)) {
          log.warn(`Media file missing from disk: ${filePath}`);
          return reply.status(404).send({ error: 'FILE_MISSING', message: 'File not found on disk' });
        }

        const stream = fs.createReadStream(filePath);
        return reply
          .header('Content-Type', mimeType)
          .header('Content-Length', fileSize)
          .header('Cache-Control', 'private, max-age=86400')
          .send(stream);
      } catch (err) {
        log.error('Media serve failed:', err);
        return reply.status(500).send({
          error: 'SERVE_FAILED',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );
  }); // end encapsulated multipart scope
}
