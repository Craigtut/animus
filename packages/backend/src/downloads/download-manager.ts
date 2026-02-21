/**
 * DownloadManager — sequential queue-based asset downloader with progress,
 * extraction, retry, and cancel support.
 *
 * Designed to be generic (any downloadable asset), not speech-specific.
 * Events are emitted via the EventBus for real-time frontend updates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { Writable, Transform } from 'node:stream';
import { createRequire } from 'node:module';
import { createLogger } from '../lib/logger.js';
import { getEventBus } from '../lib/event-bus.js';
import type { AssetDefinition, FileGroupAsset } from './asset-registry.js';

const require = createRequire(import.meta.url);

const log = createLogger('DownloadManager', 'downloads');

// ============================================================================
// Types
// ============================================================================

export type DownloadPhase = 'queued' | 'downloading' | 'extracting' | 'completed' | 'failed';

export interface DownloadState {
  assetId: string;
  label: string;
  category: string;
  phase: DownloadPhase;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  error?: string;
  retriesRemaining: number;
}

// ============================================================================
// DownloadManager
// ============================================================================

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000; // 2s, 8s, 32s (exponential)
const PROGRESS_THROTTLE_MS = 500;

export class DownloadManager {
  private dataDir: string;
  private state = new Map<string, DownloadState>();
  private queue: AssetDefinition[] = [];
  private abortControllers = new Map<string, AbortController>();
  private processing = false;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /** Enqueue assets for download. Skips assets already present or queued. */
  enqueue(assets: AssetDefinition[]): void {
    let enqueued = 0;
    for (const asset of assets) {
      // Skip if already downloaded
      if (this.isAssetPresent(asset)) {
        log.debug(`Asset "${asset.id}" already present, skipping`);
        continue;
      }
      // Skip if already queued or in progress
      const existing = this.state.get(asset.id);
      if (existing && existing.phase !== 'failed') {
        log.debug(`Asset "${asset.id}" already queued (phase: ${existing.phase}), skipping`);
        continue;
      }

      this.state.set(asset.id, {
        assetId: asset.id,
        label: asset.label,
        category: asset.category,
        phase: 'queued',
        bytesDownloaded: 0,
        totalBytes: asset.estimatedBytes,
        percent: 0,
        retriesRemaining: MAX_RETRIES,
      });
      this.queue.push(asset);
      enqueued++;
    }

    if (enqueued > 0) {
      log.info(`Enqueued ${enqueued} asset(s) for download`);
      this.processQueue();
    }
  }

  /** Cancel a specific download. */
  cancel(assetId: string): void {
    const controller = this.abortControllers.get(assetId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(assetId);
    }
    // Remove from queue
    this.queue = this.queue.filter((a) => a.id !== assetId);
    this.state.delete(assetId);
    log.info(`Cancelled download: ${assetId}`);
  }

  /** Cancel all downloads (shutdown cleanup). */
  cancelAll(): void {
    for (const [id, controller] of this.abortControllers) {
      controller.abort();
      log.info(`Cancelled download: ${id}`);
    }
    this.abortControllers.clear();
    this.queue = [];
    this.state.clear();
    this.processing = false;
  }

  /** Check if an asset's required files already exist on disk. */
  isAssetPresent(asset: AssetDefinition): boolean {
    const targetDir = path.join(this.dataDir, asset.extractionConfig.targetDir);
    return asset.requiredFiles.every((f) => fs.existsSync(path.join(targetDir, f)));
  }

  /** Get all current download states. */
  getAll(): DownloadState[] {
    return Array.from(this.state.values());
  }

  /** Get a single download state by asset ID. */
  get(assetId: string): DownloadState | undefined {
    return this.state.get(assetId);
  }

  // ==========================================================================
  // Queue Processing
  // ==========================================================================

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const asset = this.queue.shift()!;
      await this.downloadAsset(asset);
    }

    this.processing = false;
  }

  private async downloadAsset(asset: AssetDefinition): Promise<void> {
    const state = this.state.get(asset.id);
    if (!state) return;

    const eventBus = getEventBus();

    // Emit started
    state.phase = 'downloading';
    state.bytesDownloaded = 0;
    state.percent = 0;
    eventBus.emit('download:started', {
      assetId: asset.id,
      label: asset.label,
      category: asset.category,
    });

    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      attempt++;
      state.retriesRemaining = MAX_RETRIES - attempt;

      try {
        await this.fetchAndExtract(asset, state);

        // Validate required files exist
        if (!this.isAssetPresent(asset)) {
          throw new Error('Required files not found after extraction');
        }

        // Success
        state.phase = 'completed';
        state.percent = 100;
        eventBus.emit('download:completed', {
          assetId: asset.id,
          label: asset.label,
          category: asset.category,
        });
        log.info(`Download complete: ${asset.label}`);
        return;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        // If aborted (cancelled), don't retry
        if (err instanceof Error && err.name === 'AbortError') {
          state.phase = 'failed';
          state.error = 'Cancelled';
          this.state.delete(asset.id);
          return;
        }

        log.warn(`Download attempt ${attempt}/${MAX_RETRIES} failed for ${asset.id}: ${errorMsg}`);

        if (attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_MS * Math.pow(4, attempt - 1); // 2s, 8s, 32s
          eventBus.emit('download:failed', {
            assetId: asset.id,
            label: asset.label,
            category: asset.category,
            error: errorMsg,
            retriesRemaining: MAX_RETRIES - attempt,
          });
          log.info(`Retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
          state.phase = 'downloading';
          state.bytesDownloaded = 0;
          state.percent = 0;
        } else {
          // Final failure
          state.phase = 'failed';
          state.error = errorMsg;
          state.retriesRemaining = 0;
          eventBus.emit('download:failed', {
            assetId: asset.id,
            label: asset.label,
            category: asset.category,
            error: errorMsg,
            retriesRemaining: 0,
          });
          log.error(`Download failed permanently: ${asset.label} — ${errorMsg}`);
        }
      }
    }
  }

  private async fetchAndExtract(asset: AssetDefinition, state: DownloadState): Promise<void> {
    if (asset.extractionConfig.type === 'files') {
      await this.downloadFileGroup(asset as FileGroupAsset, state);
    } else {
      await this.downloadAndExtractArchive(asset, state);
    }
  }

  /** Download a group of individual files to the target directory. */
  private async downloadFileGroup(asset: FileGroupAsset, state: DownloadState): Promise<void> {
    const eventBus = getEventBus();
    const abortController = new AbortController();
    this.abortControllers.set(asset.id, abortController);

    const targetDir = path.join(this.dataDir, asset.extractionConfig.targetDir);
    fs.mkdirSync(targetDir, { recursive: true });

    try {
      const totalFiles = asset.files.length;
      let completedFiles = 0;

      for (const file of asset.files) {
        if (abortController.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const destPath = path.join(targetDir, file.filename);

        // Skip if file already exists
        if (fs.existsSync(destPath)) {
          completedFiles++;
          continue;
        }

        log.info(`Downloading ${file.filename} for ${asset.label}`);
        const response = await fetch(file.url, {
          signal: abortController.signal,
          redirect: 'follow',
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} downloading ${file.filename}: ${response.statusText}`);
        }
        if (!response.body) {
          throw new Error(`No response body for ${file.filename}`);
        }

        const writeStream = createWriteStream(destPath);
        const { Readable } = await import('node:stream');
        const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
        await pipeline(nodeStream, writeStream);

        completedFiles++;
        state.percent = Math.round((completedFiles / totalFiles) * 99);
        state.bytesDownloaded = Math.round((completedFiles / totalFiles) * asset.estimatedBytes);

        eventBus.emit('download:progress', {
          assetId: asset.id,
          label: asset.label,
          category: asset.category,
          bytesDownloaded: state.bytesDownloaded,
          totalBytes: asset.estimatedBytes,
          percent: state.percent,
          phase: 'downloading',
        });
      }

      log.info(`All ${totalFiles} files downloaded for ${asset.label}`);
    } finally {
      this.abortControllers.delete(asset.id);
    }
  }

  /** Download and extract a tar.bz2 archive. */
  private async downloadAndExtractArchive(asset: AssetDefinition, state: DownloadState): Promise<void> {
    const eventBus = getEventBus();
    const abortController = new AbortController();
    this.abortControllers.set(asset.id, abortController);

    const tempFile = path.join(this.dataDir, `.download-${asset.id}.tmp`);
    const targetDir = path.join(this.dataDir, asset.extractionConfig.targetDir);

    try {
      // Download to temp file with progress tracking
      const url = 'url' in asset ? asset.url : '';
      log.info(`Downloading ${asset.label} from ${url}`);
      const response = await fetch(url, { signal: abortController.signal });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      if (!response.body) {
        throw new Error('No response body');
      }

      const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
      const totalBytes = contentLength || asset.estimatedBytes;
      state.totalBytes = totalBytes;

      // Stream to temp file with progress
      let lastProgressEmit = 0;
      let bytesDownloaded = 0;

      const progressTransform = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytesDownloaded += chunk.length;
          state.bytesDownloaded = bytesDownloaded;
          state.percent = totalBytes > 0 ? Math.min(99, Math.round((bytesDownloaded / totalBytes) * 100)) : 0;

          const now = Date.now();
          if (now - lastProgressEmit >= PROGRESS_THROTTLE_MS) {
            lastProgressEmit = now;
            eventBus.emit('download:progress', {
              assetId: asset.id,
              label: asset.label,
              category: asset.category,
              bytesDownloaded,
              totalBytes,
              percent: state.percent,
              phase: 'downloading',
            });
          }

          callback(null, chunk);
        },
      });

      const writeStream = createWriteStream(tempFile);

      // Convert web ReadableStream to Node Readable
      const { Readable } = await import('node:stream');
      const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);

      await pipeline(nodeStream, progressTransform, writeStream);

      // Final progress emit
      eventBus.emit('download:progress', {
        assetId: asset.id,
        label: asset.label,
        category: asset.category,
        bytesDownloaded,
        totalBytes,
        percent: 99,
        phase: 'downloading',
      });

      // Extract
      state.phase = 'extracting';
      eventBus.emit('download:progress', {
        assetId: asset.id,
        label: asset.label,
        category: asset.category,
        bytesDownloaded,
        totalBytes,
        percent: 99,
        phase: 'extracting',
      });

      log.info(`Extracting ${asset.label} to ${targetDir}`);
      fs.mkdirSync(targetDir, { recursive: true });

      const stripComponents = 'stripComponents' in asset.extractionConfig
        ? asset.extractionConfig.stripComponents
        : 0;
      await this.extractTarBz2(tempFile, targetDir, stripComponents);

      log.info(`Extraction complete: ${asset.label}`);
    } finally {
      this.abortControllers.delete(asset.id);
      // Clean up temp file
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private async extractTarBz2(
    archivePath: string,
    targetDir: string,
    stripComponents: number,
  ): Promise<void> {
    const { extract } = await import('tar');
    const unbzip2 = require('unbzip2-stream') as () => import('stream').Transform;

    const bzStream = unbzip2();
    const tarExtract = extract({
      cwd: targetDir,
      strip: stripComponents,
    });

    const readStream = fs.createReadStream(archivePath);
    await pipeline(readStream, bzStream, tarExtract as unknown as Writable);
  }
}
