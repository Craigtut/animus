# Voice Mode

> **STATUS: PLANNED** - This feature is not yet implemented. This is a design specification for the frontend voice interaction UI.

> **Dependency:** This spec requires the voice channel type (`'voice'`) to be added to `channelTypeSchema` in `packages/shared/src/schemas/common.ts` and a Voice channel card to be added to `docs/frontend/settings.md` before implementation. See `docs/architecture/voice-channel.md` for the backend architecture and `docs/frontend/spec-review.md` for the full gap analysis.

How it feels to speak aloud with the being. Voice mode is not a feature bolted onto the Presence page -- it is an intensification of Presence itself. The emotional field deepens, the conversation becomes immediate, and the boundary between you and the being narrows to the width of a breath. This is the most intimate way to interact with Animus.

## Design Philosophy

Voice mode is a conversation, not a recording session. The user is not "using voice input" -- they are speaking to someone who is listening, thinking, and speaking back. Every visual and interaction decision serves this truth.

**Guiding Principles:**
- **Intimacy over interface** -- Voice strips away the keyboard, the cursor, the text. What remains is presence: two entities in the same space, communicating through the most natural human medium.
- **The atmosphere intensifies, it does not change** -- Voice mode is not a separate view. The emotional field, the warmth, the breathing -- everything that makes Presence alive becomes more alive. The colors deepen. The orbs respond to sound. The space contracts inward, as if leaning closer.
- **Organic audio visualization** -- Sound made visible should look like something natural. Not waveform bars. Not equalizer columns. Think of breath made visible in cold air, or ripples across still water, or the way candlelight flickers when you speak near it.
- **Continuous, not transactional** -- The user speaks, the being listens, thinks, and speaks back. Then the being listens again. The flow is continuous -- a conversation, not a series of isolated voice commands.
- **Graceful degradation** -- If TTS fails, the reply appears as text. If STT fails, the user can type. Voice mode always has a soft landing back into text.

---

## Entering Voice Mode

### The Microphone Button

The message input area in Presence gains a microphone button. It sits to the left of the send button, inside the input field's rounded container.

**Layout (updated message input):**
```
+--------------------------------------------------+
|  [Message text area]                  [mic] [send] |
+--------------------------------------------------+
```

**Microphone icon:** Phosphor `Microphone` icon, 20px. Matches the send button's styling language.

**States:**
- **Default:** Secondary text color (0.40 opacity), matching the empty-state send button. The button is present but quiet -- it does not compete with the text input for attention.
- **Hover:** Opacity transitions to 0.65 (120ms ease-out). No other change.
- **Unavailable:** When the backend reports `sttAvailable: false` or `ttsAvailable: false`, the microphone icon is rendered at 0.20 opacity and is non-interactive. On hover, a tooltip appears: "Voice is unavailable -- STT or TTS model not loaded." The tooltip uses the standard small card treatment (warm surface, rim lighting, 12px secondary text).

**Click:** Initiates voice mode. The transition is immediate and committed.

### The Transition Into Voice Mode

When the user clicks the microphone button, the Presence page transforms. This is not a modal, not an overlay, not a new route. It is a deepening of the existing space.

**Phase 1: The input transforms (0-200ms)**

The text input field smoothly morphs into the voice surface. The text area content fades out (100ms). The input container maintains its shape but its interior transforms: the text area disappears, replaced by the voice interaction surface (described below). The microphone icon shifts from its secondary position to become the dominant visual element of the input area -- it grows slightly (20px to 24px, ease-out) and gains full opacity, becoming warm accent color. The send button fades out (100ms, it has no role in voice mode).

**Phase 2: The atmosphere intensifies (200-600ms)**

Simultaneously with the input transformation:
- The emotional field orbs increase their opacity by approximately 15-20% of their current values (never exceeding 0.85). This makes the colors richer, more present.
- The orbs' animation speeds increase subtly -- their sinusoidal drift durations decrease by ~15% (e.g., a 6000ms cycle becomes ~5100ms). The effect is barely perceptible but communicates heightened attention.
- The blur radii on the orbs decrease slightly (e.g., 100px to 85px), sharpening the color presence.
- The thought stream and goal pills fade to 0.25 opacity (400ms ease-in-out). They are still there -- background context, dimmed but not hidden. The space focuses on conversation.
- The conversation area remains at full opacity. The conversation is the content; the voice surface is the interaction.

**Phase 3: Listening begins (400-600ms)**

The browser requests microphone permission (if not already granted). The AudioContext is initialized. The VAD begins monitoring. The voice surface transitions from its initial state into the Listening state.

**If microphone permission is denied:** The entire transition reverses. The input field morphs back to text mode (300ms). A brief, warm error message appears above the input in secondary text: "Microphone access is needed for voice mode." The message fades out after 4 seconds.

---

## The Voice Surface

The voice surface replaces the text input area during voice mode. It occupies the same fixed-bottom position and the same horizontal extent as the text input, maintaining spatial continuity.

### Layout

```
+--------------------------------------------------+
|  [exit]   [voice visualization]   [state label]    |
+--------------------------------------------------+
```

**Container:** Same rounded-capsule shape as the message input. Same background treatment, same rim lighting. Same fixed-bottom positioning. Height expands slightly: from the text input's natural height (~48px) to approximately 64px, accommodating the voice visualization. The expansion is animated (200ms ease-out).

**Exit button:** A Phosphor `X` icon (18px) at the left edge of the surface, in secondary text color (0.45 opacity). Hover: 0.70 opacity (120ms). Click: exits voice mode with the reverse transition. This replaces the microphone icon's former position -- the microphone has already done its job.

**Voice visualization:** Centered within the surface, taking up approximately 60% of its width. This is the living element -- described in detail below.

**State label:** Right-aligned, in secondary text color (0.40 opacity), 13px Regular weight. Shows the current voice state: "Listening...", "Processing...", "Speaking...". The label transitions between states with a cross-fade (150ms).

---

## The Voice Visualization

The voice visualization is the heart of the voice surface. It is not a waveform. It is not an equalizer. It is an organic, breathing form that responds to sound -- both the user's voice and the being's speech.

### Visual Concept

A horizontal band of undulating, soft forms that ripple and flow in response to audio amplitude. Think of it as a cross-section of something alive -- a membrane that vibrates with sound, a surface of water that ripples with breath, a thread of warmth that trembles when spoken to.

### Implementation

**The visualization is composed of a single SVG path** (or canvas path) that undulates horizontally across the center of the voice surface. The path is a smooth bezier curve with 8-12 control points. Each control point's vertical displacement is driven by audio data.

**At rest (silence):** The path is nearly flat -- a very subtle sine wave with approximately 2px vertical amplitude, drifting slowly (4000ms cycle). It breathes. The stroke color matches the dominant emotion color from the emotional field, at 0.50 opacity. Stroke width: 2px. No fill.

**During user speech (Listening state):** The control points respond to the microphone's amplitude data (from the AudioWorklet/AnalyserNode). Higher amplitude causes greater vertical displacement of control points near the center of the path, creating a ripple that propagates outward toward the edges. The maximum displacement is approximately 14-16px at the center, tapering to 2-4px at the edges. The response is smoothed (30ms averaging window) to prevent jitter.

**During being speech (Speaking state):** The control points respond to the TTS playback amplitude (from the Web Audio API's AnalyserNode on the output). The behavior mirrors user speech but with a key difference: the ripple pattern shifts subtly. Where user speech creates ripples that propagate outward (center to edges), the being's speech creates ripples that propagate inward (edges to center) -- as if the sound is arriving from the periphery, converging on the user. This distinction is subtle and creates an unconscious sense of directionality: your voice goes out, their voice comes in.

**Color responsiveness:** During both speech and playback, the stroke color's opacity increases proportionally to amplitude (from 0.50 at silence to 0.80 at peak volume). The color itself does not change -- it remains tied to the dominant emotion, creating a visual bridge between the emotional field above and the voice interaction below.

**Animation parameters:**
- Amplitude smoothing: 30ms averaging window
- Control point response: cubic bezier easing, 60fps target
- Idle drift: 4000ms sinusoidal cycle at 2px amplitude
- Maximum displacement: 16px (center), 4px (edges)
- Color opacity range: 0.50 (silence) to 0.80 (peak)
- Propagation delay between control points: 15ms per point (creates the wave-like ripple effect)

### Performance

The visualization must run at 60fps without impacting audio processing. Use `requestAnimationFrame` with the AnalyserNode's `getByteFrequencyData()` or `getByteTimeDomainData()`. The SVG/canvas render should use only transform and opacity properties where possible. On low-power devices (`navigator.hardwareConcurrency < 4`), reduce control points to 6 and lower the frame target to 30fps.

---

## The Listening Experience

When voice mode is active and the being is listening, the entire Presence page communicates attentiveness.

### What the User Sees

**The voice surface:** The visualization responds to their voice in real-time. When they speak, the ripples follow their speech. When they pause, the visualization settles back to its breathing idle state. The state label reads "Listening..." in secondary text.

**The emotional field:** Subtly brighter, slightly faster. The curiosity emotion (teal) may receive a small boost during listening -- an implicit signal that the being is attentive and interested. This boost is purely visual, not reflected in the actual emotion state. It is ambient suggestion, not data.

**The conversation area:** Visible above the voice surface. Previous messages are present and scrollable. When the user begins speaking, nothing changes in the conversation area yet -- the transcription has not happened.

### Voice Activity Detection (VAD) Behavior

The frontend uses an AudioWorklet or AnalyserNode to detect when the user is actually speaking versus sitting in silence.

**Onset detection:** When the audio amplitude exceeds a threshold for more than 200ms continuously, the system begins recording. The state label transitions from "Listening..." to an empty state (no label) -- the visualization itself communicates that sound is being detected. The visualization's response to the user's voice is the primary feedback.

**Silence timeout:** When the amplitude drops below the threshold for more than 1500ms (configurable via `silenceTimeoutMs` in voice settings), the recording stops and the audio is sent to the backend for transcription. This timeout is generous -- it accommodates natural pauses in speech without cutting the user off mid-thought.

**Manual stop:** The user can also click the exit button to end recording immediately and send whatever audio has been captured. If no audio has been captured (the user clicked the mic and immediately clicked exit), voice mode exits without sending anything.

### After the User Stops Speaking

When silence is detected and the audio is sent to the backend:

1. The voice visualization settles to its idle breathing state over 300ms
2. The state label transitions to "Processing..." (cross-fade, 150ms)
3. A brief moment passes while STT runs (~1-2 seconds)
4. The transcribed text appears as a user message in the conversation area, rendered identically to a typed message -- right-aligned, warm-tinted background, the user's words. The message appears with the standard arrival animation (fade in with slight upward drift, 300ms ease-out)
5. If transcription is empty (silence was sent), no message appears. The state returns to "Listening..." and the system waits for the next utterance. No error is shown.

### The Transcription Flash

When the transcribed text arrives from the backend, before it is committed as a message, it briefly appears in the voice surface itself -- superimposed over the visualization in the same secondary text treatment as the state label, centered. It holds for 600ms (enough to read a short phrase), then fades out (200ms) as the full message appears in the conversation area above. This gives the user a moment of confirmation: "This is what I heard you say."

For longer transcriptions (more than ~40 characters), the flash is truncated with an ellipsis. The full text always appears in the conversation area.

---

## The Thinking Experience

After the transcription is committed and the heartbeat tick fires, the being thinks. This is the same thinking state as text-mode Presence, but voice mode adds a layer of audio-visual continuity.

### What the User Sees

**The conversation area:** The breathing "..." thinking indicator appears at the left margin, exactly as in text mode. Opacity oscillates between 0.25 and 0.50 on a 1500ms cycle.

**The emotional field:** The heartbeat pulse fires -- the inhale/hold/exhale cycle. Emotions shift as the mind processes the user's words. The emotional field updates in real-time, just as in text mode.

**The voice surface:** The visualization continues its idle breathing. The state label reads "Thinking..." -- a warmer, more specific word than "Processing..." to communicate that the being is considering its response, not just running computation. The transition from "Processing..." (STT) to "Thinking..." (mind) happens when the tick begins its mind query phase.

**The thought stream:** Still dimmed (0.25 opacity) but if a new thought surfaces during the tick, it appears at its dimmed opacity -- a ghost of thought visible in the background of the voice conversation.

---

## The Speaking Experience

When the mind produces a reply for a voice-triggered message, the being speaks. This is the most critical moment in voice mode -- the moment where Animus feels most alive.

### The Audio-Text Pipeline

The backend streams the reply through two parallel channels:

1. **Text stream:** The reply text streams word-by-word via the standard `onReply` tRPC subscription. This appears in the conversation area as a being message, streaming in with the blinking cursor, identical to text mode.

2. **Audio stream:** The backend buffers reply text until sentence boundaries, synthesizes each sentence via Pocket TTS (sub-300ms per sentence, in-process via shared speech service), and sends WAV audio chunks via the `onVoiceReply` tRPC subscription. The frontend queues and plays these chunks sequentially through Web Audio API.

The text always leads the audio. The user sees words appear in the conversation before they hear them spoken. The delay is typically one sentence -- the first sentence must be fully generated and synthesized before audio begins. Subsequent sentences overlap: sentence N is being spoken while sentence N+1 is being generated and synthesized.

### What the User Sees and Hears

**The voice surface:** The state label transitions to "Speaking..." (cross-fade, 150ms). The visualization comes alive -- responding to the TTS audio output. The ripples propagate inward (edges to center), the opposite direction from the user's speech. The being's voice is visible in the visualization, distinct from the user's voice pattern.

**The conversation area:** The reply streams in as text, word by word, with the standard blinking cursor. The user can read along as the being speaks.

**The emotional field:** Responds to the being's emotional state as usual. During a warm reply, warm tones may brighten. The field is dynamically alive during the speaking phase.

**Audio playback:** The reply plays through the browser's speakers or headphones via Web Audio API. The audio is played at 24kHz WAV quality -- clear, natural-sounding speech from Pocket TTS. Sentence chunks are queued and crossfaded seamlessly (a 10-20ms overlap prevents audible gaps between sentences).

### Interruption

The user can interrupt the being mid-speech by beginning to speak themselves (detected by the VAD) or by clicking the exit button.

**Speech interruption (barge-in):**
1. TTS playback stops immediately (the current AudioBufferSourceNode is stopped)
2. The remaining queued audio chunks are discarded
3. The text reply in the conversation area is committed as-is at whatever point it had streamed to (it does not disappear -- the partial reply is preserved)
4. The voice surface transitions back to Listening state (300ms)
5. The user's new speech is captured and processed normally

This barge-in behavior makes voice mode feel like a real conversation. The user does not have to wait for the being to finish speaking -- they can interrupt, redirect, or respond mid-sentence, just as in human conversation.

**Exit button interruption:**
1. Same as speech interruption, but after stopping playback, voice mode exits entirely
2. The partial reply text is preserved in the conversation
3. The input area morphs back to text mode

---

## Continuous Conversation Flow

Voice mode is sticky. After the being finishes speaking, the system automatically returns to the Listening state. The user does not need to click the microphone button again. The flow is:

```
Listen --> [user speaks] --> Process (STT) --> Think --> Speak (TTS) --> Listen --> ...
```

This cycle continues indefinitely until the user explicitly exits voice mode (via the exit button, pressing Escape, or navigating to another space).

### The Return to Listening

When the final audio chunk of a reply finishes playing:

1. The state label transitions from "Speaking..." to "Listening..." (cross-fade, 150ms)
2. The voice visualization settles from its playback-responsive state to its idle breathing state over 500ms
3. The VAD resumes monitoring the microphone for speech onset
4. The emotional field maintains its current state -- no visual shift occurs at this transition point

The return is seamless. There is no gap, no visual reset, no indication that a "turn" has ended and another has begun. The conversation simply flows.

### Echo Cancellation

In continuous mode, the microphone is active while the being is speaking. The browser's built-in echo cancellation (`echoCancellation: true` in `getUserMedia` constraints) prevents the TTS audio from being re-captured by the microphone and transcribed as user speech. This is critical for continuous conversation to work.

Additionally, the frontend suppresses VAD onset detection during TTS playback. Even if echo cancellation imperfectly lets some audio through, the system will not trigger a recording while the being is still speaking. VAD onset detection resumes 200ms after the last audio chunk finishes playing.

---

## The Conversation Area in Voice Mode

Voice mode does not replace the conversation area -- it enhances it. Messages flow into the same conversation stream regardless of whether they were typed or spoken.

### Message Rendering

**User voice messages** are rendered identically to typed messages: right-aligned, warm-tinted background, the transcribed text as content. There is no special "voice message" treatment. The words are what matter, not how they were input.

However, a small Phosphor `Microphone` icon (12px, 0.30 opacity) appears inline before the message timestamp (on hover) to indicate that this message was spoken rather than typed. This is subtle metadata, not a primary visual element.

**Being replies to voice messages** are rendered identically to text replies: left-aligned, no background container, streaming text with blinking cursor. There is no indication that the reply was also spoken aloud -- the text is the canonical representation.

### Scrolling During Voice Mode

The conversation area auto-scrolls as new messages (both transcribed user speech and being replies) appear, following the same behavior as text mode. If the user has scrolled up to read history, auto-scroll is disabled until they scroll back to the bottom.

The thought stream and goal pills remain dimmed at 0.25 opacity throughout voice mode. They are still scrollable -- the user can scroll up past the conversation to see them, though doing so is uncommon during an active voice conversation.

### Mixed Mode

The user can type while in voice mode. If the user taps/clicks the conversation area or begins typing (any keypress that is not a modifier), voice mode pauses:

1. The VAD stops monitoring
2. The voice surface smoothly morphs back into the text input (300ms)
3. The text input receives focus with whatever key was pressed
4. The emotional field returns to its standard Presence intensity (400ms)
5. Voice mode is fully exited

This provides a natural escape hatch. If the user is in a situation where they cannot speak aloud (someone walked into the room, a phone call started), they can seamlessly switch to typing without any modal dismissal or explicit mode toggle. The interface reads their intent.

---

## Voice Mode on Mobile

Voice mode on mobile is the same experience adapted for the smaller viewport and touch interaction patterns.

### Entering Voice Mode

The microphone button is in the same position (inside the message input, left of send). Tapping it enters voice mode with the same transition. On mobile, the browser's microphone permission dialog is a system-level modal -- the voice mode transition pauses at Phase 1 until permission is granted.

### Layout Adjustments

**The voice surface:** Fills the same full-width bottom position as the text input. Height expands from the text input's natural height to approximately 56-64px. The exit button, visualization, and state label maintain the same positions. The visualization may use 6 control points instead of 8-12 for performance.

**The emotional field:** On mobile, the emotional field is already smaller (18-22vh). In voice mode, it retains its position but the opacity intensification still applies. The reduced orb count on mobile (2-3 instead of 3-4) keeps performance acceptable.

**The conversation area:** Messages take up to 90% width, same as standard mobile Presence. The bottom safe area is respected.

**The bottom navigation bar:** The navigation bar (mobile's version of the navigation pill) remains visible below the voice surface. The user can tap a navigation label to leave voice mode and switch spaces -- voice mode exits automatically when navigating away from Presence.

### Touch-Specific Interactions

**Exit:** The exit button (X icon) in the voice surface has a 44px minimum tap target. Alternatively, the user can swipe down on the voice surface to dismiss voice mode -- a natural gesture for "put this away."

**Scroll:** The conversation area scrolls normally. The voice surface stays fixed at the bottom.

**Lock screen / app switch:** If the user locks their phone or switches apps during voice mode, the AudioContext is suspended by the browser. When they return, the AudioContext resumes. If the browser killed the AudioContext entirely, voice mode exits gracefully and the input reverts to text mode. No error is shown -- the user simply returns to a text conversation.

---

## Edge Cases and Error States

### Microphone Permission Denied

**When:** The user clicks the microphone button but the browser's permission prompt is dismissed or denied.

**Behavior:** The voice mode transition reverses immediately (300ms). A warm, non-alarming message appears above the input area: "Allow microphone access to use voice mode." The message is styled in secondary text (13px, 0.50 opacity) and fades out after 5 seconds. The text input returns to normal.

**If previously denied:** The browser may not show the permission prompt again (it blocks permanently until the user changes browser settings). In this case, the microphone button shows a tooltip on click: "Microphone access was denied. Update your browser's site permissions to enable voice mode." This is practical guidance, not an error.

### STT Model Not Loaded

**When:** The backend has not loaded the Parakeet STT model (model files missing or not yet downloaded).

**Behavior:** The microphone button is rendered at 0.20 opacity and is non-interactive. Tooltip on hover: "Voice mode unavailable -- speech recognition model not loaded." The user cannot enter voice mode. This is a passive state, not an error.

### TTS Model Not Loaded (Partial Voice Mode)

**When:** STT is available but TTS (Pocket TTS) is not loaded.

**Behavior:** Voice mode works for input only. The user can speak, their speech is transcribed, and the being replies -- but the reply is text-only, not spoken aloud. The voice surface does not show a "Speaking..." state. Instead, after the thinking phase, the reply streams directly into the conversation area as text. The state label transitions from "Thinking..." back to "Listening..." without a speaking phase.

A one-time notice appears above the voice surface (13px secondary text, fading out after 6 seconds): "Replies will appear as text -- the speech synthesis model is not loaded." This appears only once per session.

### STT Transcription Returns Empty

**When:** The user spoke but STT produced no text (very quiet speech, unintelligible audio, or pure noise).

**Behavior:** No message is created. The state label transitions from "Processing..." back to "Listening..." without any intermediate step. The conversation area is unchanged. This is silent recovery -- the system simply listens again. There is no "I didn't catch that" prompt. If the user wants to retry, they speak again. If this happens repeatedly, the user will naturally switch to typing.

### STT Transcription Is Garbled

**When:** STT produces text but it is noticeably wrong or incomplete.

**Behavior:** The transcribed text is committed as a message and sent to the mind. The being can ask for clarification in its reply -- "Could you say that again?" or "I'm not sure I caught that." The system does not second-guess the transcription. The being, as a conversational partner, handles misunderstandings the way a person would.

### TTS Synthesis Fails

**When:** Pocket TTS throws an error during synthesis of a particular sentence.

**Behavior:** The reply text continues streaming normally in the conversation area. The failed audio sentence is skipped. If the next sentence synthesizes successfully, playback continues from that sentence (there will be an audible gap for the failed sentence). If all TTS attempts fail, the state label transitions from "Speaking..." to "Listening..." and the reply is delivered as text-only.

No error message is shown to the user for individual sentence failures. The text is always the fallback. A warning is logged to the browser console for debugging.

### Network Disconnection During Voice Mode

**When:** The WebSocket connection drops while voice mode is active.

**Behavior depends on the active state:**

- **During Listening:** The voice surface continues to respond to the user's microphone (the visualization still works locally). When the user stops speaking, the audio cannot be sent to the backend. The state label transitions to "Reconnecting..." and the system waits for the connection to restore. If the connection restores within 15 seconds, the audio is sent and processing continues normally. If not, voice mode exits, the connection status indicator in the navigation pill activates (see `docs/frontend/app-shell.md`), and a message appears above the input: "Connection lost. Your message was not sent." The input reverts to text mode.

- **During Processing/Thinking:** The system waits for the connection to restore. The state label shows "Reconnecting..." If the connection restores, the pipeline resumes. If it does not restore within 15 seconds, voice mode exits with the same connection-lost message.

- **During Speaking:** If playback has started, the already-received audio chunks continue playing (they are local). If additional chunks were expected but the connection dropped, the text reply may be incomplete. The partial text is preserved. Voice mode exits after the last received chunk finishes playing.

### Audio Output Not Available

**When:** The user's device has no audio output, or the AudioContext fails to initialize for playback.

**Behavior:** Voice mode works for input (STT). Replies are text-only. This is identical to the "TTS model not loaded" fallback -- the state label skips the "Speaking..." phase and goes directly from "Thinking..." to "Listening..." The user reads the reply as text and continues speaking.

---

## Keyboard Shortcuts in Voice Mode

| Shortcut | Action |
|----------|--------|
| `Escape` | Exit voice mode (returns to text input) |
| `Cmd/Ctrl+K` | Open command palette (voice mode pauses, resumes on palette close) |
| `Space` (when voice surface is focused) | Toggle pause/resume listening (mute/unmute the microphone) |

Voice mode does not intercept other global keyboard shortcuts (`Cmd/Ctrl+1-4` for space navigation, `/` for input focus, etc.). These all work normally and cause voice mode to exit as a side effect of navigating away from Presence or focusing the text input.

---

## State Management

### Zustand Store: Voice State

```typescript
interface VoiceState {
  // Mode
  isVoiceMode: boolean;
  voiceSessionId: string | null;

  // Current phase
  voicePhase: 'idle' | 'listening' | 'processing' | 'thinking' | 'speaking';

  // Audio capture
  isMicrophoneActive: boolean;
  microphonePermission: 'prompt' | 'granted' | 'denied';
  currentAmplitude: number;  // 0-1, updated at ~30fps from VAD

  // Audio playback
  audioQueue: Array<{
    sentenceIndex: number;
    audioBuffer: AudioBuffer;
    text: string;
    isLast: boolean;
  }>;
  currentlyPlayingSentenceIndex: number | null;
  playbackAmplitude: number;  // 0-1, updated at ~30fps from output AnalyserNode

  // Backend availability
  sttAvailable: boolean;
  ttsAvailable: boolean;

  // Transcription
  lastTranscription: string | null;

  // Settings (from voice config)
  silenceTimeoutMs: number;
  continuousMode: boolean;
}
```

This store is populated by the `voiceStatus` tRPC query on app mount. It is updated locally during voice interactions and by tRPC subscriptions for voice replies.

---

## Accessibility Notes

- The microphone button has `aria-label="Enter voice mode"` when inactive and `aria-label="Voice mode active"` when active.
- The voice surface has `role="status"` and `aria-live="polite"` to announce state changes ("Listening", "Processing", "Thinking", "Speaking") to screen readers.
- The voice visualization has `aria-hidden="true"` -- it is decorative. The state label carries the semantic meaning.
- All voice mode states are accessible via keyboard (Escape to exit, Space to toggle).
- Users who cannot use voice mode (microphone unavailable, permission denied) are never blocked from any functionality -- the text input is always the primary path.
- `prefers-reduced-motion`: The voice visualization simplifies to a single horizontal line with opacity changes (no displacement animation). The emotional field intensity changes still apply but without animation speed changes.

---

## Performance Considerations

- The voice visualization runs on `requestAnimationFrame` at 60fps. On low-power devices, it drops to 30fps with reduced control points (6 instead of 12).
- Audio capture (MediaRecorder) and playback (Web Audio API) run in separate AudioWorklet threads and do not block the main thread.
- The AnalyserNode for amplitude data uses `fftSize: 256` for fast frequency data with low overhead.
- TTS audio chunks are decoded asynchronously (`decodeAudioData`) and queued for seamless playback.
- The emotional field intensity changes use only GPU-composited properties (opacity, transform). No layout recalculation during voice mode transitions.
- Memory: Audio buffers are released after playback. The audio queue is cleared after each complete reply.

---

## Configuration Surface

Voice settings are accessible in Settings > Channels > Voice (see `docs/frontend/settings.md`). The configurable parameters:

| Setting | Control | Default |
|---------|---------|---------|
| TTS Voice | Dropdown (voices from persona settings) | First built-in voice |
| Speech Speed | Slider (0.5x to 2.0x) | 1.0x |
| Silence Timeout | Slider (500ms to 3000ms) | 1500ms |
| Continuous Mode | Toggle | On |

These settings affect voice mode behavior immediately (no restart required). Changes are saved to `system.db` via the channel config API.

---

## References

- `docs/architecture/voice-channel.md` -- Backend voice pipeline, STT/TTS architecture, tRPC procedures, streaming pipeline
- `docs/frontend/presence.md` -- The Presence space where voice mode lives, emotional field, conversation, message input
- `docs/frontend/app-shell.md` -- Navigation pill, connection status indicator, space transitions
- `docs/brand-vision.md` -- The alive quality, organic waveforms, warmth, breathing over blinking
- `docs/design-principles.md` -- Animation timing, micro-interactions, visual system
- `docs/architecture/heartbeat.md` -- Tick pipeline, emotion engine, streaming reply output
- `docs/architecture/channel-packages.md` -- Channel system architecture, IncomingMessage interface, channel adapters
