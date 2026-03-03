import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Must use vi.hoisted so the variable is available when vi.mock factories run.
// Cannot reference `path` or `os` imports inside vi.hoisted — they aren't initialized yet.
const { tmpDir } = vi.hoisted(() => {
  const nodePath = require('node:path');
  const nodeOs = require('node:os');
  const tmpDir = nodePath.join(nodeOs.tmpdir(), `vault-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return { tmpDir };
});

// Mock DATA_DIR to use a temp directory
vi.mock('../../utils/env.js', () => ({
  DATA_DIR: tmpDir,
}));

// Mock logger
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  loadVault,
  createVault,
  unseal,
  rewrapVault,
  getDek,
  isUnsealed,
  getSealState,
  setSealState,
  clearDek,
  scrubPasswordSources,
  hasLegacySecrets,
  resolveUnlockPassword,
  type VaultFile,
} from '../vault-manager.js';

describe('VaultManager', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    // Reset module state
    clearDek();
    setSealState('no-vault');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadVault', () => {
    it('returns null when vault.json does not exist', () => {
      expect(loadVault()).toBeNull();
    });

    it('returns parsed vault when vault.json exists', async () => {
      await createVault('testpassword');
      const vault = loadVault();
      expect(vault).not.toBeNull();
      expect(vault!.version).toBe(2);
      expect(vault!.kdf).toBe('argon2id');
      expect(vault!.kdfParams.memoryCost).toBe(65536);
      expect(vault!.wrappedDek).toBeTruthy();
      expect(vault!.sentinel).toBeTruthy();
    });

    it('returns null for invalid vault.json', () => {
      fs.writeFileSync(path.join(tmpDir, 'vault.json'), '{"bad": true}');
      expect(loadVault()).toBeNull();
    });
  });

  describe('createVault', () => {
    it('creates vault.json and returns DEK', async () => {
      const dek = await createVault('mypassword');
      expect(dek).toBeInstanceOf(Buffer);
      expect(dek.length).toBe(32);
      expect(isUnsealed()).toBe(true);
      expect(getSealState()).toBe('unsealed');

      // vault.json should exist
      const vaultPath = path.join(tmpDir, 'vault.json');
      expect(fs.existsSync(vaultPath)).toBe(true);

      // File permissions should be 0600
      const stat = fs.statSync(vaultPath);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('getDek returns the DEK after creation', async () => {
      const dek = await createVault('pass');
      expect(getDek()).toBe(dek);
    });
  });

  describe('unseal', () => {
    it('unseals with correct password', async () => {
      await createVault('correct-password');
      const vault = loadVault()!;

      // Seal the vault
      clearDek();
      setSealState('sealed');
      expect(isUnsealed()).toBe(false);

      // Unseal with correct password
      await unseal('correct-password', vault);
      expect(isUnsealed()).toBe(true);
      expect(getDek()).toBeInstanceOf(Buffer);
      expect(getDek().length).toBe(32);
    });

    it('throws on wrong password', async () => {
      await createVault('correct-password');
      const vault = loadVault()!;

      clearDek();
      setSealState('sealed');

      await expect(unseal('wrong-password', vault)).rejects.toThrow(/[Ww]rong password/);
      expect(isUnsealed()).toBe(false);
    });

    it('DEK matches original after unseal', async () => {
      const originalDek = Buffer.from(await createVault('thepassword')); // copy before clearDek zeros it
      const vault = loadVault()!;

      clearDek();
      setSealState('sealed');

      await unseal('thepassword', vault);
      expect(getDek().equals(originalDek)).toBe(true);
    });
  });

  describe('rewrapVault', () => {
    it('re-wraps DEK with new password', async () => {
      const originalDek = Buffer.from(await createVault('oldpass')); // copy before clearDek zeros it

      await rewrapVault('oldpass', 'newpass');

      // DEK should be unchanged
      expect(getDek().equals(originalDek)).toBe(true);

      // Should now unseal with new password
      const vault = loadVault()!;
      clearDek();
      setSealState('sealed');

      await unseal('newpass', vault);
      expect(getDek().equals(originalDek)).toBe(true);
    });

    it('throws on wrong current password', async () => {
      await createVault('realpass');
      await expect(rewrapVault('wrongpass', 'newpass')).rejects.toThrow(/[Cc]urrent password/);
    });

    it('throws when sealed', async () => {
      clearDek();
      setSealState('sealed');
      await expect(rewrapVault('a', 'b')).rejects.toThrow(/sealed/);
    });
  });

  describe('getDek', () => {
    it('throws when sealed', () => {
      clearDek();
      expect(() => getDek()).toThrow(/sealed/);
    });
  });

  describe('clearDek', () => {
    it('wipes DEK from memory and sets sealed state', async () => {
      await createVault('pass');
      expect(isUnsealed()).toBe(true);

      clearDek();
      expect(isUnsealed()).toBe(false);
      expect(getSealState()).toBe('sealed');
      expect(() => getDek()).toThrow();
    });
  });

  describe('scrubPasswordSources', () => {
    it('deletes ANIMUS_UNLOCK_PASSWORD from process.env', () => {
      process.env['ANIMUS_UNLOCK_PASSWORD'] = 'secret';
      scrubPasswordSources();
      expect(process.env['ANIMUS_UNLOCK_PASSWORD']).toBeUndefined();
    });

    it('is a no-op when env var is not set', () => {
      delete process.env['ANIMUS_UNLOCK_PASSWORD'];
      scrubPasswordSources(); // should not throw
    });
  });

  describe('resolveUnlockPassword', () => {
    it('reads from ANIMUS_UNLOCK_PASSWORD env var', () => {
      process.env['ANIMUS_UNLOCK_PASSWORD'] = 'envpassword';
      expect(resolveUnlockPassword()).toBe('envpassword');
      delete process.env['ANIMUS_UNLOCK_PASSWORD'];
    });

    it('returns null when no password source is available', () => {
      delete process.env['ANIMUS_UNLOCK_PASSWORD'];
      expect(resolveUnlockPassword()).toBeNull();
    });
  });

  describe('hasLegacySecrets', () => {
    it('returns false when no .secrets file exists', () => {
      expect(hasLegacySecrets()).toBe(false);
    });

    it('returns true when .secrets file exists', () => {
      fs.writeFileSync(path.join(tmpDir, '.secrets'), '{}');
      expect(hasLegacySecrets()).toBe(true);
    });
  });

  describe('vault.json format', () => {
    it('has expected structure', async () => {
      await createVault('test');
      const raw = fs.readFileSync(path.join(tmpDir, 'vault.json'), 'utf-8');
      const vault = JSON.parse(raw) as VaultFile;

      expect(vault.version).toBe(2);
      expect(vault.kdf).toBe('argon2id');
      expect(vault.kdfParams).toEqual({
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
        salt: expect.any(String),
      });
      // Wrapped values should be in iv:ct:tag format
      expect(vault.wrappedDek.split(':')).toHaveLength(3);
      expect(vault.sentinel.split(':')).toHaveLength(3);
    });
  });
});
