import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mutable state the mocked env module reads via getters, so each fresh
// module import (after vi.resetModules) reflects the current test's setup.
const state = vi.hoisted(() => ({
  dataDir: '',
  jwtSecret: undefined as string | undefined,
}));

vi.mock('../../utils/env.js', () => ({
  get DATA_DIR() {
    return state.dataDir;
  },
  env: {
    get JWT_SECRET() {
      return state.jwtSecret;
    },
  },
}));

vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Re-import jwt-key with a clean module graph (resets the in-module
// `cachedSecret`) so each scenario behaves like a fresh process start.
async function freshModule() {
  vi.resetModules();
  return import('../jwt-key.js');
}

function keyPath() {
  return path.join(state.dataDir, 'jwt.key');
}

describe('jwt-key', () => {
  beforeEach(() => {
    state.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animus-jwt-'));
    state.jwtSecret = undefined;
  });

  afterEach(() => {
    fs.rmSync(state.dataDir, { recursive: true, force: true });
  });

  it('first run: resolveJwtSecret generates and persists data/jwt.key with 0600 perms', async () => {
    const { resolveJwtSecret } = await freshModule();

    const secret = resolveJwtSecret();

    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(keyPath())).toBe(true);
    expect(fs.readFileSync(keyPath(), 'utf-8')).toBe(secret);

    const mode = fs.statSync(keyPath()).mode;
    expect(mode & 0o600).toBe(0o600); // owner read+write
    expect(mode & 0o077).toBe(0); // no group/other access
  });

  it('persists across restarts: a fresh module returns the same stored secret', async () => {
    const first = await freshModule();
    const created = first.resolveJwtSecret();

    // Simulate a server restart: new module graph, same data dir.
    const second = await freshModule();
    expect(second.loadJwtSecret()).toBe(created);
    expect(second.resolveJwtSecret()).toBe(created);
    expect(fs.readFileSync(keyPath(), 'utf-8')).toBe(created);
  });

  it('createJwtSecret is idempotent: it never rotates an existing key', async () => {
    const { createJwtSecret, resolveJwtSecret } = await freshModule();

    const a = createJwtSecret();
    const b = createJwtSecret();
    expect(b).toBe(a);
    expect(resolveJwtSecret()).toBe(a);
    expect(fs.readFileSync(keyPath(), 'utf-8')).toBe(a);
  });

  it('legacy JWT_SECRET env: used as-is and never written to disk', async () => {
    state.jwtSecret = 'legacy-env-secret';
    const { resolveJwtSecret } = await freshModule();

    expect(resolveJwtSecret()).toBe('legacy-env-secret');
    expect(fs.existsSync(keyPath())).toBe(false);
  });

  it('persisted key wins over the legacy env var', async () => {
    const first = await freshModule();
    const fileSecret = first.resolveJwtSecret();

    state.jwtSecret = 'legacy-env-secret';
    const second = await freshModule();
    expect(second.resolveJwtSecret()).toBe(fileSecret);
  });

  it('regression: signing and WS-verify paths resolve to one shared secret on first run', async () => {
    // The bug: the auth plugin signed with a temp/env secret while the WS
    // verifier loaded the real key file, so first-run WS auth silently
    // failed. Both paths now call resolveJwtSecret; simulate them as two
    // independent module graphs over the same data dir.
    const authPluginPath = await freshModule();
    const signingSecret = authPluginPath.resolveJwtSecret();

    const wsVerifyPath = await freshModule();
    const verifySecret = wsVerifyPath.resolveJwtSecret();

    expect(verifySecret).toBe(signingSecret);
  });
});
