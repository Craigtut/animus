use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use std::sync::Arc;

/// Opaque voice state handle — holds the KV-cache state produced by
/// encoding a reference WAV through the Mimi encoder + FlowLM prompting.
#[napi]
pub struct VoiceState {
    inner: Arc<pocket_tts::ModelState>,
}

/// Native Pocket TTS model loaded via napi-rs.
///
/// All CPU-intensive methods use `tokio::task::spawn_blocking` so they
/// never block the Node.js event loop. `TTSModel` is `Clone` (Arc-based
/// internals) making it safe for concurrent async use.
#[napi]
pub struct PocketTTS {
    model: pocket_tts::TTSModel,
}

#[napi]
impl PocketTTS {
    /// Load model from a directory containing:
    ///   - b6369a24.yaml        (config)
    ///   - tts_b6369a24.safetensors  (weights)
    ///   - tokenizer.model      (SentencePiece tokenizer)
    #[napi(factory)]
    pub async fn load(model_dir: String) -> Result<Self> {
        let model = tokio::task::spawn_blocking(move || -> std::result::Result<pocket_tts::TTSModel, String> {
            let config_path = format!("{}/b6369a24.yaml", model_dir);
            let weights_path = format!("{}/tts_b6369a24.safetensors", model_dir);
            let tokenizer_path = format!("{}/tokenizer.model", model_dir);

            let config = std::fs::read(&config_path)
                .map_err(|e| format!("Failed to read config {}: {}", config_path, e))?;
            let weights = std::fs::read(&weights_path)
                .map_err(|e| format!("Failed to read weights {}: {}", weights_path, e))?;
            let tokenizer = std::fs::read(&tokenizer_path)
                .map_err(|e| format!("Failed to read tokenizer {}: {}", tokenizer_path, e))?;

            pocket_tts::TTSModel::load_from_bytes(&config, &weights, &tokenizer)
                .map_err(|e| format!("Failed to load TTS model: {}", e))
        })
        .await
        .map_err(|e| Error::from_reason(format!("Task join error: {}", e)))?
        .map_err(|e| Error::from_reason(e))?;

        Ok(Self { model })
    }

    /// Load model from in-memory buffers (no filesystem access).
    #[napi(factory)]
    pub async fn load_from_buffers(
        config_yaml: Buffer,
        weights: Buffer,
        tokenizer: Buffer,
    ) -> Result<Self> {
        let config_vec = config_yaml.to_vec();
        let weights_vec = weights.to_vec();
        let tokenizer_vec = tokenizer.to_vec();

        let model = tokio::task::spawn_blocking(move || -> std::result::Result<pocket_tts::TTSModel, String> {
            pocket_tts::TTSModel::load_from_bytes(&config_vec, &weights_vec, &tokenizer_vec)
                .map_err(|e| format!("Failed to load TTS model: {}", e))
        })
        .await
        .map_err(|e| Error::from_reason(format!("Task join error: {}", e)))?
        .map_err(|e| Error::from_reason(e))?;

        Ok(Self { model })
    }

    /// Create a voice state from WAV file bytes (zero-shot voice cloning).
    ///
    /// Internally: reads WAV, resamples to 24kHz, encodes through Mimi,
    /// projects through speaker projection, runs FlowLM prompting to
    /// prime the KV cache. The returned `VoiceState` is reusable across
    /// multiple `generate()` calls.
    #[napi]
    pub async fn create_voice_state(&self, wav_bytes: Buffer) -> Result<VoiceState> {
        let model = self.model.clone();
        let bytes = wav_bytes.to_vec();

        let state = tokio::task::spawn_blocking(move || -> std::result::Result<pocket_tts::ModelState, String> {
            model
                .get_voice_state_from_bytes(&bytes)
                .map_err(|e| format!("Failed to create voice state: {}", e))
        })
        .await
        .map_err(|e| Error::from_reason(format!("Task join error: {}", e)))?
        .map_err(|e| Error::from_reason(e))?;

        Ok(VoiceState {
            inner: Arc::new(state),
        })
    }

    /// Generate audio from text — returns Float32Array of samples at 24kHz mono.
    #[napi]
    pub async fn generate(&self, text: String, voice: &VoiceState) -> Result<Float32Array> {
        let model = self.model.clone();
        let voice_state = Arc::clone(&voice.inner);

        let samples = tokio::task::spawn_blocking(move || -> std::result::Result<Vec<f32>, String> {
            let audio = model
                .generate(&text, &voice_state)
                .map_err(|e| format!("Generation failed: {}", e))?;

            // Tensor is [C, T] after squeeze — flatten to 1-D f32 vec
            let flat = audio
                .flatten_all()
                .map_err(|e| format!("Flatten failed: {}", e))?;
            flat.to_vec1::<f32>()
                .map_err(|e| format!("to_vec1 failed: {}", e))
        })
        .await
        .map_err(|e| Error::from_reason(format!("Task join error: {}", e)))?
        .map_err(|e| Error::from_reason(e))?;

        Ok(Float32Array::new(samples))
    }

    /// Streaming generation — returns an array of Float32Array chunks.
    ///
    /// Each chunk corresponds to one Mimi decoder frame (~13ms of audio).
    /// Useful for progressive playback or measuring generation progress.
    #[napi]
    pub async fn generate_stream(
        &self,
        text: String,
        voice: &VoiceState,
    ) -> Result<Vec<Float32Array>> {
        let model = self.model.clone();
        let voice_state = Arc::clone(&voice.inner);

        let chunks = tokio::task::spawn_blocking(
            move || -> std::result::Result<Vec<Vec<f32>>, String> {
                let mut result = Vec::new();
                for chunk in model.generate_stream(&text, &voice_state) {
                    let tensor = chunk.map_err(|e| format!("Stream chunk error: {}", e))?;
                    let flat = tensor
                        .flatten_all()
                        .map_err(|e| format!("Flatten failed: {}", e))?;
                    let samples = flat
                        .to_vec1::<f32>()
                        .map_err(|e| format!("to_vec1 failed: {}", e))?;
                    result.push(samples);
                }
                Ok(result)
            },
        )
        .await
        .map_err(|e| Error::from_reason(format!("Task join error: {}", e)))?
        .map_err(|e| Error::from_reason(e))?;

        Ok(chunks
            .into_iter()
            .map(Float32Array::new)
            .collect())
    }

    /// Streaming generation with per-chunk callback.
    ///
    /// Calls `callback(Float32Array)` for each ~13ms audio chunk as it is
    /// generated, then sends an empty `Float32Array` as a completion sentinel.
    /// If the callback returns an error (JS side aborted), iteration stops.
    ///
    /// Runs on a dedicated OS thread to avoid blocking the tokio pool.
    #[napi]
    pub fn generate_stream_cb(
        &self,
        text: String,
        voice: &VoiceState,
        #[napi(ts_arg_type = "(err: null | Error, chunk: Float32Array) => void")]
        callback: JsFunction,
    ) -> Result<()> {
        let tsfn: ThreadsafeFunction<Vec<f32>, ErrorStrategy::CalleeHandled> = callback
            .create_threadsafe_function(0, |ctx| Ok(vec![Float32Array::new(ctx.value)]))?;

        let model = self.model.clone();
        let voice_state = Arc::clone(&voice.inner);

        std::thread::spawn(move || {
            for chunk in model.generate_stream(&text, &voice_state) {
                match chunk {
                    Ok(tensor) => {
                        let flat = match tensor.flatten_all() {
                            Ok(f) => f,
                            Err(e) => {
                                let _ = tsfn.call(
                                    Err(Error::from_reason(format!("Flatten failed: {}", e))),
                                    ThreadsafeFunctionCallMode::Blocking,
                                );
                                return;
                            }
                        };
                        let samples = match flat.to_vec1::<f32>() {
                            Ok(s) => s,
                            Err(e) => {
                                let _ = tsfn.call(
                                    Err(Error::from_reason(format!("to_vec1 failed: {}", e))),
                                    ThreadsafeFunctionCallMode::Blocking,
                                );
                                return;
                            }
                        };
                        let status = tsfn.call(Ok(samples), ThreadsafeFunctionCallMode::Blocking);
                        if status != napi::Status::Ok {
                            // JS side aborted — stop generating
                            return;
                        }
                    }
                    Err(e) => {
                        let _ = tsfn.call(
                            Err(Error::from_reason(format!("Stream chunk error: {}", e))),
                            ThreadsafeFunctionCallMode::Blocking,
                        );
                        return;
                    }
                }
            }
            // Send empty sentinel to signal completion
            let _ = tsfn.call(Ok(vec![]), ThreadsafeFunctionCallMode::Blocking);
        });

        Ok(())
    }

    /// Audio sample rate — always 24000 Hz.
    #[napi(getter)]
    pub fn sample_rate(&self) -> u32 {
        self.model.sample_rate as u32
    }
}
