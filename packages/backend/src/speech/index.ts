/**
 * Speech module -- shared STT/TTS engines for Animus.
 */

export { STTEngine } from './stt-engine.js';
export { TTSEngine, type TTSResult, type TTSSynthesisOptions, type TTSEngineConfig } from './tts-engine.js';
export { VoiceManager, type VoiceEntry } from './voice-manager.js';
export {
  SpeechService,
  getSpeechService,
  initSpeechService,
  _resetSpeechService,
  type SpeechServiceConfig,
  type SpeechStatus,
} from './speech-service.js';
export { pcmToWav, webmToPcm, checkFfmpeg, readWavSamples } from './audio-utils.js';
