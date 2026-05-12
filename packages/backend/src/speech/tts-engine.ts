/**
 * TTSEngine -- lazy-loaded native Pocket TTS via @animus-labs/tts-native (napi-rs).
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

// Pocket TTS garbles the first syllable due to FlowLM/Mimi cold start.
// Workaround: prepend a sacrificial prefix, then trim it from the output
// by scanning for the silence gap between the prefix and real content.
const SACRIFICIAL_PREFIX = '... ';
const PREFIX_MIN_SAMPLES = 0.15 * 24000; // don't search before 150ms
const PREFIX_MAX_SAMPLES = 1.0 * 24000;  // stop searching after 1s
const SILENCE_THRESHOLD = 0.015;         // amplitude below this = silence
const SILENCE_GAP_SAMPLES = 0.06 * 24000; // 60ms of consecutive silence = gap found

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

// Re-exported from @animus-labs/tts-native — opaque handle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NativeVoiceState = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NativePocketTTS = any;

function concatFloat32Arrays(arrays: Float32Array[]): Float32Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const result = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/**
 * Find the end of the sacrificial prefix by scanning for a silence gap.
 * Returns the sample index where the real content begins, or 0 if no gap found.
 */
function findPrefixEnd(samples: Float32Array): number {
  let silenceRun = 0;
  const start = Math.min(Math.floor(PREFIX_MIN_SAMPLES), samples.length);
  const end = Math.min(Math.floor(PREFIX_MAX_SAMPLES), samples.length);

  for (let i = start; i < end; i++) {
    if (Math.abs(samples[i]!) < SILENCE_THRESHOLD) {
      silenceRun++;
      if (silenceRun >= SILENCE_GAP_SAMPLES) {
        return i + 1;
      }
    } else {
      silenceRun = 0;
    }
  }
  return 0;
}

export class TTSEngine {
  private config: TTSEngineConfig;
  private voiceManager: VoiceManager;
  private tts: NativePocketTTS | null = null;
  private loaded = false;
  private cachedVoice: { id: string; state: NativeVoiceState } | null = null;
  private _getConfiguredVoiceId: (() => string | null) | null = null;

  constructor(config: TTSEngineConfig, voiceManager: VoiceManager) {
    this.config = config;
    this.voiceManager = voiceManager;
  }

  setVoiceIdProvider(fn: () => string | null): void {
    this._getConfiguredVoiceId = fn;
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let PocketTTS: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // @ts-expect-error -- @animus-labs/tts-native has no type declarations until native build
      ({ PocketTTS } = await import('@animus-labs/tts-native') as any);
    } catch (err) {
      throw new Error(
        'Native TTS addon not built. Run: npm run build -w @animus-labs/tts-native (requires Rust toolchain)',
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

  private async getDefaultVoice(): Promise<NativeVoiceState> {
    const configuredId = this._getConfiguredVoiceId?.() ?? null;
    if (configuredId) {
      return this.loadVoice(configuredId);
    }

    const voices = this.voiceManager.listVoices();
    if (voices.length > 0) {
      return this.loadVoice(voices[0]!.id);
    }

    throw new Error('No voices available. Ensure model files are downloaded.');
  }

  /** Synthesize text to audio. */
  async synthesize(text: string, options?: TTSSynthesisOptions): Promise<TTSResult> {
    await this.ensureLoaded();

    const voiceState = options?.voiceId
      ? await this.loadVoice(options.voiceId)
      : await this.getDefaultVoice();

    const rawSamples = await this.tts!.generate(SACRIFICIAL_PREFIX + text, voiceState);
    const trimStart = findPrefixEnd(rawSamples);
    const samples = trimStart > 0 ? rawSamples.slice(trimStart) : rawSamples;

    const sampleRate = this.tts!.sampleRate;
    const wavBuffer = pcmToWav(samples, sampleRate);

    if (trimStart > 0) {
      log.debug(`Trimmed ${trimStart} prefix samples (${(trimStart / sampleRate * 1000).toFixed(0)}ms)`);
    }
    log.debug(`Synthesized ${text.length} chars -> ${samples.length} samples`);

    return { samples, sampleRate, wavBuffer };
  }

  /** Streaming synthesis — yields Float32Array chunks as they are generated. */
  async *synthesizeStream(text: string, options?: TTSSynthesisOptions): AsyncGenerator<Float32Array> {
    await this.ensureLoaded();

    const voiceState = options?.voiceId
      ? await this.loadVoice(options.voiceId)
      : await this.getDefaultVoice();

    // Check if the native addon supports streaming callback
    if (typeof this.tts!.generateStreamCb !== 'function') {
      const rawSamples = await this.tts!.generate(SACRIFICIAL_PREFIX + text, voiceState);
      const trimStart = findPrefixEnd(rawSamples);
      yield trimStart > 0 ? rawSamples.slice(trimStart) : rawSamples;
      return;
    }

    // Bridge callback-based API to async generator using a queue
    type QueueItem =
      | { type: 'chunk'; data: Float32Array }
      | { type: 'done' }
      | { type: 'error'; error: Error };

    const queue: QueueItem[] = [];
    let resolve: (() => void) | null = null;
    let finished = false;

    const push = (item: QueueItem) => {
      queue.push(item);
      if (resolve) {
        const r = resolve;
        resolve = null;
        r();
      }
    };

    const waitForItem = (): Promise<void> => {
      if (queue.length > 0) return Promise.resolve();
      return new Promise<void>((r) => { resolve = r; });
    };

    this.tts!.generateStreamCb(SACRIFICIAL_PREFIX + text, voiceState, (err: Error | null, chunk: Float32Array) => {
      if (err) {
        push({ type: 'error', error: err });
        return;
      }
      if (chunk.length === 0) {
        push({ type: 'done' });
        return;
      }
      push({ type: 'chunk', data: chunk });
    });

    // Buffer initial chunks until we've passed the prefix region,
    // then find the silence gap and start yielding from there.
    let prefixBuffer: Float32Array[] = [];
    let prefixSampleCount = 0;
    let prefixTrimmed = false;

    try {
      while (!finished) {
        await waitForItem();

        while (queue.length > 0) {
          const item = queue.shift()!;
          if (item.type === 'done') {
            // Flush any remaining buffered chunks (prefix gap not found)
            if (!prefixTrimmed && prefixBuffer.length > 0) {
              const combined = concatFloat32Arrays(prefixBuffer);
              const trimStart = findPrefixEnd(combined);
              if (trimStart > 0) {
                yield combined.slice(trimStart);
              } else {
                yield combined;
              }
            }
            finished = true;
            break;
          } else if (item.type === 'error') {
            throw item.error;
          }

          if (prefixTrimmed) {
            yield item.data;
            continue;
          }

          // Still buffering for prefix detection
          prefixBuffer.push(item.data);
          prefixSampleCount += item.data.length;

          if (prefixSampleCount >= PREFIX_MAX_SAMPLES) {
            const combined = concatFloat32Arrays(prefixBuffer);
            const trimStart = findPrefixEnd(combined);
            if (trimStart > 0) {
              yield combined.slice(trimStart);
              log.debug(`Stream: trimmed ${trimStart} prefix samples`);
            } else {
              yield combined;
            }
            prefixBuffer = [];
            prefixTrimmed = true;
          }
        }
      }
    } finally {
      finished = true;
    }
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
