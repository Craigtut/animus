/**
 * TTSEngine -- lazy-loaded sherpa-onnx OfflineTts (Pocket TTS).
 *
 * Uses zero-shot voice cloning from reference audio.
 * Model files expected at {modelsPath}/tts/:
 *   lm_flow.int8.onnx, lm_main.int8.onnx, encoder.onnx,
 *   decoder.int8.onnx, text_conditioner.onnx, vocab.json, token_scores.json
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
  numSteps?: number;
}

export interface TTSEngineConfig {
  modelsPath: string;
  defaultSpeed: number;
}

export class TTSEngine {
  private config: TTSEngineConfig;
  private voiceManager: VoiceManager;
  private tts: any = null;
  private loaded = false;
  private cachedVoice: { id: string; samples: Float32Array; sampleRate: number } | null = null;

  constructor(config: TTSEngineConfig, voiceManager: VoiceManager) {
    this.config = config;
    this.voiceManager = voiceManager;
  }

  /** Check if TTS model files exist (no model load). */
  isAvailable(): boolean {
    const ttsDir = path.join(this.config.modelsPath, 'tts');
    return (
      fs.existsSync(path.join(ttsDir, 'lm_flow.int8.onnx')) &&
      fs.existsSync(path.join(ttsDir, 'lm_main.int8.onnx')) &&
      fs.existsSync(path.join(ttsDir, 'encoder.onnx')) &&
      fs.existsSync(path.join(ttsDir, 'decoder.int8.onnx')) &&
      fs.existsSync(path.join(ttsDir, 'text_conditioner.onnx'))
    );
  }

  /** Lazy-load the sherpa-onnx TTS. */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    if (!this.isAvailable()) {
      throw new Error('TTS model files not found. Download Pocket TTS to data/models/tts/');
    }

    const ttsDir = path.join(this.config.modelsPath, 'tts');
    log.info('Loading TTS model (Pocket TTS)...');

    const sherpa = await import('sherpa-onnx-node');

    const config = new sherpa.OfflineTtsConfig({
      model: new sherpa.OfflineTtsModelConfig({
        kokoro: new sherpa.OfflineTtsKokoroModelConfig({
          model: path.join(ttsDir, 'lm_main.int8.onnx'),
          voices: path.join(ttsDir, 'vocab.json'),
          tokens: path.join(ttsDir, 'token_scores.json'),
          dataDir: ttsDir,
        }),
      }),
      maxNumSentences: 1,
      numThreads: 2,
    });

    this.tts = new sherpa.OfflineTts(config);
    this.loaded = true;
    log.info('TTS model loaded successfully');
  }

  /** Load voice reference samples (with caching). */
  private async loadVoice(voiceId: string): Promise<{ samples: Float32Array; sampleRate: number }> {
    if (this.cachedVoice && this.cachedVoice.id === voiceId) {
      return this.cachedVoice;
    }

    const voiceSamples = await this.voiceManager.loadVoiceSamples(voiceId);
    this.cachedVoice = { id: voiceId, ...voiceSamples };
    log.debug(`Loaded voice reference: ${voiceId}`);
    return voiceSamples;
  }

  /** Get the default voice from the persona or fall back to first available. */
  private async getDefaultVoice(): Promise<{ samples: Float32Array; sampleRate: number }> {
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

    const voiceRef = options?.voiceId
      ? await this.loadVoice(options.voiceId)
      : await this.getDefaultVoice();

    const sherpa = await import('sherpa-onnx-node');

    const generationConfig = new sherpa.GenerationConfig({
      speed: options?.speed ?? this.config.defaultSpeed,
      referenceAudio: voiceRef.samples,
      referenceSampleRate: voiceRef.sampleRate,
      numSteps: options?.numSteps ?? 5,
      extra: { max_reference_audio_len: 12 },
    });

    const audio = this.tts.generate({ text, generationConfig });
    const wavBuffer = pcmToWav(audio.samples, audio.sampleRate);

    log.debug(`Synthesized ${text.length} chars -> ${audio.samples.length} samples`);

    return {
      samples: audio.samples,
      sampleRate: audio.sampleRate,
      wavBuffer,
    };
  }

  /** Update the cached default voice (called when persona voice changes). */
  async setDefaultVoice(voiceId: string): Promise<void> {
    await this.loadVoice(voiceId);
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
