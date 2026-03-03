import { describe, it, expect } from 'vitest';
import { isBlockedPath, isBlockedCommand } from '../file-deny-list.js';

describe('File Deny List', () => {
  describe('isBlockedPath', () => {
    it('blocks vault.json', () => {
      expect(isBlockedPath('/app/data/vault.json')).toBe(true);
      expect(isBlockedPath('data/vault.json')).toBe(true);
      expect(isBlockedPath('./vault.json')).toBe(true);
    });

    it('blocks .secrets file', () => {
      expect(isBlockedPath('/app/data/.secrets')).toBe(true);
      expect(isBlockedPath('data/.secrets')).toBe(true);
    });

    it('blocks .secrets.migrated file', () => {
      expect(isBlockedPath('/app/data/.secrets.migrated')).toBe(true);
    });

    it('blocks jwt.key file', () => {
      expect(isBlockedPath('/app/data/jwt.key')).toBe(true);
      expect(isBlockedPath('data/jwt.key')).toBe(true);
    });

    it('blocks .env files', () => {
      expect(isBlockedPath('/project/.env')).toBe(true);
      expect(isBlockedPath('.env')).toBe(true);
      expect(isBlockedPath('/project/.env.local')).toBe(true);
      expect(isBlockedPath('/project/.env.production')).toBe(true);
    });

    it('blocks security-critical source files', () => {
      expect(isBlockedPath('/src/lib/encryption-service.ts')).toBe(true);
      expect(isBlockedPath('/src/lib/encryption-service.js')).toBe(true);
      expect(isBlockedPath('/src/lib/vault-manager.ts')).toBe(true);
      expect(isBlockedPath('/src/lib/vault-manager.js')).toBe(true);
      expect(isBlockedPath('/src/lib/vault-migration.ts')).toBe(true);
      expect(isBlockedPath('/src/lib/secrets-manager.ts')).toBe(true);
      expect(isBlockedPath('/src/lib/jwt-key.ts')).toBe(true);
      expect(isBlockedPath('/src/lib/file-deny-list.ts')).toBe(true);
    });

    it('allows normal source files', () => {
      expect(isBlockedPath('/src/lib/logger.ts')).toBe(false);
      expect(isBlockedPath('/src/index.ts')).toBe(false);
      expect(isBlockedPath('/src/heartbeat/index.ts')).toBe(false);
    });

    it('allows normal data files', () => {
      expect(isBlockedPath('/data/databases/system.db')).toBe(false);
      expect(isBlockedPath('/data/logs/animus.log')).toBe(false);
    });

    it('allows files with similar but not matching names', () => {
      expect(isBlockedPath('/src/my-vault-manager-notes.md')).toBe(false);
      expect(isBlockedPath('/docs/vault.json.example')).toBe(false);
    });
  });

  describe('isBlockedCommand', () => {
    it('blocks macOS keychain commands', () => {
      expect(isBlockedCommand('security find-generic-password -a animus')).toBe(true);
      expect(isBlockedCommand('security find-internet-password -s example.com')).toBe(true);
    });

    it('blocks Linux keyring commands', () => {
      expect(isBlockedCommand('secret-tool lookup service animus')).toBe(true);
      expect(isBlockedCommand('secret-tool search service animus')).toBe(true);
    });

    it('blocks cat of blocked files', () => {
      expect(isBlockedCommand('cat vault.json')).toBe(true);
      expect(isBlockedCommand('cat data/.secrets')).toBe(true);
      expect(isBlockedCommand('cat data/jwt.key')).toBe(true);
      expect(isBlockedCommand('cat .env')).toBe(true);
    });

    it('allows normal bash operations', () => {
      expect(isBlockedCommand('ls -la')).toBe(false);
      expect(isBlockedCommand('npm run test')).toBe(false);
      expect(isBlockedCommand('git status')).toBe(false);
      expect(isBlockedCommand('cat package.json')).toBe(false);
    });
  });
});
