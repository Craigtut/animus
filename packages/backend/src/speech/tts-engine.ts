/**
 * TTSEngine -- lazy-loaded native Pocket TTS via @animus/tts-native (napi-rs).
 *
 * Uses zero-shot voice cloning from reference audio (WAV files).
 * Model files expected at {modelsPath}/tts/:
 *   b6369a24.yaml, tts_b6369a24.safetensors, tokenizer.model
 *   test_wavs/ (built-in reference voices)
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../lib/logger.js';
import { pcmToWav } from './audio-utils.js';
import type { VoiceManager } from './voice-manager.js';

const log = createLogger('TTSEngine', 'speech');

export interface TTSResult {
  samples: Float32Array;
  sampleRate: number;
  wavBuffer: Buffer;
}

export interface TTSSynthesisOptions {
  speed?: number;
  voiceId?: string;
}

export interface TTSEngineConfig {
  modelsPath: string;
  defaultSpeed: number;
}

// Re-exported from @animus/tts-native — opaque handle
type NativeVoiceState = import('@animus/tts-native').VoiceState;
type NativePocketTTS = import('@animus/tts-native').PocketTTS;

export class TTSEngine {
  private config: TTSEngineConfig;
  private voiceManager: VoiceManager;
  private tts: NativePocketTTS | null = null;
  private loaded = false;
  private cachedVoice: { id: string; state: NativeVoiceState } | null = null;

  constructor(config: TTSEngineConfig, voiceManager: VoiceManager) {
    this.config = config;
    this.voiceManager = voiceManager;
  }

  /** Check if TTS model files exist (no model load). */
  isAvailable(): boolean {
    const ttsDir = path.join(this.config.modelsPath, 'tts');
    return (
      fs.existsSync(path.join(ttsDir, 'tts_b6369a24.safetensors')) &&
      fs.existsSync(path.join(ttsDir, 'tokenizer.model'))
    );
  }

  /** Lazy-load the native Pocket TTS model. */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    if (!this.isAvailable()) {
      throw new Error('TTS model files not found. Download Pocket TTS to data/models/tts/');
    }

    const ttsDir = path.join(this.config.modelsPath, 'tts');
    log.info('Loading TTS model (native Pocket TTS)...');

    let PocketTTS: typeof import('@animus/tts-native').PocketTTS;
    try {
      ({ PocketTTS } = await import('@animus/tts-native'));
    } catch (err) {
      throw new Error(
        'Native TTS addon not built. Run: npm run build -w @animus/tts-native (requires Rust toolchain)',
      );
    }

    this.tts = await PocketTTS.load(ttsDir);
    this.loaded = true;
    log.info('TTS model loaded successfully');
  }

  /** Load voice state from WAV bytes (with caching by voice ID). */
  private async loadVoice(voiceId: string): Promise<NativeVoiceState> {
    if (this.cachedVoice?.id === voiceId) {
      return this.cachedVoice.state;
    }

    const wavBuffer = await this.voiceManager.loadVoiceWavBuffer(voiceId);
    const state = await this.tts!.createVoiceState(Buffer.from(wavBuffer));
    this.cachedVoice = { id: voiceId, state };
    log.debug(`Loaded voice state: ${voiceId}`);
    return state;
  }

  /** Get the default voice from the first available voice entry. */
  private async getDefaultVoice(): Promise<NativeVoiceState> {
    const voices = this.voiceManager.listVoices();
    const defaultVoice = voices.length > 0 ? voices[0]! : null;

    if (defaultVoice) {
      return this.loadVoice(defaultVoice.id);
    }

    throw new Error('No voices available. Ensure model files are downloaded.');
  }

  /** Synthesize text to audio. */
  async synthesize(text: string, options?: TTSSynthesisOptions): Promise<TTSResult> {
    await this.ensureLoaded();

    const voiceState = options?.voiceId
      ? await this.loadVoice(options.voiceId)
      : await this.getDefaultVoice();

    const samples = await this.tts!.generate(text, voiceState);
    const sampleRate = this.tts!.sampleRate;
    const wavBuffer = pcmToWav(samples, sampleRate);

    log.debug(`Synthesized ${text.length} chars -> ${samples.length} samples`);

    return { samples, sampleRate, wavBuffer };
  }

  /** Update the cached default voice (called when persona voice changes). */
  async setDefaultVoice(voiceId: string): Promise<void> {
    if (this.loaded) {
      await this.loadVoice(voiceId);
    }
    log.info(`Default voice set to: ${voiceId}`);
  }

  /** Release resources. */
  dispose(): void {
    this.tts = null;
    this.loaded = false;
    this.cachedVoice = null;
    log.info('TTS engine disposed');
  }
}
