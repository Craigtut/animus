/**
 * SpeechService -- facade over STT, TTS, and VoiceManager.
 *
 * Singleton via getSpeechService() / initSpeechService().
 * Engines lazy-load models on first use -- the service object exists from
 * startup but model weights are only loaded when needed.
 */

import path from 'node:path';
import { STTEngine } from './stt-engine.js';
import { TTSEngine, type TTSEngineConfig } from './tts-engine.js';
import { VoiceManager } from './voice-manager.js';
import { checkFfmpeg } from './audio-utils.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('SpeechService', 'speech');

export interface SpeechServiceConfig {
  dataDir: string;         // e.g. './data'
  defaultSpeed?: number;
}

export interface SpeechStatus {
  sttAvailable: boolean;
  ttsAvailable: boolean;
  ffmpegAvailable: boolean;
  voiceCount: number;
}

export class SpeechService {
  readonly stt: STTEngine;
  readonly tts: TTSEngine;
  readonly voices: VoiceManager;
  private _ffmpegAvailable = false;

  /** Set after async ffmpeg check during init. */
  set ffmpegAvailable(value: boolean) { this._ffmpegAvailable = value; }

  constructor(config: SpeechServiceConfig) {
    const modelsPath = path.join(config.dataDir, 'models');
    const voicesDir = path.join(config.dataDir, 'voices');

    this.voices = new VoiceManager(voicesDir, modelsPath);
    this.stt = new STTEngine(modelsPath);

    const ttsConfig: TTSEngineConfig = {
      modelsPath,
      defaultSpeed: config.defaultSpeed ?? 1.0,
    };
    this.tts = new TTSEngine(ttsConfig, this.voices);
  }

  /** Get current availability status (no model loading). */
  getStatus(): SpeechStatus {
    return {
      sttAvailable: this.stt.isAvailable(),
      ttsAvailable: this.tts.isAvailable(),
      ffmpegAvailable: this._ffmpegAvailable,
      voiceCount: this.voices.listVoices().length,
    };
  }

  /** Shutdown and release all resources. */
  async shutdown(): Promise<void> {
    log.info('Shutting down speech service...');
    this.stt.dispose();
    this.tts.dispose();
    log.info('Speech service shutdown complete');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SpeechService | null = null;

export function getSpeechService(): SpeechService {
  if (!instance) {
    throw new Error('Speech service not initialized. Call initSpeechService() first.');
  }
  return instance;
}

export async function initSpeechService(config: SpeechServiceConfig): Promise<SpeechService> {
  if (instance) {
    log.warn('Speech service already initialized, returning existing instance');
    return instance;
  }

  instance = new SpeechService(config);
  await instance.voices.initialize();

  // Check ffmpeg availability (needed for audio format conversion)
  const ffmpegOk = await checkFfmpeg();
  instance.ffmpegAvailable = ffmpegOk;
  if (!ffmpegOk) {
    log.warn('ffmpeg not found: audio format conversion (WebM to PCM, WAV to OGG) will not work');
  }

  const status = instance.getStatus();
  log.info(`Speech service initialized: STT ${status.sttAvailable ? 'ready' : 'unavailable'}, TTS ${status.ttsAvailable ? 'ready' : 'unavailable'}, ffmpeg ${ffmpegOk ? 'yes' : 'no'}, voices ${status.voiceCount}`);

  return instance;
}

/** Reset singleton (for testing). */
export function _resetSpeechService(): void {
  instance = null;
}
