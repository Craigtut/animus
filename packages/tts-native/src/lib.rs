use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use ptts::tts_model::{MimiEnc, TTSConfig, TTSModel, prepare_text_prompt, split_into_best_sentences};
use std::sync::Arc;
use xn::nn::VB;
use xn::{CpuDevice, Tensor, Unquantized};

type Q = Unquantized<f32, CpuDevice>;
type State = ptts::tts_model::TTSState<Q>;
type MimiState = ptts::mimi::MimiDecoderState<f32, CpuDevice>;

const TEMPERATURE: f32 = 0.7;
const SEED: u64 = 4242424242424242;
const MAX_SEQ_BUDGET: usize = 4096;
const MIMI_CONTEXT: usize = 250;

struct SpTokenizer(sentencepiece::SentencePieceProcessor);

impl ptts::Tokenizer for SpTokenizer {
    fn encode(&self, text: &str) -> Vec<u32> {
        self.0.encode(text).unwrap_or_default().iter().map(|p| p.id).collect()
    }
    fn decode(&self, tokens: &[u32]) -> String {
        self.0.decode_piece_ids(tokens).unwrap_or_default()
    }
}

struct TtsRng {
    inner: Box<rand::rngs::StdRng>,
    distr: rand_distr::Normal<f32>,
}

impl TtsRng {
    fn new(temperature: f32, seed: u64) -> Self {
        use rand::SeedableRng;
        Self {
            inner: Box::new(rand::rngs::StdRng::seed_from_u64(seed)),
            distr: rand_distr::Normal::new(0f32, temperature.sqrt()).unwrap(),
        }
    }
}

impl ptts::flow_lm::Rng for TtsRng {
    fn sample(&mut self) -> f32 {
        use rand::Rng;
        self.inner.sample(self.distr)
    }
}

fn remap_key(name: &str) -> Option<String> {
    if name.contains("flow.w_s_t")
        || name.contains("quantizer.vq")
        || name.contains("quantizer.logvar_proj")
    {
        return None;
    }
    let mut name = name.to_string();
    name = name.replace(
        "flow_lm.condition_provider.conditioners.speaker_wavs.output_proj.weight",
        "flow_lm.speaker_proj_weight",
    );
    name = name.replace(
        "flow_lm.condition_provider.conditioners.transcript_in_segment.",
        "flow_lm.conditioner.",
    );
    name = name.replace("flow_lm.backbone.", "flow_lm.transformer.");
    name = name.replace("flow_lm.flow.", "flow_lm.flow_net.");
    name = name.replace("mimi.model.", "mimi.");
    Some(name)
}

fn pcm_decode(wav_bytes: &[u8]) -> std::result::Result<(Vec<f32>, u32), String> {
    use symphonia::core::audio::{AudioBufferRef, Signal};
    use symphonia::core::conv::FromSample;

    let cursor = std::io::Cursor::new(wav_bytes.to_vec());
    let mss = symphonia::core::io::MediaSourceStream::new(Box::new(cursor), Default::default());
    let hint = symphonia::core::probe::Hint::new();
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &Default::default(), &Default::default())
        .map_err(|e| format!("Failed to probe audio: {e}"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or("No supported audio tracks")?;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &Default::default())
        .map_err(|e| format!("Unsupported codec: {e}"))?;
    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(0);
    let mut pcm = Vec::new();

    while let Ok(packet) = format.next_packet() {
        while !format.metadata().is_latest() {
            format.metadata().pop();
        }
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet).map_err(|e| format!("Decode error: {e}"))? {
            AudioBufferRef::F32(buf) => pcm.extend(buf.chan(0)),
            AudioBufferRef::S16(data) => {
                pcm.extend(data.chan(0).iter().map(|v| f32::from_sample(*v)));
            }
            AudioBufferRef::S32(data) => {
                pcm.extend(data.chan(0).iter().map(|v| f32::from_sample(*v)));
            }
            AudioBufferRef::U8(data) => {
                pcm.extend(data.chan(0).iter().map(|v| f32::from_sample(*v)));
            }
            _ => return Err("Unsupported audio sample format".to_string()),
        }
    }
    Ok((pcm, sample_rate))
}

fn resample_pcm(pcm: &[f32], sr_in: usize, sr_out: usize) -> std::result::Result<Vec<f32>, String> {
    use rubato::Resampler;
    let mut out = Vec::with_capacity(
        (pcm.len() as f64 * sr_out as f64 / sr_in as f64) as usize + 1024,
    );
    let mut resampler = rubato::FftFixedInOut::<f32>::new(sr_in, sr_out, 1024, 1)
        .map_err(|e| format!("Resampler init failed: {e}"))?;
    let mut buf = resampler.output_buffer_allocate(true);
    let mut pos = 0;
    while pos + resampler.input_frames_next() < pcm.len() {
        let (in_len, out_len) = resampler
            .process_into_buffer(&[&pcm[pos..]], &mut buf, None)
            .map_err(|e| format!("Resample failed: {e}"))?;
        pos += in_len;
        out.extend_from_slice(&buf[0][..out_len]);
    }
    if pos < pcm.len() {
        let (_, out_len) = resampler
            .process_partial_into_buffer(Some(&[&pcm[pos..]]), &mut buf, None)
            .map_err(|e| format!("Resample partial failed: {e}"))?;
        out.extend_from_slice(&buf[0][..out_len]);
    }
    Ok(out)
}

struct ModelInner {
    model: TTSModel<Q>,
    mimi_enc: MimiEnc<Q>,
    cfg: TTSConfig,
    tokenizer: Arc<SpTokenizer>,
}

/// Opaque voice state handle — holds the FlowLM state with voice
/// conditioning pre-applied. Clonable for reuse across generations.
#[napi]
pub struct VoiceState {
    tts_state: State,
}

/// Native Pocket TTS model (xn-ptts backend) loaded via napi-rs.
///
/// All CPU-intensive methods use `tokio::task::spawn_blocking` so they
/// never block the Node.js event loop.
#[napi]
pub struct PocketTTS {
    inner: Arc<ModelInner>,
}

#[napi]
impl PocketTTS {
    /// Load model from a directory containing:
    ///   - tts_b6369a24.safetensors  (weights)
    ///   - tokenizer.model           (SentencePiece tokenizer)
    #[napi(factory)]
    pub async fn load(model_dir: String) -> Result<Self> {
        let inner = tokio::task::spawn_blocking(move || -> std::result::Result<ModelInner, String> {
            let weights_path = std::path::PathBuf::from(format!("{model_dir}/tts_b6369a24.safetensors"));
            let tokenizer_path = format!("{model_dir}/tokenizer.model");

            let cfg = TTSConfig::v202601(TEMPERATURE);

            let vb = VB::load_with_key_map(&[&weights_path], xn::CPU, remap_key)
                .map_err(|e| format!("Failed to load weights: {e}"))?;
            let root = vb.root();

            let sp = sentencepiece::SentencePieceProcessor::open(&tokenizer_path)
                .map_err(|e| format!("Failed to load tokenizer: {e}"))?;
            let tokenizer = Arc::new(SpTokenizer(sp));

            let sp2 = sentencepiece::SentencePieceProcessor::open(&tokenizer_path)
                .map_err(|e| format!("Failed to load tokenizer: {e}"))?;

            let model: TTSModel<Q> =
                TTSModel::load(&root, Box::new(SpTokenizer(sp2)), &cfg)
                    .map_err(|e| format!("Failed to load TTS model: {e}"))?;
            let mimi_enc: MimiEnc<Q> =
                MimiEnc::load(&root, &cfg)
                    .map_err(|e| format!("Failed to load MimiEnc: {e}"))?;

            Ok(ModelInner { model, mimi_enc, cfg, tokenizer })
        })
        .await
        .map_err(|e| Error::from_reason(format!("Task join error: {e}")))?
        .map_err(|e| Error::from_reason(e))?;

        Ok(Self { inner: Arc::new(inner) })
    }

    /// Load model from in-memory buffers (no filesystem access for weights).
    /// Tokenizer path is still required since SentencePiece needs a file.
    #[napi(factory)]
    pub async fn load_from_buffers(
        weights: Buffer,
        tokenizer_path: String,
    ) -> Result<Self> {
        let weights_vec = weights.to_vec();

        let inner = tokio::task::spawn_blocking(move || -> std::result::Result<ModelInner, String> {
            let cfg = TTSConfig::v202601(TEMPERATURE);

            let vb = VB::from_bytes_with_key_map(vec![weights_vec], xn::CPU, remap_key)
                .map_err(|e| format!("Failed to load weights from buffer: {e}"))?;
            let root = vb.root();

            let sp = sentencepiece::SentencePieceProcessor::open(&tokenizer_path)
                .map_err(|e| format!("Failed to load tokenizer: {e}"))?;
            let tokenizer = Arc::new(SpTokenizer(sp));

            let sp2 = sentencepiece::SentencePieceProcessor::open(&tokenizer_path)
                .map_err(|e| format!("Failed to load tokenizer: {e}"))?;

            let model: TTSModel<Q> =
                TTSModel::load(&root, Box::new(SpTokenizer(sp2)), &cfg)
                    .map_err(|e| format!("Failed to load TTS model: {e}"))?;
            let mimi_enc: MimiEnc<Q> =
                MimiEnc::load(&root, &cfg)
                    .map_err(|e| format!("Failed to load MimiEnc: {e}"))?;

            Ok(ModelInner { model, mimi_enc, cfg, tokenizer })
        })
        .await
        .map_err(|e| Error::from_reason(format!("Task join error: {e}")))?
        .map_err(|e| Error::from_reason(e))?;

        Ok(Self { inner: Arc::new(inner) })
    }

    /// Create a voice state from WAV file bytes (zero-shot voice cloning).
    ///
    /// Internally: decodes WAV, resamples to 24kHz, encodes through Mimi,
    /// projects through speaker projection, runs FlowLM prompting to
    /// prime the KV cache. The returned `VoiceState` is reusable across
    /// multiple `generate()` calls.
    #[napi]
    pub async fn create_voice_state(&self, wav_bytes: Buffer) -> Result<VoiceState> {
        let inner = Arc::clone(&self.inner);
        let bytes = wav_bytes.to_vec();

        let state = tokio::task::spawn_blocking(move || -> std::result::Result<State, String> {
            let (pcm, sr) = pcm_decode(&bytes)?;
            let target_sr = inner.cfg.mimi.sample_rate;
            let pcm = if (sr as usize) != target_sr {
                resample_pcm(&pcm, sr as usize, target_sr)?
            } else {
                pcm
            };
            // Trim to 10s max
            let pcm = if pcm.len() > target_sr * 10 {
                pcm[..target_sr * 10].to_vec()
            } else {
                pcm
            };

            let pcm_tensor: Tensor<f32, CpuDevice> =
                Tensor::from_vec(pcm, (1, 1, ()), &xn::CPU)
                    .map_err(|e| format!("Tensor creation failed: {e}"))?;
            let voice_emb = inner
                .mimi_enc
                .encode_audio(&pcm_tensor)
                .map_err(|e| format!("Voice encoding failed: {e}"))?;

            let mut tts_state = inner
                .model
                .init_flow_lm_state(1, MAX_SEQ_BUDGET)
                .map_err(|e| format!("State init failed: {e}"))?;
            inner
                .model
                .prompt_audio(&mut tts_state, &voice_emb)
                .map_err(|e| format!("Voice prompting failed: {e}"))?;

            Ok(tts_state)
        })
        .await
        .map_err(|e| Error::from_reason(format!("Task join error: {e}")))?
        .map_err(|e| Error::from_reason(e))?;

        Ok(VoiceState { tts_state: state })
    }

    /// Generate audio from text — returns Float32Array of samples at 24kHz mono.
    #[napi]
    pub async fn generate(&self, text: String, voice: &VoiceState) -> Result<Float32Array> {
        let inner = Arc::clone(&self.inner);
        let base_state = voice.tts_state.clone();

        let samples = tokio::task::spawn_blocking(move || -> std::result::Result<Vec<f32>, String> {
            generate_audio(&inner, &base_state, &text)
        })
        .await
        .map_err(|e| Error::from_reason(format!("Task join error: {e}")))?
        .map_err(|e| Error::from_reason(e))?;

        Ok(Float32Array::new(samples))
    }

    /// Streaming generation — returns an array of Float32Array chunks.
    ///
    /// Each chunk corresponds to one Mimi decoder frame (~80ms of audio).
    #[napi]
    pub async fn generate_stream(
        &self,
        text: String,
        voice: &VoiceState,
    ) -> Result<Vec<Float32Array>> {
        let inner = Arc::clone(&self.inner);
        let base_state = voice.tts_state.clone();

        let chunks = tokio::task::spawn_blocking(
            move || -> std::result::Result<Vec<Vec<f32>>, String> {
                generate_audio_chunks(&inner, &base_state, &text)
            },
        )
        .await
        .map_err(|e| Error::from_reason(format!("Task join error: {e}")))?
        .map_err(|e| Error::from_reason(e))?;

        Ok(chunks.into_iter().map(Float32Array::new).collect())
    }

    /// Streaming generation with per-chunk callback.
    ///
    /// Calls `callback(Float32Array)` for each audio chunk as it is
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

        let inner = Arc::clone(&self.inner);
        let base_state = voice.tts_state.clone();

        std::thread::spawn(move || {
            let send_error = |msg: String| {
                let _ = tsfn.call(
                    Err(Error::from_reason(msg)),
                    ThreadsafeFunctionCallMode::Blocking,
                );
            };

            let tokenizer = &*inner.tokenizer;
            let chunks = split_into_best_sentences(tokenizer, &text, None);

            for chunk_text in chunks.iter() {
                let (prepared, frames_after_eos) = prepare_text_prompt(chunk_text);
                let tokens = match inner.model.flow_lm.conditioner.tokenize(&prepared) {
                    Ok(t) => t,
                    Err(e) => {
                        send_error(format!("Tokenize failed: {e}"));
                        return;
                    }
                };

                let num_tokens = tokens.len();
                let max_frames = ((num_tokens as f64 / 3.0 + 2.0) * 12.5).ceil() as usize;

                let mut tts_state = base_state.clone();
                let mut mimi_state = match inner.model.init_mimi_state(1, MIMI_CONTEXT) {
                    Ok(s) => s,
                    Err(e) => {
                        send_error(format!("Mimi state init failed: {e}"));
                        return;
                    }
                };

                if let Err(e) = inner.model.prompt_text(&mut tts_state, &tokens) {
                    send_error(format!("Text prompting failed: {e}"));
                    return;
                }

                let ldim = inner.cfg.flow_lm.ldim;
                let nan_data: Vec<f32> = vec![f32::NAN; ldim];
                let mut prev_latent: Tensor<f32, CpuDevice> = match Tensor::from_vec(
                    nan_data,
                    (1, 1, ldim),
                    &xn::CPU,
                ) {
                    Ok(t) => t,
                    Err(e) => {
                        send_error(format!("BOS tensor failed: {e}"));
                        return;
                    }
                };

                let mut rng = TtsRng::new(TEMPERATURE, SEED);
                let mut eos_countdown: Option<usize> = None;

                for _step in 0..max_frames {
                    let (next_latent, is_eos) =
                        match inner.model.generate_step(&mut tts_state, &prev_latent, &mut rng) {
                            Ok(r) => r,
                            Err(e) => {
                                send_error(format!("Generate step failed: {e}"));
                                return;
                            }
                        };

                    let audio_chunk =
                        match inner.model.decode_latent(&next_latent, &mut mimi_state) {
                            Ok(a) => a,
                            Err(e) => {
                                send_error(format!("Decode latent failed: {e}"));
                                return;
                            }
                        };

                    let samples = match audio_chunk.to_vec() {
                        Ok(s) => s,
                        Err(e) => {
                            send_error(format!("to_vec failed: {e}"));
                            return;
                        }
                    };

                    let status =
                        tsfn.call(Ok(samples), ThreadsafeFunctionCallMode::Blocking);
                    if status != napi::Status::Ok {
                        return;
                    }

                    if is_eos && eos_countdown.is_none() {
                        eos_countdown = Some(frames_after_eos);
                    }
                    if let Some(ref mut c) = eos_countdown {
                        if *c == 0 {
                            break;
                        }
                        *c -= 1;
                    }

                    prev_latent = next_latent;
                }
            }
            // Completion sentinel
            let _ = tsfn.call(Ok(vec![]), ThreadsafeFunctionCallMode::Blocking);
        });

        Ok(())
    }

    /// Audio sample rate — always 24000 Hz.
    #[napi(getter)]
    pub fn sample_rate(&self) -> u32 {
        self.inner.cfg.mimi.sample_rate as u32
    }
}

/// Full generation: returns all samples concatenated.
fn generate_audio(
    inner: &ModelInner,
    base_state: &State,
    text: &str,
) -> std::result::Result<Vec<f32>, String> {
    let chunks = generate_audio_chunks(inner, base_state, text)?;
    Ok(chunks.into_iter().flatten().collect())
}

/// Chunked generation: returns per-frame audio chunks.
fn generate_audio_chunks(
    inner: &ModelInner,
    base_state: &State,
    text: &str,
) -> std::result::Result<Vec<Vec<f32>>, String> {
    let tokenizer = &*inner.tokenizer;
    let sentence_chunks = split_into_best_sentences(tokenizer, text, None);

    let mut all_chunks = Vec::new();

    for chunk_text in sentence_chunks.iter() {
        let (prepared, frames_after_eos) = prepare_text_prompt(chunk_text);
        let tokens = inner
            .model
            .flow_lm
            .conditioner
            .tokenize(&prepared)
            .map_err(|e| format!("Tokenize failed: {e}"))?;

        let num_tokens = tokens.len();
        let max_frames = ((num_tokens as f64 / 3.0 + 2.0) * 12.5).ceil() as usize;

        let mut tts_state = base_state.clone();
        let mut mimi_state: MimiState = inner
            .model
            .init_mimi_state(1, MIMI_CONTEXT)
            .map_err(|e| format!("Mimi state init failed: {e}"))?;

        inner
            .model
            .prompt_text(&mut tts_state, &tokens)
            .map_err(|e| format!("Text prompting failed: {e}"))?;

        let ldim = inner.cfg.flow_lm.ldim;
        let nan_data: Vec<f32> = vec![f32::NAN; ldim];
        let mut prev_latent: Tensor<f32, CpuDevice> =
            Tensor::from_vec(nan_data, (1, 1, ldim), &xn::CPU)
                .map_err(|e| format!("BOS tensor failed: {e}"))?;

        let mut rng = TtsRng::new(TEMPERATURE, SEED);
        let mut eos_countdown: Option<usize> = None;

        for _step in 0..max_frames {
            let (next_latent, is_eos) = inner
                .model
                .generate_step(&mut tts_state, &prev_latent, &mut rng)
                .map_err(|e| format!("Generate step failed: {e}"))?;

            let audio_chunk = inner
                .model
                .decode_latent(&next_latent, &mut mimi_state)
                .map_err(|e| format!("Decode latent failed: {e}"))?;

            let samples = audio_chunk.to_vec().map_err(|e| format!("to_vec failed: {e}"))?;
            all_chunks.push(samples);

            if is_eos && eos_countdown.is_none() {
                eos_countdown = Some(frames_after_eos);
            }
            if let Some(ref mut c) = eos_countdown {
                if *c == 0 {
                    break;
                }
                *c -= 1;
            }

            prev_latent = next_latent;
        }
    }

    Ok(all_chunks)
}
