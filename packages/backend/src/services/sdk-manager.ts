/**
 * SDK Manager -- thin wrapper around @animus-labs/agents SdkManager.
 *
 * Bridges the agents SdkManager's onProgress callback to the backend
 * event bus for real-time tRPC subscription delivery.
 */

import { join } from 'node:path';
import { createSdkManager, type SdkManager, type SdkInstallStatus } from '@animus-labs/agents';
import { createLogger } from '../lib/logger.js';
import { DATA_DIR } from '../utils/env.js';
import { getEventBus } from '../lib/event-bus.js';

export type { SdkInstallStatus };

const log = createLogger('SdkManager', 'server');

// Singleton
let instance: SdkManager | null = null;

export function getSdkManager(): SdkManager {
  if (!instance) {
    instance = createSdkManager({
      sdksDir: join(DATA_DIR, 'sdks'),
      logger: log,
      onProgress: (progress) => {
        const payload: { sdk: string; phase: typeof progress.phase; message: string; error?: string } = {
          sdk: progress.sdk,
          phase: progress.phase,
          message: progress.message,
        };
        if (progress.error !== undefined) {
          payload.error = progress.error;
        }
        getEventBus().emit('sdk:install_progress', payload);
      },
    });
  }
  return instance;
}
