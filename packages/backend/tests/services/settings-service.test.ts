/**
 * Tests for SettingsService — business logic for system and personality settings.
 *
 * Verifies:
 * - System settings read/update with undefined stripping
 * - Event emission on actual changes (and no emission when all undefined)
 * - Personality settings read/update with undefined stripping
 * - Log category read/update with cache refresh
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSystemDb, createTestPersonaDb } from '../helpers.js';

// ============================================================================
// Mocks
// ============================================================================

let mockSysDb: Database.Database;
let mockPersonaDb: Database.Database;
const mockEmit = vi.fn();

vi.mock('../../src/db/index.js', () => ({
  getSystemDb: () => mockSysDb,
  getPersonaDb: () => mockPersonaDb,
}));

vi.mock('../../src/lib/event-bus.js', () => ({
  getEventBus: () => ({
    emit: mockEmit,
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  updateCategoryCache: vi.fn(),
}));

// Import after mocks are registered
const { getSettingsService, resetSettingsService } = await import(
  '../../src/services/settings-service.js'
);
const { updateCategoryCache } = await import('../../src/lib/logger.js');

// ============================================================================
// Test suite
// ============================================================================

describe('SettingsService', () => {
  beforeEach(() => {
    mockSysDb = createTestSystemDb();
    mockPersonaDb = createTestPersonaDb();
    resetSettingsService();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // System Settings
  // ==========================================================================

  describe('getSystemSettings', () => {
    it('returns settings from the system store', () => {
      const svc = getSettingsService();
      const settings = svc.getSystemSettings();

      expect(settings).toBeDefined();
      expect(settings.heartbeatIntervalMs).toBe(300000);
      expect(settings.defaultAgentProvider).toBe('claude');
    });
  });

  describe('updateSystemSettings', () => {
    it('strips undefined values before persisting', () => {
      const svc = getSettingsService();
      svc.updateSystemSettings({
        heartbeatIntervalMs: 60000,
        defaultModel: undefined,
      });

      const settings = svc.getSystemSettings();
      expect(settings.heartbeatIntervalMs).toBe(60000);
      // defaultAgentProvider should remain at its default, not be wiped
      expect(settings.defaultAgentProvider).toBe('claude');
    });

    it('emits system:settings_updated event when changes exist', () => {
      const svc = getSettingsService();
      svc.updateSystemSettings({ heartbeatIntervalMs: 120000 });

      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith('system:settings_updated', {
        heartbeatIntervalMs: 120000,
      });
    });

    it('does not emit event when input is all undefined', () => {
      const svc = getSettingsService();
      svc.updateSystemSettings({
        heartbeatIntervalMs: undefined,
        defaultModel: undefined,
      });

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('returns the updated settings', () => {
      const svc = getSettingsService();
      const result = svc.updateSystemSettings({ heartbeatIntervalMs: 90000 });

      expect(result.heartbeatIntervalMs).toBe(90000);
    });
  });

  // ==========================================================================
  // Personality Settings
  // ==========================================================================

  describe('getPersonalitySettings', () => {
    it('returns settings from the persona store', () => {
      const svc = getSettingsService();
      const settings = svc.getPersonalitySettings();

      expect(settings).toBeDefined();
      expect(settings.name).toBe('Animus');
      expect(settings.traits).toEqual([]);
    });
  });

  describe('updatePersonalitySettings', () => {
    it('strips undefined values before persisting', () => {
      const svc = getSettingsService();
      svc.updatePersonalitySettings({
        name: 'Nova',
        traits: undefined,
      });

      const settings = svc.getPersonalitySettings();
      expect(settings.name).toBe('Nova');
      // traits should remain at default, not be wiped
      expect(settings.traits).toEqual([]);
    });

    it('returns updated personality settings', () => {
      const svc = getSettingsService();
      const result = svc.updatePersonalitySettings({
        name: 'Atlas',
        traits: ['curious', 'empathetic'],
      });

      expect(result.name).toBe('Atlas');
      expect(result.traits).toEqual(['curious', 'empathetic']);
    });
  });

  // ==========================================================================
  // Log Categories
  // ==========================================================================

  describe('getLogCategories', () => {
    it('returns categories from the system store', () => {
      const svc = getSettingsService();
      const categories = svc.getLogCategories();

      expect(categories).toBeDefined();
      expect(typeof categories).toBe('object');
    });
  });

  describe('updateLogCategories', () => {
    it('calls updateCategoryCache with the result', () => {
      const svc = getSettingsService();
      const result = svc.updateLogCategories({ heartbeat: true, server: false });

      expect(updateCategoryCache).toHaveBeenCalledTimes(1);
      expect(updateCategoryCache).toHaveBeenCalledWith(result);
    });

    it('returns the merged categories', () => {
      const svc = getSettingsService();
      svc.updateLogCategories({ heartbeat: true });
      const result = svc.updateLogCategories({ server: false });

      expect(result).toEqual(
        expect.objectContaining({ heartbeat: true, server: false })
      );
    });
  });
});
