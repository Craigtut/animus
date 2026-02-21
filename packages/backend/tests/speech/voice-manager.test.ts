import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { VoiceManager } from '../../src/speech/voice-manager.js';
import { pcmToWav } from '../../src/speech/audio-utils.js';

/** Create a minimal valid WAV buffer for testing. */
function createTestWav(sampleRate = 16000, numSamples = 100): Buffer {
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  return pcmToWav(samples, sampleRate);
}

describe('VoiceManager', () => {
  let tmpDir: string;
  let voicesDir: string;
  let modelsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animus-test-'));
    voicesDir = path.join(tmpDir, 'voices');
    modelsDir = path.join(tmpDir, 'models');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ============================================================================
  // initialize
  // ============================================================================

  describe('initialize', () => {
    it('creates directory structure', async () => {
      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();

      expect(fs.existsSync(path.join(voicesDir, 'builtin'))).toBe(true);
      expect(fs.existsSync(path.join(voicesDir, 'custom'))).toBe(true);
      expect(fs.existsSync(path.join(voicesDir, 'voices.json'))).toBe(true);
    });

    it('scans built-in voices from test_wavs', async () => {
      // Create test_wavs directory with a built-in voice
      const testWavsDir = path.join(modelsDir, 'tts', 'test_wavs');
      fs.mkdirSync(testWavsDir, { recursive: true });
      fs.writeFileSync(path.join(testWavsDir, 'alba.wav'), createTestWav());

      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();

      const voices = vm.listVoices();
      expect(voices.length).toBe(1);
      expect(voices[0]!.id).toBe('alba');
      expect(voices[0]!.name).toBe('Alba');
      expect(voices[0]!.type).toBe('builtin');

      // Verify WAV was copied to builtin dir
      expect(fs.existsSync(path.join(voicesDir, 'builtin', 'alba.wav'))).toBe(true);
    });

    it('does not duplicate built-in voices on re-initialize', async () => {
      const testWavsDir = path.join(modelsDir, 'tts', 'test_wavs');
      fs.mkdirSync(testWavsDir, { recursive: true });
      fs.writeFileSync(path.join(testWavsDir, 'alba.wav'), createTestWav());

      const vm1 = new VoiceManager(voicesDir, modelsDir);
      await vm1.initialize();
      expect(vm1.listVoices().length).toBe(1);

      // Re-initialize from the saved manifest
      const vm2 = new VoiceManager(voicesDir, modelsDir);
      await vm2.initialize();
      expect(vm2.listVoices().length).toBe(1);
    });

    it('recovers from corrupted manifest', async () => {
      fs.mkdirSync(voicesDir, { recursive: true });
      fs.writeFileSync(path.join(voicesDir, 'voices.json'), 'not valid json');

      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();

      // Should start fresh
      expect(vm.listVoices().length).toBe(0);
    });
  });

  // ============================================================================
  // listVoices
  // ============================================================================

  describe('listVoices', () => {
    it('returns empty array when no voices exist', async () => {
      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();
      expect(vm.listVoices()).toEqual([]);
    });

    it('returns a copy (not the internal array)', async () => {
      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();
      const list1 = vm.listVoices();
      const list2 = vm.listVoices();
      expect(list1).not.toBe(list2);
    });
  });

  // ============================================================================
  // getVoice
  // ============================================================================

  describe('getVoice', () => {
    it('returns null for unknown voice', async () => {
      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();
      expect(vm.getVoice('nonexistent')).toBeNull();
    });

    it('returns voice entry for known voice', async () => {
      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();

      const wavBuf = createTestWav();
      const entry = await vm.addCustomVoice('Test Voice', wavBuf, 'A test voice');

      const found = vm.getVoice(entry.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Test Voice');
      expect(found!.type).toBe('custom');
    });
  });

  // ============================================================================
  // addCustomVoice
  // ============================================================================

  describe('addCustomVoice', () => {
    it('creates file and manifest entry', async () => {
      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();

      const wavBuf = createTestWav();
      const entry = await vm.addCustomVoice('My Voice', wavBuf, 'Custom voice');

      expect(entry.name).toBe('My Voice');
      expect(entry.type).toBe('custom');
      expect(entry.description).toBe('Custom voice');
      expect(entry.id).toBeTruthy();

      // WAV file should exist
      const fullPath = path.join(voicesDir, entry.filePath);
      expect(fs.existsSync(fullPath)).toBe(true);

      // Should be in the manifest
      const manifest = JSON.parse(fs.readFileSync(path.join(voicesDir, 'voices.json'), 'utf-8'));
      expect(manifest.voices.find((v: any) => v.id === entry.id)).toBeTruthy();
    });

    it('appears in listVoices after adding', async () => {
      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();

      const wavBuf = createTestWav();
      await vm.addCustomVoice('Voice A', wavBuf);

      expect(vm.listVoices().length).toBe(1);
      expect(vm.listVoices()[0]!.name).toBe('Voice A');
    });
  });

  // ============================================================================
  // removeCustomVoice
  // ============================================================================

  describe('removeCustomVoice', () => {
    it('cleans up file and manifest entry', async () => {
      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();

      const wavBuf = createTestWav();
      const entry = await vm.addCustomVoice('To Remove', wavBuf);
      const fullPath = path.join(voicesDir, entry.filePath);
      expect(fs.existsSync(fullPath)).toBe(true);

      await vm.removeCustomVoice(entry.id);

      expect(fs.existsSync(fullPath)).toBe(false);
      expect(vm.getVoice(entry.id)).toBeNull();
      expect(vm.listVoices().length).toBe(0);
    });

    it('throws for unknown voice ID', async () => {
      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();
      await expect(vm.removeCustomVoice('nonexistent')).rejects.toThrow('Custom voice not found');
    });

    it('throws when trying to remove a built-in voice', async () => {
      const testWavsDir = path.join(modelsDir, 'tts', 'test_wavs');
      fs.mkdirSync(testWavsDir, { recursive: true });
      fs.writeFileSync(path.join(testWavsDir, 'alba.wav'), createTestWav());

      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();

      await expect(vm.removeCustomVoice('alba')).rejects.toThrow('Custom voice not found');
    });
  });

  // ============================================================================
  // loadVoiceSamples
  // ============================================================================

  describe('loadVoiceSamples', () => {
    it('throws for missing voice ID', async () => {
      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();
      await expect(vm.loadVoiceSamples('nonexistent')).rejects.toThrow('Voice not found');
    });

    it('throws when voice file is missing from disk', async () => {
      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();

      const wavBuf = createTestWav();
      const entry = await vm.addCustomVoice('Orphaned', wavBuf);

      // Delete the file manually
      fs.unlinkSync(path.join(voicesDir, entry.filePath));

      await expect(vm.loadVoiceSamples(entry.id)).rejects.toThrow('Voice file missing');
    });

    it('returns samples and sampleRate for valid voice', async () => {
      const vm = new VoiceManager(voicesDir, modelsDir);
      await vm.initialize();

      const wavBuf = createTestWav(16000, 50);
      const entry = await vm.addCustomVoice('Valid', wavBuf);

      const result = await vm.loadVoiceSamples(entry.id);
      expect(result.samples).toBeInstanceOf(Float32Array);
      expect(result.samples.length).toBe(50);
      expect(result.sampleRate).toBe(16000);
    });
  });
});
