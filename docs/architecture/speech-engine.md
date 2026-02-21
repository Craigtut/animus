# Shared Speech Engine Architecture

How Animus hears and speaks -- shared STT and TTS as backend infrastructure modules, not channel-specific. Multiple consumers (voice channel, reflex system, agent MCP tools, plugins) access speech capabilities through a unified service facade.

## Overview

The speech engine extracts STT and TTS from the voice channel adapter into shared backend infrastructure. Rather than the voice channel owning its own recognizer and synthesizer instances, all speech capabilities are centralized in a singleton `SpeechService` that any part of the system can use.

**Consumers:**
- **Voice channel adapter** -- transcribes incoming audio, synthesizes replies
- **Reflex system** -- streams TTS for fast voice replies
- **MCP tools** -- `transcribe_audio` and `generate_speech` tools available to the mind and sub-agents
- **Plugins** -- any plugin can access speech via the service singleton

---

## Technology Choices

### Speech-to-Text: Parakeet TDT v3 via sherpa-onnx

**Model**: NVIDIA Parakeet TDT 0.6B v3 (int8 quantized)
**Runtime**: sherpa-onnx (native Node.js addon via npm)

Parakeet TDT v3 is a 600M-parameter transducer-based ASR model from NVIDIA that achieves state-of-the-art accuracy while running efficiently on CPU. It supports **25 European languages** with automatic language detection. The int8 quantized ONNX version runs locally through sherpa-onnx without internet access.

| Criterion | Value |
|-----------|-------|
| **Accuracy** | 9.7% average WER across 25 languages |
| **Multilingual** | 25 European languages with automatic language detection |
| **Speed** | Faster than real-time on CPU via ONNX Runtime |
| **Local** | Completely offline -- no API calls, no internet needed |
| **Node.js native** | sherpa-onnx npm package with native addon bindings. No Python. |
| **Model size** | ~630 MB (int8 quantized encoder + decoder + joiner) |
| **Input** | 16kHz mono PCM audio |
| **License** | CC-BY-4.0 |

### Text-to-Speech: Pocket TTS via sherpa-onnx

**Model**: Pocket TTS (~200MB INT8)
**Runtime**: sherpa-onnx (same native Node.js addon as STT -- no separate process)

Pocket TTS is a zero-shot voice cloning model that uses reference audio to reproduce any voice. Given a short WAV sample (5-15 seconds), it generates speech that mimics the speaker's voice characteristics. Since sherpa-onnx already bundles Pocket TTS support, **both STT and TTS use the same runtime** -- no Python sidecar, no separate process, no additional dependencies.

| Criterion | Value |
|-----------|-------|
| **Unified runtime** | Same `sherpa-onnx` npm package handles both STT and TTS |
| **Voice cloning** | Zero-shot cloning from 5-15 seconds of reference audio |
| **Speed** | Sub-300ms processing for typical sentences on CPU |
| **Quality** | Natural-sounding speech that reproduces the reference voice |
| **CPU-only** | No GPU needed |
| **License** | MIT + CC-BY-4.0 |
| **Model size** | ~200 MB (INT8 quantized, multiple ONNX files) |

---

## Module Structure

```
packages/backend/src/speech/
  audio-utils.ts     -- webmToPcm, pcmToWav, readWavSamples, checkFfmpeg
  stt-engine.ts      -- STTEngine class (lazy-loaded OfflineRecognizer)
  tts-engine.ts      -- TTSEngine class (lazy-loaded OfflineTts, voice caching)
  voice-manager.ts   -- VoiceManager (manifest CRUD, built-in discovery, custom uploads)
  speech-service.ts  -- SpeechService facade + singleton (getSpeechService/initSpeechService)
  index.ts           -- barrel export
```

### SpeechService Facade

The `SpeechService` is the public API. It wraps both engines and the voice manager behind a clean interface:

```typescript
class SpeechService {
  readonly stt: STTEngine;
  readonly tts: TTSEngine;
  readonly voices: VoiceManager;

  async initialize(): Promise<void>;
  isAvailable(): { stt: boolean; tts: boolean };
}

// Singleton access
function initSpeechService(): SpeechService;   // Called once at startup
function getSpeechService(): SpeechService;     // Used everywhere else
```

`initSpeechService()` is called in `packages/backend/src/index.ts` during server startup. Both engines independently lazy-load their models on first use -- `initSpeechService()` creates the service instance but does not load models. Models load on the first call to `stt.transcribe()` or `tts.synthesize()`.

### STTEngine

```typescript
class STTEngine {
  async transcribe(audio: Buffer | Float32Array, sampleRate?: number): Promise<string>;
  isAvailable(): boolean;  // Checks model files exist without loading
}
```

Lazy-loads the sherpa-onnx `OfflineRecognizer` on first `transcribe()` call. Uses dynamic `import('sherpa-onnx-node')` so the backend does not crash if the sherpa-onnx native module is not installed.

### TTSEngine

```typescript
class TTSEngine {
  async synthesize(text: string, voiceId?: string, speed?: number): Promise<{
    samples: Float32Array;
    sampleRate: number;
  }>;
  isAvailable(): boolean;  // Checks model files exist without loading
  async setVoice(voiceId: string): Promise<void>;  // Load/cache reference audio
}
```

Lazy-loads the sherpa-onnx `OfflineTts` on first `synthesize()` call. Caches the active voice's reference audio in memory so subsequent synthesis calls don't re-read the WAV file.

### VoiceManager

Manages the voice manifest and WAV files:

```typescript
class VoiceManager {
  listVoices(): Voice[];
  getVoice(id: string): Voice | undefined;
  addCustomVoice(name: string, wavBuffer: Buffer): Promise<Voice>;
  removeCustomVoice(id: string): Promise<void>;
  discoverBuiltInVoices(): Voice[];
}

interface Voice {
  id: string;
  name: string;
  type: 'built-in' | 'custom';
  wavPath: string;         // Absolute path to reference WAV
  description?: string;
}
```

### Audio Utilities

```typescript
// Convert WebM/Opus to PCM (requires ffmpeg)
function webmToPcm(webmBuffer: Buffer): Promise<Float32Array>;

// Convert PCM samples to WAV buffer
function pcmToWav(samples: Float32Array, sampleRate: number): Buffer;

// Read WAV file and return samples
function readWavSamples(wavPath: string): Promise<{ samples: Float32Array; sampleRate: number }>;

// Check if ffmpeg is available
function checkFfmpeg(): Promise<boolean>;
```

---

## Voice System

### Built-in Voices

Pocket TTS ships with 8 built-in voices from its test_wavs directory:

| ID | Name | Source |
|----|------|--------|
| `alba` | Alba | Pocket TTS test_wavs |
| `marius` | Marius | Pocket TTS test_wavs |
| `javert` | Javert | Pocket TTS test_wavs |
| `jean` | Jean | Pocket TTS test_wavs |
| `fantine` | Fantine | Pocket TTS test_wavs |
| `cosette` | Cosette | Pocket TTS test_wavs |
| `eponine` | Eponine | Pocket TTS test_wavs |
| `azelma` | Azelma | Pocket TTS test_wavs |

### Custom Voices

Users can upload their own WAV files (5-15 seconds of reference audio) to create custom voices. The `VoiceManager` handles:
- Validating WAV format and duration
- Saving to `data/voices/custom/`
- Updating the voice manifest
- Making the voice available for selection in the persona

### Voice Manifest

Voice metadata is stored in `data/voices/voices.json`:

```json
{
  "voices": [
    {
      "id": "alba",
      "name": "Alba",
      "type": "built-in",
      "wavPath": "data/voices/built-in/alba.wav",
      "description": "Female voice"
    },
    {
      "id": "custom-abc123",
      "name": "My Voice",
      "type": "custom",
      "wavPath": "data/voices/custom/abc123.wav"
    }
  ]
}
```

### Voice in the Persona

The active voice is part of the persona configuration:

- `personality_settings.voice_id` -- ID of the selected voice (default: first built-in voice)
- `personality_settings.voice_speed` -- Speech speed multiplier (0.5-2.0, default: 1.0)

The TTSEngine reads the persona's voice settings when synthesizing. Changing the voice in Settings > Persona triggers `tts.setVoice()` to cache the new reference audio.

---

## Model Files

### STT Models

Stored in `data/models/stt/`:

```
data/models/stt/
  encoder.int8.onnx     -- ~622 MB
  decoder.int8.onnx     -- ~6.9 MB
  joiner.int8.onnx      -- ~1.7 MB
  tokens.txt            -- vocabulary
```

Total: ~630 MB

### TTS Models

Stored in `data/models/tts/`:

```
data/models/tts/
  lm_flow.int8.onnx       -- Language model (flow)
  lm_main.int8.onnx       -- Language model (main)
  encoder.onnx             -- Encoder
  decoder.int8.onnx        -- Decoder
  text_conditioner.onnx    -- Text conditioning
  vocab.json               -- Vocabulary
  token_scores.json        -- Token scoring
```

Total: ~200 MB

### Voice Files

Stored in `data/voices/`:

```
data/voices/
  voices.json              -- Voice manifest
  built-in/                -- Built-in Pocket TTS voices
    alba.wav
    marius.wav
    javert.wav
    jean.wav
    fantine.wav
    cosette.wav
    eponine.wav
    azelma.wav
  custom/                  -- User-uploaded voice references
    {uuid}.wav
```

---

## Lazy Loading & Graceful Degradation

Both engines use dynamic `import('sherpa-onnx-node')` and lazy initialization:

1. **No crash on missing models** -- If model files are not present, `isAvailable()` returns `false` and the service simply reports speech as unavailable. The rest of the backend runs normally.
2. **No crash on missing native module** -- If the `sherpa-onnx` npm package is not installed, the dynamic import fails gracefully and both engines report as unavailable.
3. **Lazy model loading** -- Models are loaded into memory only on the first actual use (first `transcribe()` or `synthesize()` call), not at server startup. This keeps startup fast.
4. **Independent availability** -- STT and TTS load independently. If only STT models are present, transcription works but synthesis does not (and vice versa).

```typescript
// Example: checking availability without loading
const speech = getSpeechService();
const { stt, tts } = speech.isAvailable();
// stt: true if model files exist on disk
// tts: true if model files exist on disk
// Neither engine is loaded yet -- just filesystem checks
```

---

## MCP Tools

Two MCP tools expose speech capabilities to the mind and sub-agents:

### `transcribe_audio`

- **Category**: safe
- **Permission**: always_allow
- **Input**: Audio file path or buffer
- **Output**: Transcribed text
- **Use case**: Mind or sub-agent needs to process audio content (e.g., a user uploaded an audio file via another channel)

### `generate_speech`

- **Category**: acts
- **Permission**: ask (produces audio output the user will hear)
- **Input**: Text to synthesize, optional voice_id and speed
- **Output**: WAV audio buffer or saved file path
- **Use case**: Mind decides to speak proactively, sub-agent needs to generate audio content

Both tools call through `getSpeechService()` and fail gracefully with a clear error message if the speech engine is not available.

---

## Consumer Integration

### Voice Channel Adapter

The voice channel adapter does **not** own STT or TTS instances. It calls the shared speech service:

```typescript
// In the voice channel adapter
const speech = getSpeechService();

// Transcribe incoming audio
const text = await speech.stt.transcribe(pcmAudio);

// Synthesize reply
const audio = await speech.tts.synthesize(replyText);
const wav = pcmToWav(audio.samples, audio.sampleRate);
```

See `docs/architecture/voice-channel.md` for the full voice channel architecture.

### Reflex System

The reflex system streams text chunks to the TTS for sentence-buffered synthesis:

```typescript
const speech = getSpeechService();

// Per-sentence synthesis during reflex streaming
const audio = await speech.tts.synthesize(sentence);
```

See `docs/architecture/reflex-system.md` for the dual-path voice architecture.

### Persona UI

Settings > Persona includes voice selection:
- Dropdown of available voices (built-in + custom)
- Upload button for custom voice WAV files
- Voice speed slider
- Preview/test button that synthesizes a sample sentence

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| sherpa-onnx not installed | Both engines report unavailable. Backend runs normally. |
| STT model files missing | `stt.isAvailable()` returns false. Transcription calls fail with clear error. |
| TTS model files missing | `tts.isAvailable()` returns false. Synthesis calls fail with clear error. |
| ffmpeg not installed | `checkFfmpeg()` returns false. WebM-to-PCM conversion unavailable. Raw PCM input still works. |
| Invalid reference audio | `VoiceManager.addCustomVoice()` validates format and rejects with descriptive error. |
| Voice ID not found | `tts.synthesize()` falls back to default built-in voice with a warning log. |

---

## Related Documents

- `docs/architecture/voice-channel.md` -- Voice channel adapter, audio pipeline, frontend UX
- `docs/architecture/reflex-system.md` -- Fast-response system that uses TTS for voice replies
- `docs/architecture/heartbeat.md` -- The tick pipeline that processes voice messages
- `docs/architecture/persona.md` -- Persona configuration including voice settings
- `docs/architecture/mcp-tools.md` -- MCP tool architecture for `transcribe_audio` and `generate_speech`
