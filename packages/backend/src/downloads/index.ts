/**
 * Downloads — barrel export + singleton access.
 */

export { ASSET_REGISTRY, getSpeechAssets, getAssetsByCategory } from './asset-registry.js';
export type { AssetDefinition } from './asset-registry.js';
export { DownloadManager } from './download-manager.js';
export type { DownloadState, DownloadPhase } from './download-manager.js';

import { DownloadManager } from './download-manager.js';

let instance: DownloadManager | null = null;

export function initDownloadManager(dataDir: string): DownloadManager {
  if (instance) return instance;
  instance = new DownloadManager(dataDir);
  return instance;
}

export function getDownloadManager(): DownloadManager {
  if (!instance) {
    throw new Error('DownloadManager not initialized. Call initDownloadManager() first.');
  }
  return instance;
}

/** Reset singleton (for testing). */
export function _resetDownloadManager(): void {
  instance = null;
}
