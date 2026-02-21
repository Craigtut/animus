/**
 * Audio conversion utilities for the speech module.
 *
 * Handles format conversion between browser audio (WebM/Opus)
 * and the raw PCM needed by sherpa-onnx engines.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createLogger } from '../lib/logger.js';

const log = createLogger('AudioUtils', 'speech');

/** Check if ffmpeg is available on the system. */
export async function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

/** Convert WebM/Opus audio buffer to raw PCM (16kHz mono Float32). */
export async function webmToPcm(webmBuffer: Buffer): Promise<{ samples: Float32Array; sampleRate: number }> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-f', 'f32le',     // 32-bit float little-endian
      '-ar', '16000',     // 16kHz
      '-ac', '1',         // mono
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const chunks: Buffer[] = [];
    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on('data', () => {}); // suppress stderr

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}`));
        return;
      }
      const pcmBuffer = Buffer.concat(chunks);
      const samples = new Float32Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 4);
      resolve({ samples, sampleRate: 16000 });
    });

    ffmpeg.on('error', (err) => reject(new Error(`ffmpeg not available: ${err.message}`)));
    ffmpeg.stdin.write(webmBuffer);
    ffmpeg.stdin.end();
  });
}

/** Convert raw PCM Float32 samples to a WAV buffer (16-bit PCM). */
export function pcmToWav(samples: Float32Array, sampleRate: number): Buffer {
  const numSamples = samples.length;
  const bytesPerSample = 2; // 16-bit
  const dataSize = numSamples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);          // chunk size
  buffer.writeUInt16LE(1, 20);           // PCM format
  buffer.writeUInt16LE(1, 22);           // mono
  buffer.writeUInt32LE(sampleRate, 24);  // sample rate
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32);  // block align
  buffer.writeUInt16LE(16, 34);          // bits per sample

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Convert float32 samples to int16
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    buffer.writeInt16LE(Math.round(val), 44 + i * bytesPerSample);
  }

  return buffer;
}

/** Read a WAV file and return Float32 samples + sample rate. */
export function readWavSamples(wavPath: string): { samples: Float32Array; sampleRate: number } {
  const buf = readFileSync(wavPath);

  // Parse WAV header
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Not a valid WAV file: ${wavPath}`);
  }

  // Find fmt chunk
  let offset = 12;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let numChannels = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      numChannels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (!sampleRate || !dataOffset) {
    throw new Error(`Could not parse WAV header: ${wavPath}`);
  }

  // Convert to Float32Array
  const numSamples = dataSize / (bitsPerSample / 8) / numChannels;
  const samples = new Float32Array(numSamples);

  if (bitsPerSample === 16) {
    for (let i = 0; i < numSamples; i++) {
      const val = buf.readInt16LE(dataOffset + i * numChannels * 2);
      samples[i] = val / 0x8000;
    }
  } else if (bitsPerSample === 32) {
    // Could be float or int32
    for (let i = 0; i < numSamples; i++) {
      samples[i] = buf.readFloatLE(dataOffset + i * numChannels * 4);
    }
  } else {
    throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`);
  }

  return { samples, sampleRate };
}
