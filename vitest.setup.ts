/**
 * Vitest global setup — graceful handling of platform-specific native modules.
 *
 * npm only resolves optional native binaries for the host platform in the lockfile.
 * When CI runs on Linux but the lockfile was generated on macOS, native modules
 * like @lancedb/lancedb will fail to load. This setup file provides stubs so
 * tests that don't directly use these modules can still run.
 *
 * Tests that need real native modules belong in integration test directories
 * (excluded from CI via vitest.config.ts).
 */

import { vi } from 'vitest';

// Probe whether LanceDB native binary is available
let lancedbAvailable = true;
try {
  await import('@lancedb/lancedb');
} catch {
  lancedbAvailable = false;
}

if (!lancedbAvailable) {
  vi.mock('@lancedb/lancedb', () => ({
    connect: vi.fn().mockRejectedValue(new Error('LanceDB native binary not available in this environment')),
  }));
}
