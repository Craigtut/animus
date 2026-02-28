/**
 * Settings Service - business logic for system and personality settings.
 *
 * Encapsulates settings updates, log category management, and side effects
 * (event emission, cache updates).
 * The router layer handles auth and input validation; this layer owns the logic.
 */

import { createLogger } from '../lib/logger.js';
import { getSystemDb, getPersonaDb } from '../db/index.js';
import * as systemStore from '../db/stores/system-store.js';
import * as personaStore from '../db/stores/persona-store.js';
import { updateCategoryCache } from '../lib/logger.js';
import { getEventBus } from '../lib/event-bus.js';
import type { SystemSettings, PersonalitySettings } from '@animus-labs/shared';

const log = createLogger('SettingsService', 'server');

// ============================================================================
// Service
// ============================================================================

class SettingsService {
  /**
   * Get current system settings.
   */
  getSystemSettings(): SystemSettings {
    return systemStore.getSystemSettings(getSystemDb());
  }

  /**
   * Update system settings. Strips undefined values and emits event if changed.
   */
  updateSystemSettings(input: Record<string, unknown>): SystemSettings {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) clean[k] = v;
    }
    systemStore.updateSystemSettings(getSystemDb(), clean as Partial<SystemSettings>);
    if (Object.keys(clean).length > 0) {
      getEventBus().emit('system:settings_updated', clean);
    }
    return systemStore.getSystemSettings(getSystemDb());
  }

  /**
   * Get current personality settings.
   */
  getPersonalitySettings(): PersonalitySettings {
    return personaStore.getPersonalitySettings(getPersonaDb());
  }

  /**
   * Update personality settings. Strips undefined values.
   */
  updatePersonalitySettings(input: Record<string, unknown>): PersonalitySettings {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) clean[k] = v;
    }
    personaStore.updatePersonalitySettings(getPersonaDb(), clean as Partial<PersonalitySettings>);
    return personaStore.getPersonalitySettings(getPersonaDb());
  }

  /**
   * Get log categories.
   */
  getLogCategories(): Record<string, boolean> {
    return systemStore.getLogCategories(getSystemDb());
  }

  /**
   * Update log categories and refresh the runtime cache.
   */
  updateLogCategories(input: Record<string, boolean>): Record<string, boolean> {
    const updated = systemStore.updateLogCategories(getSystemDb(), input);
    updateCategoryCache(updated);
    return updated;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SettingsService | null = null;

export function getSettingsService(): SettingsService {
  if (!instance) instance = new SettingsService();
  return instance;
}

export function resetSettingsService(): void {
  instance = null;
}
