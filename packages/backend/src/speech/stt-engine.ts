/**
 * STTEngine -- lazy-loaded sherpa-onnx offline recognizer (Parakeet TDT v3).
 *
 * Model files are expected at {modelsPath}/stt/:
 *   encoder.int8.onnx, decoder.int8.onnx, joiner.int8.onnx, tokens.txt
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../lib/logger.js';

const log = createLogger('STTEngine', 'speech');

export class STTEngine {
  private modelsPath: string;
  private recognizer: any = null;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private transcribeQueue: Promise<void> = Promise.resolve();

  constructor(modelsPath: string) {
    this.modelsPath = modelsPath;
  }

  /** Check if STT model files exist (no model load). */
  isAvailable(): boolean {
    const sttDir = path.join(this.modelsPath, 'stt');
    return (
      fs.existsSync(path.join(sttDir, 'encoder.int8.onnx')) &&
      fs.existsSync(path.join(sttDir, 'decoder.int8.onnx')) &&
      fs.existsSync(path.join(sttDir, 'joiner.int8.onnx')) &&
      fs.existsSync(path.join(sttDir, 'tokens.txt'))
    );
  }

  /** Lazy-load the sherpa-onnx recognizer. */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }

    this.loadPromise = this.loadRecognizer().finally(() => {
      this.loadPromise = null;
    });

    await this.loadPromise;
  }

  private async loadRecognizer(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('STT model files not found. Download Parakeet TDT v3 to data/models/stt/');
    }

    const sttDir = path.join(this.modelsPath, 'stt');
    log.info('Loading STT model (Parakeet TDT v3)...');

    let sherpaModule;
    try {
      // @ts-expect-error -- sherpa-onnx-node has no type declarations
      sherpaModule = await import('sherpa-onnx-node');
    } catch (err) {
      throw new Error(
        'Native STT addon (sherpa-onnx-node) not available. Install sherpa-onnx-node for speech-to-text support.',
      );
    }
    const sherpa = sherpaModule.default;

    const config = {
      featConfig: {
        sampleRate: 16000,
        featureDim: 80,
      },
      modelConfig: {
        transducer: {
          encoder: path.join(sttDir, 'encoder.int8.onnx'),
          decoder: path.join(sttDir, 'decoder.int8.onnx'),
          joiner: path.join(sttDir, 'joiner.int8.onnx'),
        },
        tokens: path.join(sttDir, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
      },
    };

    this.recognizer = new sherpa.OfflineRecognizer(config);
    this.loaded = true;
    log.info('STT model loaded successfully');
  }

  /** Transcribe PCM audio to text. */
  async transcribe(pcmSamples: Float32Array, sampleRate: number): Promise<string> {
    const run = this.transcribeQueue.then(
      () => this.transcribeInternal(pcmSamples, sampleRate),
      () => this.transcribeInternal(pcmSamples, sampleRate),
    );
    this.transcribeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async transcribeInternal(pcmSamples: Float32Array, sampleRate: number): Promise<string> {
    const safeSamples = this.validateAndCopySamples(pcmSamples, sampleRate);

    await this.ensureLoaded();
    const stream = this.recognizer.createStream();
    stream.acceptWaveform({ sampleRate, samples: safeSamples });

    const result = await this.recognizer.decodeAsync(stream);
    const text = String(result.text ?? '').trim();
    log.debug(`Transcribed ${safeSamples.length} samples -> "${text.substring(0, 80)}..."`);
    return text;
  }

  private validateAndCopySamples(pcmSamples: Float32Array, sampleRate: number): Float32Array {
    if (!(pcmSamples instanceof Float32Array)) {
      throw new Error('STT input must be Float32 PCM samples');
    }

    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new Error(`Invalid STT sample rate: ${sampleRate}`);
    }

    if (pcmSamples.length === 0) {
      throw new Error('Audio contains no PCM samples');
    }

    const minSamples = Math.ceil(sampleRate * 0.1);
    if (pcmSamples.length < minSamples) {
      throw new Error('Audio is too short to transcribe');
    }

    const safeSamples = new Float32Array(pcmSamples.length);
    for (let i = 0; i < pcmSamples.length; i++) {
      const sample = pcmSamples[i]!;
      if (!Number.isFinite(sample)) {
        safeSamples[i] = 0;
      } else {
        safeSamples[i] = Math.max(-1, Math.min(1, sample));
      }
    }

    return safeSamples;
  }

  /** Release resources. */
  dispose(): void {
    this.recognizer = null;
    this.loaded = false;
    this.loadPromise = null;
    this.transcribeQueue = Promise.resolve();
    log.info('STT engine disposed');
  }
}
