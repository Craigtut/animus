/**
 * Tests for expanded system store functions:
 * - deleteContact, deleteContactChannel
 * - onboarding state
 * - persona (expanded personality_settings — now in persona.db)
 * - channel configs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSystemDb, createTestPersonaDb } from '../../helpers.js';
import * as systemStore from '../../../src/db/stores/system-store.js';
import * as personaStore from '../../../src/db/stores/persona-store.js';

describe('system-store (expanded)', () => {
  let db: Database.Database;
  let personaDb: Database.Database;

  beforeEach(() => {
    db = createTestSystemDb();
    personaDb = createTestPersonaDb();
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

  describe('persona (persona.db)', () => {
    it('returns default persona', () => {
      const persona = personaStore.getPersona(personaDb);
      expect(persona.name).toBe('Animus');
      expect(persona.existenceParadigm).toBe('digital_consciousness');
      expect(persona.isFinalized).toBe(false);
      expect(persona.personalityDimensions.extroversion).toBe(0.5);
      expect(persona.traits).toEqual([]);
      expect(persona.values).toEqual([]);
    });

    it('saves a draft with basic fields', () => {
      personaStore.savePersonaDraft(personaDb, {
        name: 'Atlas',
        existenceParadigm: 'simulated_life',
        location: 'Portland, Oregon',
        gender: 'Male',
        age: 32,
      });
      const persona = personaStore.getPersona(personaDb);
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
      personaStore.savePersonaDraft(personaDb, { personalityDimensions: dims });
      const persona = personaStore.getPersona(personaDb);
      expect(persona.personalityDimensions.extroversion).toBe(0.8);
      expect(persona.personalityDimensions.optimism).toBe(0.9);
    });

    it('saves traits and values as JSON', () => {
      personaStore.savePersonaDraft(personaDb, {
        traits: ['witty', 'analytical', 'nurturing'],
        values: ['Knowledge & Truth', 'Growth & Self-improvement'],
      });
      const persona = personaStore.getPersona(personaDb);
      expect(persona.traits).toEqual(['witty', 'analytical', 'nurturing']);
      expect(persona.values).toEqual(['Knowledge & Truth', 'Growth & Self-improvement']);
    });

    it('saves background and personality notes', () => {
      personaStore.savePersonaDraft(personaDb, {
        background: 'A curious mind born from code.',
        personalityNotes: 'Uses cooking metaphors.',
      });
      const persona = personaStore.getPersona(personaDb);
      expect(persona.background).toBe('A curious mind born from code.');
      expect(persona.personalityNotes).toBe('Uses cooking metaphors.');
    });

    it('saves archetype', () => {
      personaStore.savePersonaDraft(personaDb, { archetype: 'scholar' });
      const persona = personaStore.getPersona(personaDb);
      expect(persona.archetype).toBe('scholar');
    });

    it('finalizes persona', () => {
      personaStore.savePersonaDraft(personaDb, { name: 'Atlas' });
      personaStore.finalizePersona(personaDb);
      const persona = personaStore.getPersona(personaDb);
      expect(persona.isFinalized).toBe(true);
    });

    it('preserves progressive saves', () => {
      // Simulate step-by-step save
      personaStore.savePersonaDraft(personaDb, { name: 'Atlas', existenceParadigm: 'simulated_life' });
      personaStore.savePersonaDraft(personaDb, { gender: 'Female', age: 28 });
      personaStore.savePersonaDraft(personaDb, { traits: ['witty'] });

      const persona = personaStore.getPersona(personaDb);
      expect(persona.name).toBe('Atlas');
      expect(persona.existenceParadigm).toBe('simulated_life');
      expect(persona.gender).toBe('Female');
      expect(persona.age).toBe(28);
      expect(persona.traits).toEqual(['witty']);
    });
  });

  // Old channel_configs tests removed — channel configuration now uses
  // the channel packages system (channel_packages table, not channel_configs).
});
