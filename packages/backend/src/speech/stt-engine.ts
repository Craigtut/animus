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

    if (!this.isAvailable()) {
      throw new Error('STT model files not found. Download Parakeet TDT v3 to data/models/stt/');
    }

    const sttDir = path.join(this.modelsPath, 'stt');
    log.info('Loading STT model (Parakeet TDT v3)...');

    const sherpa = await import('sherpa-onnx-node');

    const config = new sherpa.OfflineRecognizerConfig({
      modelConfig: new sherpa.OfflineModelConfig({
        transducer: new sherpa.OfflineTransducerModelConfig({
          encoder: path.join(sttDir, 'encoder.int8.onnx'),
          decoder: path.join(sttDir, 'decoder.int8.onnx'),
          joiner: path.join(sttDir, 'joiner.int8.onnx'),
        }),
        tokens: path.join(sttDir, 'tokens.txt'),
        numThreads: 2,
      }),
    });

    this.recognizer = new sherpa.OfflineRecognizer(config);
    this.loaded = true;
    log.info('STT model loaded successfully');
  }

  /** Transcribe PCM audio to text. */
  async transcribe(pcmSamples: Float32Array, sampleRate: number): Promise<string> {
    await this.ensureLoaded();

    const stream = this.recognizer.createStream();
    stream.acceptWaveform({ sampleRate, samples: pcmSamples });
    this.recognizer.decode(stream);

    const text = stream.result.text.trim();
    log.debug(`Transcribed ${pcmSamples.length} samples -> "${text.substring(0, 80)}..."`);
    return text;
  }

  /** Release resources. */
  dispose(): void {
    this.recognizer = null;
    this.loaded = false;
    log.info('STT engine disposed');
  }
}
