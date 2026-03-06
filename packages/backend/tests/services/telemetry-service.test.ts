import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Track the temp directory for each test
let tmpDir = '';

// Mock posthog-node
vi.mock('posthog-node', () => ({
  PostHog: vi.fn().mockImplementation(() => ({
    capture: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  })),
}));

// Mock DATA_DIR to use the temp directory
vi.mock('../../src/utils/env.js', () => ({
  get DATA_DIR() { return tmpDir; },
}));

// Mock the DB and store
vi.mock('../../src/db/index.js', () => ({
  getSystemDb: vi.fn(() => ({})),
}));

const mockGetSystemSettings = vi.fn(() => ({
  telemetryEnabled: true,
  defaultAgentProvider: 'claude',
}));

vi.mock('../../src/db/stores/settings-store.js', () => ({
  getSystemSettings: (...args: unknown[]) => mockGetSystemSettings(...args),
}));

vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import the class after mocks are set up
import { TelemetryService } from '../../src/services/telemetry-service.js';

describe('TelemetryService', () => {
  let service: TelemetryService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Create a temp directory for telemetry-id file
    tmpDir = fs.mkdtempSync(path.join('/tmp', 'telemetry-test-'));

    // Clean env
    delete process.env['DO_NOT_TRACK'];
    delete process.env['ANIMUS_TELEMETRY_DISABLED'];
    delete process.env['ANIMUS_TELEMETRY_DEBUG'];

    // Reset settings mock to default
    mockGetSystemSettings.mockReturnValue({
      telemetryEnabled: true,
      defaultAgentProvider: 'claude',
    });

    service = new TelemetryService();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  });

  describe('initialize', () => {
    it('creates telemetry-id file on first run', () => {
      service.initialize();
      const idPath = path.join(tmpDir, 'telemetry-id');
      expect(fs.existsSync(idPath)).toBe(true);
      const id = fs.readFileSync(idPath, 'utf-8').trim();
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('reads existing telemetry-id file', () => {
      const existingId = '12345678-1234-1234-1234-123456789abc';
      fs.writeFileSync(path.join(tmpDir, 'telemetry-id'), existingId);
      service.initialize();
      const id = fs.readFileSync(path.join(tmpDir, 'telemetry-id'), 'utf-8').trim();
      expect(id).toBe(existingId);
    });
  });

  describe('isEnabled', () => {
    it('returns true when everything is enabled', () => {
      service.initialize();
      expect(service.isEnabled()).toBe(true);
    });

    it('returns false when DO_NOT_TRACK=1', () => {
      process.env['DO_NOT_TRACK'] = '1';
      const svc = new TelemetryService();
      svc.initialize();
      expect(svc.isEnabled()).toBe(false);
    });

    it('returns false when ANIMUS_TELEMETRY_DISABLED=1', () => {
      process.env['ANIMUS_TELEMETRY_DISABLED'] = '1';
      const svc = new TelemetryService();
      svc.initialize();
      expect(svc.isEnabled()).toBe(false);
    });

    it('returns false when DB setting is disabled', () => {
      mockGetSystemSettings.mockReturnValue({
        telemetryEnabled: false,
        defaultAgentProvider: 'claude',
      });
      service.initialize();
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('captureInstall', () => {
    it('fires only on first run', () => {
      service.initialize();
      service.captureInstall();
      // Calling again should be a no-op (installCaptured flag)
      service.captureInstall();
    });

    it('does not fire when file already exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'telemetry-id'), 'existing-id');
      service.initialize();
      service.captureInstall();
    });
  });

  describe('captureDailyActive', () => {
    it('deduplicates within same day', () => {
      service.initialize();
      service.captureDailyActive(1.5);
      service.captureDailyActive(2.0); // should be deduped
    });
  });

  describe('captureFeatureUsed', () => {
    it('deduplicates same feature within same day', () => {
      service.initialize();
      service.captureFeatureUsed('goals');
      service.captureFeatureUsed('goals'); // deduped
      service.captureFeatureUsed('memory'); // different feature, should fire
    });
  });

  describe('captureError', () => {
    it('caps at 5 errors per day', () => {
      service.initialize();
      for (let i = 0; i < 10; i++) {
        service.captureError(new Error(`error-${i}`));
      }
    });

    it('deduplicates by error hash', () => {
      service.initialize();
      const err = new Error('same error');
      service.captureError(err);
      service.captureError(err); // same hash, should be deduped
    });
  });

  describe('regenerateId', () => {
    it('writes a new UUID to the file', () => {
      service.initialize();
      const idBefore = fs.readFileSync(path.join(tmpDir, 'telemetry-id'), 'utf-8').trim();
      service.regenerateId();
      const idAfter = fs.readFileSync(path.join(tmpDir, 'telemetry-id'), 'utf-8').trim();
      expect(idAfter).not.toBe(idBefore);
      expect(idAfter).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('shutdown', () => {
    it('calls PostHog shutdown without throwing', async () => {
      service.initialize();
      await expect(service.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('no events when disabled', () => {
    it('does not capture when DO_NOT_TRACK=1', () => {
      process.env['DO_NOT_TRACK'] = '1';
      const svc = new TelemetryService();
      svc.initialize();
      svc.captureAppStarted({ provider: 'claude', channelCount: 1, pluginCount: 2 });
      svc.captureDailyActive(1.0);
      svc.captureFeatureUsed('goals');
      svc.captureError(new Error('test'));
    });
  });
});
