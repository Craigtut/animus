/**
 * VoiceManager -- manages voice entries (built-in and custom).
 *
 * Built-in voices come from the Pocket TTS model's test_wavs/ directory.
 * Custom voices are user-uploaded WAV files stored in data/voices/custom/.
 * A JSON manifest at data/voices/voices.json tracks all available voices.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readWavSamples } from './audio-utils.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('VoiceManager', 'speech');

export interface VoiceEntry {
  id: string;
  name: string;
  type: 'builtin' | 'custom';
  filePath: string;
  description?: string;
  addedAt: string;
}

interface VoiceManifest {
  voices: VoiceEntry[];
}

/** Scan WAV files from test_wavs/ directory dynamically. */
function discoverBuiltinVoiceNames(testWavsDir: string): string[] {
  if (!fs.existsSync(testWavsDir)) return [];
  return fs.readdirSync(testWavsDir)
    .filter((f) => f.endsWith('.wav'))
    .map((f) => f.replace(/\.wav$/, ''));
}

export class VoiceManager {
  private voicesDir: string;
  private modelsDir: string;
  private manifest: VoiceManifest = { voices: [] };
  private manifestPath: string;

  constructor(voicesDir: string, modelsDir: string) {
    this.voicesDir = voicesDir;
    this.modelsDir = modelsDir;
    this.manifestPath = path.join(voicesDir, 'voices.json');
  }

  /** Initialize: scan built-in voices, load manifest. */
  async initialize(): Promise<void> {
    // Ensure directory structure exists
    fs.mkdirSync(path.join(this.voicesDir, 'builtin'), { recursive: true });
    fs.mkdirSync(path.join(this.voicesDir, 'custom'), { recursive: true });

    // Load existing manifest if present
    if (fs.existsSync(this.manifestPath)) {
      try {
        const raw = fs.readFileSync(this.manifestPath, 'utf-8');
        this.manifest = JSON.parse(raw);
      } catch (err) {
        log.warn('Failed to parse voice manifest, starting fresh:', err);
        this.manifest = { voices: [] };
      }
    }

    // Scan for built-in voices from model download
    await this.scanBuiltinVoices();

    // Save manifest
    this.saveManifest();

    log.debug(`Voice manager initialized: ${this.manifest.voices.length} voices available`);
  }

  /** Scan the TTS model's test_wavs/ directory for built-in voice references. */
  private async scanBuiltinVoices(): Promise<void> {
    const testWavsDir = path.join(this.modelsDir, 'tts', 'test_wavs');
    const voiceNames = discoverBuiltinVoiceNames(testWavsDir);
    if (voiceNames.length === 0) {
      log.debug('No test_wavs directory or WAV files found, skipping built-in voice scan');
      return;
    }

    const existingBuiltinIds = new Set(
      this.manifest.voices.filter((v) => v.type === 'builtin').map((v) => v.id)
    );

    for (const name of voiceNames) {
      if (existingBuiltinIds.has(name)) continue;

      const wavPath = path.join(testWavsDir, `${name}.wav`);

      // Copy to voices/builtin/ directory
      const destPath = path.join(this.voicesDir, 'builtin', `${name}.wav`);
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(wavPath, destPath);
      }

      this.manifest.voices.push({
        id: name,
        name: name.charAt(0).toUpperCase() + name.slice(1),
        type: 'builtin',
        filePath: `builtin/${name}.wav`,
        description: `Built-in Pocket TTS voice`,
        addedAt: new Date().toISOString(),
      });

      log.debug(`Registered built-in voice: ${name}`);
    }
  }

  /** Get all available voices. */
  listVoices(): VoiceEntry[] {
    return [...this.manifest.voices];
  }

  /** Get a specific voice by ID. */
  getVoice(id: string): VoiceEntry | null {
    return this.manifest.voices.find((v) => v.id === id) ?? null;
  }

  /** Load voice reference audio samples (parsed PCM). */
  async loadVoiceSamples(id: string): Promise<{ samples: Float32Array; sampleRate: number }> {
    const voice = this.getVoice(id);
    if (!voice) {
      throw new Error(`Voice not found: ${id}`);
    }

    const fullPath = path.join(this.voicesDir, voice.filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Voice file missing: ${fullPath}`);
    }

    return readWavSamples(fullPath);
  }

  /** Load voice reference audio as raw WAV bytes (for native TTS). */
  async loadVoiceWavBuffer(id: string): Promise<Buffer> {
    const voice = this.getVoice(id);
    if (!voice) {
      throw new Error(`Voice not found: ${id}`);
    }

    const fullPath = path.join(this.voicesDir, voice.filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Voice file missing: ${fullPath}`);
    }

    return fs.readFileSync(fullPath);
  }

  /** Add a custom voice from a WAV buffer. */
  async addCustomVoice(name: string, wavBuffer: Buffer, description?: string): Promise<VoiceEntry> {
    const id = randomUUID();
    const filePath = `custom/${id}.wav`;
    const fullPath = path.join(this.voicesDir, filePath);

    // Write WAV file
    fs.writeFileSync(fullPath, wavBuffer);

    const entry: VoiceEntry = {
      id,
      name,
      type: 'custom',
      filePath,
      description,
      addedAt: new Date().toISOString(),
    };

    this.manifest.voices.push(entry);
    this.saveManifest();

    log.info(`Added custom voice: ${name} (${id})`);
    return entry;
  }

  /** Remove a custom voice. */
  async removeCustomVoice(id: string): Promise<void> {
    const idx = this.manifest.voices.findIndex((v) => v.id === id && v.type === 'custom');
    if (idx === -1) {
      throw new Error(`Custom voice not found: ${id}`);
    }

    const voice = this.manifest.voices[idx]!;
    const fullPath = path.join(this.voicesDir, voice.filePath);

    // Delete WAV file
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    this.manifest.voices.splice(idx, 1);
    this.saveManifest();

    log.info(`Removed custom voice: ${voice.name} (${id})`);
  }

  /** Persist the manifest to disk. */
  private saveManifest(): void {
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }
}
