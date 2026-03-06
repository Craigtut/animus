# Voice Channel Architecture

> **See also**:
> - `docs/architecture/speech-engine.md` -- Shared speech engine (STT/TTS engine classes, voice system, model files, MCP tools, lazy loading)
> - `docs/architecture/tts-licensing-and-distribution.md` -- TTS model licensing (CC-BY-4.0), redistribution, attribution, voice cloning consent

How Animus hears and speaks: a direct voice channel on the Presence page that captures user speech, transcribes it locally, processes it through the heartbeat pipeline, and speaks the reply back using local text-to-speech.

## Concept

The voice channel adds a conversational voice mode to the web Presence page. Unlike the existing Home Assistant path (where HA handles STT/TTS externally and sends text to the Ollama/OpenAI API), this is a **native voice channel** — Animus owns the entire audio pipeline end-to-end.

```
                         FRONTEND (Browser)                    BACKEND (Node.js)
                    ┌─────────────────────────┐          ┌─────────────────────────┐
                    │                         │          │                         │
  User speaks ────► │  MediaRecorder API      │          │                         │
                    │  (WebM/Opus, 16kHz)     │          │                         │
                    │         │                │          │                         │
                    │         ▼                │          │                         │
                    │  WebSocket / tRPC ───────┼────────► │  STT Service            │
                    │  (binary audio chunks)   │          │  (sherpa-onnx)          │
                    │                         │          │  Parakeet TDT v3        │
                    │                         │          │         │                │
                    │                         │          │         ▼                │
                    │                         │          │  Transcribed text        │
                    │                         │          │         │                │
                    │                         │          │         ▼                │
                    │                         │          │  Channel Adapter         │
                    │                         │          │  (voice → IncomingMessage)│
                    │                         │          │         │                │
                    │                         │          │         ▼                │
                    │                         │          │  ┌───────────────────┐   │
                    │                         │          │  │ HEARTBEAT PIPELINE│   │
                    │                         │          │  │ Gather → Mind →   │   │
                    │                         │          │  │ Execute           │   │
                    │                         │          │  └────────┬──────────┘   │
                    │                         │          │           │              │
                    │                         │          │           ▼              │
                    │                         │          │  Reply text (streamed)   │
                    │                         │          │           │              │
                    │                         │          │           ▼              │
                    │                         │          │  TTS Service             │
                    │  ◄──────────────────────┼──────────│  (native Pocket TTS)     │
                    │  Audio chunks via WS     │          │  Streaming WAV chunks   │
                    │         │                │          │                         │
                    │         ▼                │          │                         │
  User hears  ◄──── │  Web Audio API          │          │                         │
                    │  (AudioContext playback) │          │                         │
                    └─────────────────────────┘          └─────────────────────────┘
```

## Technology Choices

The voice channel uses the shared speech engine for both STT and TTS. See `docs/architecture/speech-engine.md` for the complete technology details, model files, engine classes, voice system, and lazy loading behavior.

**Summary:**
- **STT**: NVIDIA Parakeet TDT 0.6B v3 (int8 quantized, ~630 MB) via sherpa-onnx native Node.js addon. 25-language support, faster-than-realtime on CPU, completely offline.
- **TTS**: Pocket TTS (~225 MB safetensors) via `@animus-labs/tts-native` napi-rs addon (Rust/Candle). Zero-shot voice cloning from 5-15 seconds of reference audio, ~3.2x realtime on Apple Silicon, CPU-only.

Both engines are accessed through the `SpeechService` singleton. The voice channel adapter does **not** own STT or TTS instances.

```typescript
import { getSpeechService, pcmToWav } from '../speech/index.js';

const speech = getSpeechService();
const text = await speech.stt.transcribe(pcmAudio);
const audio = await speech.tts.synthesize(replyText);
const wav = pcmToWav(audio.samples, audio.sampleRate);
```

---

## Channel Type Update

Voice becomes a new channel type:

```typescript
type ChannelType = 'web' | 'sms' | 'discord' | 'api' | 'voice';
```

The voice channel is conceptually separate from the web channel. While voice is accessed through the web UI, it has different semantics:
- **web**: Text messages via tRPC
- **voice**: Audio messages transcribed to text, replies synthesized to audio

The channel type matters for the mind's context — it knows whether the user is typing or speaking, and can adjust its response style accordingly (shorter, more conversational replies for voice).

---

## The IncomingMessage for Voice

Voice messages use the standard `IncomingMessage` interface with `channel: 'voice'`:

```typescript
const voiceMessage: IncomingMessage = {
  channel: 'voice',
  channelIdentifier: userId,        // Same as web — authenticated user
  contact: resolvedContact,         // Same resolution as web channel
  conversationId: voiceSessionId,   // Unique per voice session
  content: transcribedText,         // STT output
  media: [{                         // Original audio preserved
    id: uuid(),
    type: 'audio',
    mimeType: 'audio/wav',
    localPath: '/data/media/voice/{id}.wav',
    originalFilename: null,
    sizeBytes: audioSize,
  }],
  rawMetadata: {
    sttModel: 'parakeet-tdt-0.6b-v3-int8',
    sttConfidence: confidence,       // If available from sherpa-onnx
    audioDurationMs: duration,
    voiceSessionId: voiceSessionId,
  },
  receivedAt: new Date().toISOString(),
};
```

The original audio is saved as a media attachment (same as MMS/Discord attachments). The `content` field contains the transcribed text that the mind processes.

---

## Frontend Integration

### Voice Button on Presence

The message input area gains a **microphone button** next to the send button. This is the entry point for voice mode.

**Layout (updated message input):**
```
┌──────────────────────────────────────────────────┐
│  [Message input field]              [🎤] [➤]     │
└──────────────────────────────────────────────────┘
```

- **🎤 (Microphone icon)**: Phosphor `Microphone` icon (20px), same styling as the send button
- **Inactive state**: Secondary text color (0.40 opacity), same as empty send button
- **Hover**: Subtle opacity increase
- **Click**: Enters voice mode

### Voice Mode States

When the user clicks the microphone button, the input area transforms into a voice interaction surface:

#### 1. Listening

```
┌──────────────────────────────────────────────────┐
│  [■]  ~~~~~ audio waveform ~~~~~   "Listening..." │
└──────────────────────────────────────────────────┘
```

- The text input is replaced by an **audio waveform visualization** (simple amplitude bars or a sine wave based on the microphone input level)
- A **stop button** (Phosphor `Stop` icon, filled, in a circle) replaces the microphone button at the left
- "Listening..." label in secondary text
- The emotional field may subtly shift to indicate attentiveness (curiosity orb brightening)
- Browser requests microphone permission on first use via `navigator.mediaDevices.getUserMedia()`
- Audio is captured via the **MediaRecorder API** (WebM/Opus format at 16kHz)

#### 2. Processing (STT)

```
┌──────────────────────────────────────────────────┐
│       "Understanding..."  [breathing dots]        │
└──────────────────────────────────────────────────┘
```

- After the user stops speaking (silence detection or manual stop), audio is sent to the backend
- Brief processing state while STT runs (~1-2 seconds for typical utterances)
- The transcribed text briefly flashes in the input area before being sent

#### 3. Thinking (Mind Processing)

Same as the existing text thinking indicator — the "..." breathing opacity in the conversation area. The heartbeat pulse fires.

#### 4. Speaking (TTS Playback)

```
┌──────────────────────────────────────────────────┐
│  [■]  ~~~~~ playback waveform ~~~~~  "Speaking..." │
└──────────────────────────────────────────────────┘
```

- The reply text streams into the conversation area (same as text mode)
- **Simultaneously**, audio plays through the browser's Web Audio API
- A playback waveform shows in the input area
- Stop button allows interrupting playback
- When playback completes, the input returns to the listening state (for continuous conversation) or to the default text input state

#### 5. Continuous Conversation Mode

Voice mode is **sticky** — after the reply plays, the system returns to the Listening state automatically. The user can have a back-and-forth voice conversation without clicking the microphone button each time. Pressing the stop button or clicking outside the voice area exits voice mode and returns to the text input.

### Audio Handling in the Browser

**Capture:**
```typescript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    sampleRate: 16000,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
  }
});
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: 'audio/webm;codecs=opus',
});
```

**Playback:**
```typescript
const audioContext = new AudioContext({ sampleRate: 24000 });
// Decode WAV buffer from backend
const audioBuffer = await audioContext.decodeAudioData(wavArrayBuffer);
const source = audioContext.createBufferSource();
source.buffer = audioBuffer;
source.connect(audioContext.destination);
source.start();
```

**Echo cancellation**: Critical — when the AI is speaking and the user's microphone is active (continuous mode), the browser's built-in echo cancellation (`echoCancellation: true` in getUserMedia constraints) prevents the AI's voice from being re-captured and transcribed. This is handled at the browser level.

### Voice Activity Detection (Frontend)

To avoid sending silence to the backend, the frontend performs basic voice activity detection:

1. Use an `AudioWorklet` or `AnalyserNode` to monitor the microphone input level
2. Start recording when amplitude exceeds a threshold for >200ms
3. Stop recording when amplitude drops below threshold for >1.5 seconds (silence timeout)
4. Send the recorded audio chunk to the backend for STT

This provides a natural "push-to-talk without pushing" experience. The silence timeout is tunable.

---

## Backend Architecture

### Voice Channel Adapter

A new `VoiceChannelAdapter` implements `IChannelAdapter`. It does **not** own STT or TTS instances — it calls through the shared `SpeechService`. See `docs/architecture/speech-engine.md` for the engine architecture.

```typescript
import { getSpeechService, pcmToWav } from '../speech/index.js';

class VoiceChannelAdapter implements IChannelAdapter {
  readonly channelType: ChannelType = 'voice';

  async start(): Promise<void> {
    // 1. Verify speech service is initialized
    // 2. Register tRPC routes for audio streaming
    // STT/TTS lazy-load on first use via SpeechService
  }

  async stop(): Promise<void> {
    // Cleanup adapter-specific resources (subscriptions, etc.)
    // Speech engine lifecycle is managed by SpeechService, not the adapter
  }

  async transcribe(audioBuffer: Buffer): Promise<string> {
    return getSpeechService().stt.transcribe(audioBuffer);
  }

  async synthesize(text: string): Promise<Buffer> {
    const audio = await getSpeechService().tts.synthesize(text);
    return pcmToWav(audio.samples, audio.sampleRate);
  }

  async send(contactId: string, content: string): Promise<void> {
    // For outbound: synthesize text to audio, push to frontend via subscription
  }

  isEnabled(): boolean;
}
```

### Audio Processing Pipeline

1. **Frontend** captures audio as WebM/Opus chunks via MediaRecorder
2. Audio chunks are sent to backend via tRPC subscription or WebSocket
3. **Backend** decodes WebM/Opus to raw PCM (16kHz, mono, 16-bit) using `ffmpeg` or a lightweight decoder
4. PCM is fed to **sherpa-onnx** offline recognizer with the Parakeet TDT v3 model (STT)
5. Transcribed text is wrapped in an `IncomingMessage` with `channel: 'voice'`
6. Message enters the **heartbeat pipeline** (same path as all other channels)
7. Reply text from the mind is synthesized via **native Pocket TTS** (`@animus-labs/tts-native`) through the shared speech service (in-process)
8. WAV audio buffer is sent back to the frontend via tRPC subscription
9. **Frontend** plays audio through Web Audio API

### Audio Format Conversion

The frontend captures WebM/Opus. sherpa-onnx needs 16kHz mono 16-bit PCM. Options for conversion:

**Option A: ffmpeg (Recommended)**
Use `ffmpeg` as a child process for format conversion. It's likely already available on the host (or easily installed) and handles any input format.

```typescript
// WebM/Opus → PCM conversion
const ffmpeg = spawn('ffmpeg', [
  '-i', 'pipe:0',          // Read from stdin
  '-f', 's16le',           // Output raw PCM
  '-ar', '16000',          // 16kHz sample rate
  '-ac', '1',              // Mono
  'pipe:1',                // Write to stdout
]);
ffmpeg.stdin.write(webmBuffer);
ffmpeg.stdin.end();
// Read PCM from ffmpeg.stdout
```

**Option B: Web Audio API decoding on frontend**
Decode to PCM in the browser before sending. This avoids ffmpeg on the backend but increases upload size (PCM is uncompressed).

**Decision**: Use Option A (ffmpeg). The compressed WebM upload is faster over the network, and ffmpeg is a standard system dependency.

### tRPC Procedures for Voice

```typescript
// In the voice router
export const voiceRouter = router({
  // Send audio for transcription and processing
  transcribeAndProcess: publicProcedure
    .input(z.object({
      audio: z.instanceof(Buffer),      // WebM/Opus audio
      mimeType: z.string(),
      voiceSessionId: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      // 1. Convert to PCM
      // 2. Transcribe via sherpa-onnx
      // 3. Create IncomingMessage with channel: 'voice'
      // 4. Hand to heartbeat pipeline
      // Returns: { transcription: string, messageId: string }
    }),

  // Subscribe to voice replies (TTS audio)
  onVoiceReply: publicProcedure
    .subscription(() => {
      return observable<{ audioChunk: Buffer; isComplete: boolean }>((emit) => {
        // Emit WAV audio chunks as they're synthesized
      });
    }),

  // Check voice service availability
  voiceStatus: publicProcedure
    .query(() => ({
      sttAvailable: boolean,     // sherpa-onnx STT loaded
      ttsAvailable: boolean,     // sherpa-onnx TTS loaded
      sttModel: string,          // 'parakeet-tdt-0.6b-v3-int8'
      ttsModel: string,          // 'pocket-tts'
    })),
});
```

---

## Streaming Pipeline for Voice

Voice replies follow a modified version of the standard streaming pipeline:

```
MIND QUERY (streaming)
       │
       ▼
  ┌────────────┐
  │  llm-json- │
  │  stream     │
  └─────┬──────┘
        │
  ┌─────┴──────┐
  ▼            ▼
reply.content  Full JSON
(streaming)    (for EXECUTE)
  │
  ├────────────────────────────┐
  ▼                            ▼
tRPC text subscription    Sentence buffer
(same as web channel)          │
                               ▼
                         TTS per sentence
                               │
                               ▼
                         Audio chunks via
                         tRPC subscription
                               │
                               ▼
                         Web Audio playback
```

**Sentence buffering**: The reply streams word-by-word from the mind. For TTS, we buffer until a sentence boundary (`.`, `!`, `?`, or a pause token) and then synthesize each complete sentence via Pocket TTS through the shared speech service. This balances latency (don't wait for the full reply) with TTS quality (complete sentences sound better than word fragments).

The text reply still streams to the frontend simultaneously — the user sees the text appearing while hearing the audio with a slight delay.

---

## Configuration

### System Settings (system.db > channel_configs)

```typescript
const voiceConfigSchema = z.object({
  sttModel: z.enum(['parakeet-tdt-0.6b-v3-int8']).default('parakeet-tdt-0.6b-v3-int8'),
  silenceTimeoutMs: z.number().default(1500),               // Frontend silence detection
  continuousMode: z.boolean().default(true),                // Auto-return to listening after reply
});
```

Voice configuration (voice selection and speed) is part of the persona (`personality_settings.voice_id` and `personality_settings.voice_speed`), not the channel config. See `docs/architecture/speech-engine.md` for the voice system.

### Environment Variables (Fallback)

```env
# Voice channel (optional — can configure via UI)
VOICE_TTS_SPEED=1.0
```

### Prerequisites

The voice channel requires:
1. **sherpa-onnx npm package** installed (`npm install sherpa-onnx`) — for STT only
2. **@animus-labs/tts-native** built (`npm run build -w @animus-labs/tts-native`, requires Rust toolchain) — for TTS. Auto-built on `npm run dev` if Rust is available.
3. **Parakeet TDT v3 model files** downloaded to `./data/models/stt/`
4. **Pocket TTS model files** (safetensors) downloaded to `./data/models/tts/`
5. **ffmpeg** installed on the system (for audio format conversion)

No Python required. STT runs via sherpa-onnx native Node.js addon, TTS runs via @animus-labs/tts-native napi-rs addon (Rust).

If any prerequisite is missing, the voice channel shows as "unavailable" in settings with a message about what's needed. The web text channel continues to work regardless.

---

## Mind Context for Voice

When the voice channel triggers a tick, GATHER CONTEXT includes additional voice-specific context:

```
Channel: voice (the user is speaking to you verbally)
Respond naturally as if in a spoken conversation.
Keep responses concise and conversational — shorter than you would for text.
Avoid markdown formatting, bullet points, or code blocks — these don't translate well to speech.
Use natural speech patterns: contractions, conversational fillers where appropriate.
```

This channel-aware formatting guidance helps the mind produce responses that sound natural when spoken aloud, similar to how the existing channel system provides Discord-vs-SMS formatting hints.

---

## Database Impact

### ChannelType Update

Update the `ChannelType` enum in shared types:

```typescript
type ChannelType = 'web' | 'sms' | 'discord' | 'api' | 'voice';
```

### channel_configs (system.db)

A new row for `channel_type = 'voice'` with the voice config schema.

### Messages (messages.db)

Voice messages are stored as normal messages with `channel = 'voice'`. The transcribed text goes in the `content` field. The original audio is stored as a `media_attachment` linked to the message.

### No New Tables

Voice doesn't need new tables. It uses the existing message, media attachment, and channel config infrastructure.

---

## Streaming Pipeline Detail

### Reply-to-Speech Flow

When the mind produces a reply for a voice-triggered message:

1. Reply text streams naturally during the mind's `replying` phase (between `record_thought` and `record_cognitive_state` cognitive tool calls)
2. A **sentence accumulator** buffers tokens until a sentence boundary
3. Each complete sentence is immediately synthesized via Pocket TTS through the shared speech service (in-process)
4. The WAV audio buffer is emitted to the frontend via the `onVoiceReply` tRPC subscription
5. The frontend queues audio buffers and plays them sequentially through Web Audio API
6. Text continues streaming to the conversation area simultaneously

This means the user starts hearing the first sentence almost immediately after Pocket TTS synthesizes it, while the mind is still generating later sentences. The perceived latency is:
- STT processing: ~1-2 seconds
- Mind thinking: variable (depends on LLM)
- First sentence TTS: sub-300ms after first sentence completes (Pocket TTS in-process, no HTTP overhead)
- Playback starts while remaining sentences generate

### Audio Chunk Format

```typescript
interface VoiceReplyChunk {
  sentenceIndex: number;     // For ordered playback
  audio: Buffer;             // WAV audio (24kHz, mono, 16-bit PCM)
  text: string;              // The sentence text (for synchronization)
  isLast: boolean;           // Last chunk in this reply
}
```

---

## Error Handling

| Failure | Behavior |
|---------|----------|
| Microphone denied | Show permission prompt. Fall back to text input. |
| STT model not loaded | Voice button disabled with tooltip: "Voice unavailable — STT model not loaded" |
| TTS model not loaded | Transcription works, reply is text-only. Log warning. |
| STT transcription empty | Ignore (silence detected). Return to listening. |
| STT transcription garbled | Send to mind anyway — the mind can ask for clarification. |
| ffmpeg not installed | Voice channel shows as unavailable in settings. |
| Audio decode failure | Log error, skip the message, return to listening. |
| TTS synthesis fails | Reply delivered as text only (graceful degradation). |

---

## Security Considerations

- **Microphone access** requires explicit browser permission (standard Web API behavior)
- Audio data is processed locally — never sent to external services
- Original audio files follow the same TTL cleanup as other media (30 days)
- Voice channel uses the same authentication as the web channel (authenticated user session)
- Echo cancellation prevents the AI's speech from being re-transcribed in continuous mode

---

## Future Considerations

1. **Wake word detection** — "Hey Animus" to start voice mode without clicking
2. **Streaming STT** — Use sherpa-onnx's online recognizer for real-time partial transcription (show words as the user speaks)
3. **Voice emotion detection** — Analyze tone/prosody of user's speech to inform the mind's emotional processing
4. **Additional TTS languages** — Expand Pocket TTS language support as models become available
5. **Phone/SIP channel** — Extend voice to phone calls via SIP/VoIP
6. **Speaker diarization** — If multiple people are speaking, identify who's talking (sherpa-onnx supports this)

---

## References

- `docs/architecture/channel-packages.md` — Channel system architecture, IncomingMessage, outbound routing
- `docs/architecture/heartbeat.md` — Pipeline that voice messages flow through
- `docs/architecture/contacts.md` — Identity resolution (voice uses web user's contact)
- `docs/frontend/presence.md` — Presence page where voice mode lives
- `docs/frontend/app-shell.md` — App shell and navigation
- `docs/architecture/tech-stack.md` — Database architecture, shared abstractions
- [sherpa-onnx GitHub](https://github.com/k2-fsa/sherpa-onnx) — STT runtime
- [sherpa-onnx npm](https://www.npmjs.com/package/sherpa-onnx) — Node.js package (STT)
- [Parakeet TDT v3 (HuggingFace)](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) — STT model
- `docs/architecture/speech-engine.md` — Shared speech engine architecture, voice system
- [pocket-tts Rust crate](https://github.com/babybirdprd/pocket-tts) — Rust port of Pocket TTS (used by @animus-labs/tts-native)
- [Pocket TTS model weights (HuggingFace)](https://huggingface.co/kyutai/pocket-tts) — Original model (CC-BY-4.0, gated)
- `docs/architecture/tts-licensing-and-distribution.md` — TTS model licensing and redistribution details
