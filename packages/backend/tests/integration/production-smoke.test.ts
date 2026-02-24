/**
 * Production Smoke Test
 *
 * Spawns the backend in production mode and verifies basic functionality.
 * Requires `npm run build:prod` to have been run first (builds shared, agents,
 * frontend, and backend — including copying frontend dist into dist/public/).
 *
 * Run with: npm run test:smoke
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(__dirname, '..', '..');
const BACKEND_DIST = join(BACKEND_ROOT, 'dist', 'index.js');
const STARTUP_TIMEOUT = 30_000; // 30s for migrations + embedding model init
const REQUEST_TIMEOUT = 5_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timeout')), REQUEST_TIMEOUT);
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode!, body });
        });
      })
      .on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpGet(`http://127.0.0.1:${port}/api/health`);
      if (res.status === 200) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server failed to become healthy within ${timeoutMs}ms`);
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error('Could not determine port'));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Production Smoke Test', () => {
  let proc: ChildProcess | null = null;
  let port: number;
  let tmpDir: string;
  let baseUrl: string;

  beforeAll(async () => {
    // Check that dist exists
    if (!existsSync(BACKEND_DIST)) {
      throw new Error(
        'Backend dist not found. Run `npm run build:prod` first.\n' +
          `Expected: ${BACKEND_DIST}`
      );
    }

    // Create temp data directory for isolated DB files
    tmpDir = mkdtempSync(join(tmpdir(), 'animus-smoke-'));
    port = await findFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    // Spawn backend in production mode
    proc = spawn('node', [BACKEND_DIST], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        HOST: '127.0.0.1',
        ANIMUS_DATA_DIR: tmpDir,
        ANIMUS_ENCRYPTION_KEY: 'smoke-test-encryption-key-000000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Collect stdout/stderr for debugging on failure
    let stderr = '';
    let stdout = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on('error', (err) => {
      throw new Error(`Failed to spawn backend: ${err.message}`);
    });

    // Wait for server to be healthy
    try {
      await waitForHealth(port, STARTUP_TIMEOUT);
    } catch (err) {
      console.error('--- Server stdout ---');
      console.error(stdout);
      console.error('--- Server stderr ---');
      console.error(stderr);
      throw err;
    }
  }, STARTUP_TIMEOUT + 5_000);

  afterAll(async () => {
    if (proc && !proc.killed) {
      // Graceful shutdown via SIGTERM (server listens for this)
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const forceKill = setTimeout(() => {
          proc?.kill('SIGKILL');
          resolve();
        }, 5_000);
        proc!.on('exit', () => {
          clearTimeout(forceKill);
          resolve();
        });
      });
    }

    // Clean up temp directory
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }
  });

  // -------------------------------------------------------------------------
  // Fastify health route
  // -------------------------------------------------------------------------

  it('GET /api/health returns 200 with correct shape', async () => {
    const res = await httpGet(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);

    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('status', 'ok');
    expect(body).toHaveProperty('timestamp');
    expect(typeof body.timestamp).toBe('string');
  });

  // -------------------------------------------------------------------------
  // tRPC health procedure
  // -------------------------------------------------------------------------

  it('tRPC health procedure is accessible and returns data', async () => {
    const res = await httpGet(`${baseUrl}/api/trpc/health`);
    expect(res.status).toBe(200);

    // tRPC wraps query responses: { result: { data: { ... } } }
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('result');
    expect(body.result).toHaveProperty('data');
    expect(body.result.data).toHaveProperty('status', 'ok');
    expect(body.result.data).toHaveProperty('timestamp');
  });

  // -------------------------------------------------------------------------
  // Static file serving (frontend SPA)
  // -------------------------------------------------------------------------

  it('serves frontend index.html at root', async () => {
    const frontendPublic = join(BACKEND_ROOT, 'dist', 'public', 'index.html');
    if (!existsSync(frontendPublic)) {
      // Frontend was not built — skip gracefully
      console.warn(
        'Skipping static file test: dist/public/index.html not found. ' +
          'Run `npm run build:prod` to include frontend.'
      );
      return;
    }

    const res = await httpGet(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('</html>');
  });

  // -------------------------------------------------------------------------
  // SPA fallback for client-side routes
  // -------------------------------------------------------------------------

  it('SPA fallback serves index.html for unknown non-API paths', async () => {
    const frontendPublic = join(BACKEND_ROOT, 'dist', 'public', 'index.html');
    if (!existsSync(frontendPublic)) {
      console.warn('Skipping SPA fallback test: frontend not built.');
      return;
    }

    const res = await httpGet(`${baseUrl}/mind`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('</html>');
  });

  // -------------------------------------------------------------------------
  // 404 for unknown API routes
  // -------------------------------------------------------------------------

  it('returns 404 for unknown /api/ routes', async () => {
    const res = await httpGet(`${baseUrl}/api/nonexistent`);
    expect(res.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Protected tRPC endpoints reject unauthenticated requests
  // -------------------------------------------------------------------------

  it('protected tRPC endpoints return UNAUTHORIZED without token', async () => {
    // settings.getSystemSettings is a protected procedure
    const res = await httpGet(`${baseUrl}/api/trpc/settings.getSystemSettings`);
    expect(res.status).toBe(401);
  });
});
