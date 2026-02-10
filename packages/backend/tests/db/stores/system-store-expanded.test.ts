/**
 * Tests for expanded system store functions:
 * - deleteContact, deleteContactChannel
 * - onboarding state
 * - persona (expanded personality_settings)
 * - channel configs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSystemDb } from '../../helpers.js';
import * as systemStore from '../../../src/db/stores/system-store.js';

describe('system-store (expanded)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestSystemDb();
  });

  // ========================================================================
  // Delete Contact
  // ========================================================================

  describe('deleteContact', () => {
    it('deletes an existing contact', () => {
      const contact = systemStore.createContact(db, { fullName: 'To Delete' });
      const result = systemStore.deleteContact(db, contact.id);
      expect(result).toBe(true);
      expect(systemStore.getContact(db, contact.id)).toBeNull();
    });

    it('returns false for nonexistent contact', () => {
      const result = systemStore.deleteContact(db, 'nonexistent-id');
      expect(result).toBe(false);
    });

    it('cascades to contact_channels', () => {
      const contact = systemStore.createContact(db, { fullName: 'Test' });
      systemStore.createContactChannel(db, {
        contactId: contact.id,
        channel: 'sms',
        identifier: '+15551234567',
      });
      systemStore.deleteContact(db, contact.id);
      const channels = systemStore.getContactChannelsByContactId(db, contact.id);
      expect(channels).toHaveLength(0);
    });
  });

  // ========================================================================
  // Delete Contact Channel
  // ========================================================================

  describe('deleteContactChannel', () => {
    it('deletes an existing channel', () => {
      const contact = systemStore.createContact(db, { fullName: 'Test' });
      const channel = systemStore.createContactChannel(db, {
        contactId: contact.id,
        channel: 'sms',
        identifier: '+15551234567',
      });
      const result = systemStore.deleteContactChannel(db, channel.id);
      expect(result).toBe(true);
    });

    it('returns false for nonexistent channel', () => {
      const result = systemStore.deleteContactChannel(db, 'nonexistent-id');
      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // Onboarding State
  // ========================================================================

  describe('onboarding state', () => {
    it('returns default onboarding state', () => {
      const state = systemStore.getOnboardingState(db);
      expect(state.currentStep).toBe(0);
      expect(state.isComplete).toBe(false);
    });

    it('updates onboarding step', () => {
      systemStore.updateOnboardingState(db, { currentStep: 3 });
      const state = systemStore.getOnboardingState(db);
      expect(state.currentStep).toBe(3);
      expect(state.isComplete).toBe(false);
    });

    it('marks onboarding complete', () => {
      systemStore.updateOnboardingState(db, { isComplete: true, currentStep: 8 });
      const state = systemStore.getOnboardingState(db);
      expect(state.currentStep).toBe(8);
      expect(state.isComplete).toBe(true);
    });

    it('handles partial updates', () => {
      systemStore.updateOnboardingState(db, { currentStep: 5 });
      systemStore.updateOnboardingState(db, { isComplete: true });
      const state = systemStore.getOnboardingState(db);
      expect(state.currentStep).toBe(5);
      expect(state.isComplete).toBe(true);
    });
  });

  // ========================================================================
  // Persona (expanded personality_settings)
  // ========================================================================

  describe('persona', () => {
    it('returns default persona', () => {
      const persona = systemStore.getPersona(db);
      expect(persona.name).toBe('Animus');
      expect(persona.existenceParadigm).toBe('digital_consciousness');
      expect(persona.isFinalized).toBe(false);
      expect(persona.personalityDimensions.extroversion).toBe(0.5);
      expect(persona.traits).toEqual([]);
      expect(persona.values).toEqual([]);
    });

    it('saves a draft with basic fields', () => {
      systemStore.savePersonaDraft(db, {
        name: 'Atlas',
        existenceParadigm: 'simulated_life',
        location: 'Portland, Oregon',
        gender: 'Male',
        age: 32,
      });
      const persona = systemStore.getPersona(db);
      expect(persona.name).toBe('Atlas');
      expect(persona.existenceParadigm).toBe('simulated_life');
      expect(persona.location).toBe('Portland, Oregon');
      expect(persona.gender).toBe('Male');
      expect(persona.age).toBe(32);
    });

    it('saves personality dimensions', () => {
      const dims = {
        extroversion: 0.8,
        trust: 0.6,
        leadership: 0.7,
        optimism: 0.9,
        confidence: 0.85,
        empathy: 0.7,
        cautious: 0.3,
        patience: 0.5,
        orderly: 0.4,
        altruism: 0.65,
      };
      systemStore.savePersonaDraft(db, { personalityDimensions: dims });
      const persona = systemStore.getPersona(db);
      expect(persona.personalityDimensions.extroversion).toBe(0.8);
      expect(persona.personalityDimensions.optimism).toBe(0.9);
    });

    it('saves traits and values as JSON', () => {
      systemStore.savePersonaDraft(db, {
        traits: ['witty', 'analytical', 'nurturing'],
        values: ['Knowledge & Truth', 'Growth & Self-improvement'],
      });
      const persona = systemStore.getPersona(db);
      expect(persona.traits).toEqual(['witty', 'analytical', 'nurturing']);
      expect(persona.values).toEqual(['Knowledge & Truth', 'Growth & Self-improvement']);
    });

    it('saves background and personality notes', () => {
      systemStore.savePersonaDraft(db, {
        background: 'A curious mind born from code.',
        personalityNotes: 'Uses cooking metaphors.',
      });
      const persona = systemStore.getPersona(db);
      expect(persona.background).toBe('A curious mind born from code.');
      expect(persona.personalityNotes).toBe('Uses cooking metaphors.');
    });

    it('saves archetype', () => {
      systemStore.savePersonaDraft(db, { archetype: 'scholar' });
      const persona = systemStore.getPersona(db);
      expect(persona.archetype).toBe('scholar');
    });

    it('finalizes persona', () => {
      systemStore.savePersonaDraft(db, { name: 'Atlas' });
      systemStore.finalizePersona(db);
      const persona = systemStore.getPersona(db);
      expect(persona.isFinalized).toBe(true);
    });

    it('preserves progressive saves', () => {
      // Simulate step-by-step save
      systemStore.savePersonaDraft(db, { name: 'Atlas', existenceParadigm: 'simulated_life' });
      systemStore.savePersonaDraft(db, { gender: 'Female', age: 28 });
      systemStore.savePersonaDraft(db, { traits: ['witty'] });

      const persona = systemStore.getPersona(db);
      expect(persona.name).toBe('Atlas');
      expect(persona.existenceParadigm).toBe('simulated_life');
      expect(persona.gender).toBe('Female');
      expect(persona.age).toBe(28);
      expect(persona.traits).toEqual(['witty']);
    });
  });

  // ========================================================================
  // Channel Configs
  // ========================================================================

  describe('channel configs', () => {
    it('returns empty list initially', () => {
      const configs = systemStore.getChannelConfigs(db);
      expect(configs).toHaveLength(0);
    });

    it('creates a new channel config', () => {
      const config = systemStore.upsertChannelConfig(db, {
        channelType: 'sms',
        config: JSON.stringify({ accountSid: 'AC123', authToken: 'token', phoneNumber: '+1234', webhookUrl: 'https://example.com/webhook' }),
        isEnabled: true,
      });
      expect(config.channelType).toBe('sms');
      expect(config.isEnabled).toBe(true);
    });

    it('updates existing channel config', () => {
      systemStore.upsertChannelConfig(db, {
        channelType: 'discord',
        config: JSON.stringify({ botToken: 'old-token', applicationId: 'app-id' }),
        isEnabled: false,
      });

      const updated = systemStore.upsertChannelConfig(db, {
        channelType: 'discord',
        config: JSON.stringify({ botToken: 'new-token', applicationId: 'app-id' }),
        isEnabled: true,
      });

      expect(updated.isEnabled).toBe(true);
    });

    it('lists all configs', () => {
      systemStore.upsertChannelConfig(db, {
        channelType: 'sms',
        config: '{}',
      });
      systemStore.upsertChannelConfig(db, {
        channelType: 'discord',
        config: '{}',
      });
      const configs = systemStore.getChannelConfigs(db);
      expect(configs).toHaveLength(2);
    });

    it('gets a specific channel config with config data', () => {
      const configData = JSON.stringify({ botToken: 'tok', applicationId: 'app' });
      systemStore.upsertChannelConfig(db, {
        channelType: 'discord',
        config: configData,
      });
      const result = systemStore.getChannelConfig(db, 'discord');
      expect(result).not.toBeNull();
      expect(result!.config).toBe(configData);
    });

    it('returns null for unconfigured channel', () => {
      const result = systemStore.getChannelConfig(db, 'sms');
      expect(result).toBeNull();
    });
  });
});
