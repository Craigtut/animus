use ptts::tts_model::{MimiEnc, TTSConfig, TTSModel, prepare_text_prompt, split_into_best_sentences};
use std::time::Instant;
use xn::nn::VB;
use xn::Tensor;

const BASE: &str = env!("CARGO_MANIFEST_DIR");

fn model_dir() -> String {
    format!("{BASE}/../../data/models/tts")
}

fn voice_wav() -> String {
    format!("{BASE}/../../data/voices/builtin/alba.wav")
}

const TEXTS: &[(&str, &str)] = &[
    ("short", "Hello, how are you today?"),
    ("medium", "The quick brown fox jumps over the lazy dog. It was a beautiful sunny morning and the birds were singing in the trees."),
    ("long", "In the heart of the ancient forest, where the tallest oaks stretched their branches toward the sky, a small stream wound its way through moss-covered stones. The water was crystal clear, reflecting the dappled sunlight that filtered through the canopy above. A deer paused at the water's edge, its ears twitching at every sound, before lowering its head to drink."),
];

// Tokenizer wrapper for SentencePiece
struct SpTokenizer(sentencepiece::SentencePieceProcessor);

impl ptts::Tokenizer for SpTokenizer {
    fn encode(&self, text: &str) -> Vec<u32> {
        let pieces = self.0.encode(text).unwrap_or_default();
        pieces.iter().map(|p| p.id).collect()
    }

    fn decode(&self, tokens: &[u32]) -> String {
        self.0.decode_piece_ids(tokens).unwrap_or_default()
    }
}

// RNG for flow matching
struct TtsRng {
    inner: Box<rand::rngs::StdRng>,
    distr: rand_distr::Normal<f32>,
}

impl TtsRng {
    fn new(temperature: f32, seed: u64) -> Self {
        use rand::SeedableRng;
        let std = temperature.sqrt();
        let distr = rand_distr::Normal::new(0f32, std).expect("invalid distribution");
        let rng = rand::rngs::StdRng::seed_from_u64(seed);
        Self {
            inner: Box::new(rng),
            distr,
        }
    }
}

impl ptts::flow_lm::Rng for TtsRng {
    fn sample(&mut self) -> f32 {
        use rand::Rng;
        self.inner.sample(self.distr)
    }
}

// Key remapping from HuggingFace weight names to ptts internal names
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

// WAV decoding (simplified for benchmark — only handles WAV files)
fn pcm_decode(path: &str) -> (Vec<f32>, u32) {
    use symphonia::core::audio::{AudioBufferRef, Signal};
    use symphonia::core::conv::FromSample;

    let src = std::fs::File::open(path).expect("Failed to open WAV file");
    let mss = symphonia::core::io::MediaSourceStream::new(Box::new(src), Default::default());
    let hint = symphonia::core::probe::Hint::new();
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &Default::default(), &Default::default())
        .expect("Failed to probe audio");
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .expect("no supported audio tracks");
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &Default::default())
        .expect("unsupported codec");
    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(0);
    let mut pcm_data = Vec::new();
    while let Ok(packet) = format.next_packet() {
        while !format.metadata().is_latest() {
            format.metadata().pop();
        }
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet).expect("decode failed") {
            AudioBufferRef::F32(buf) => pcm_data.extend(buf.chan(0)),
            AudioBufferRef::S16(data) => {
                pcm_data.extend(data.chan(0).iter().map(|v| f32::from_sample(*v)))
            }
            AudioBufferRef::S32(data) => {
                pcm_data.extend(data.chan(0).iter().map(|v| f32::from_sample(*v)))
            }
            _ => panic!("unsupported audio format"),
        }
    }
    (pcm_data, sample_rate)
}

fn resample(pcm_in: &[f32], sr_in: usize, sr_out: usize) -> Vec<f32> {
    use rubato::Resampler;

    let mut pcm_out =
        Vec::with_capacity((pcm_in.len() as f64 * sr_out as f64 / sr_in as f64) as usize + 1024);

    let mut resampler =
        rubato::FftFixedInOut::<f32>::new(sr_in, sr_out, 1024, 1).expect("resampler init failed");
    let mut output_buffer = resampler.output_buffer_allocate(true);
    let mut pos_in = 0;
    while pos_in + resampler.input_frames_next() < pcm_in.len() {
        let (in_len, out_len) = resampler
            .process_into_buffer(&[&pcm_in[pos_in..]], &mut output_buffer, None)
            .expect("resample failed");
        pos_in += in_len;
        pcm_out.extend_from_slice(&output_buffer[0][..out_len]);
    }
    if pos_in < pcm_in.len() {
        let (_in_len, out_len) = resampler
            .process_partial_into_buffer(Some(&[&pcm_in[pos_in..]]), &mut output_buffer, None)
            .expect("resample partial failed");
        pcm_out.extend_from_slice(&output_buffer[0][..out_len]);
    }

    pcm_out
}

/// Generate audio for a single text using xn-ptts.
/// Returns (samples, ttfa_ms) where ttfa_ms is time to first audio chunk.
fn generate_full(
    model: &TTSModel<xn::Unquantized<f32, xn::CpuDevice>>,
    tokenizer: &SpTokenizer,
    voice_state: &ptts::tts_model::TTSState<xn::Unquantized<f32, xn::CpuDevice>>,
    mimi_state_template: &ptts::mimi::MimiDecoderState<f32, xn::CpuDevice>,
    text: &str,
    rng_seed: u64,
    temperature: f32,
) -> (Vec<f32>, Option<f64>, usize) {
    let cfg = TTSConfig::v202601(temperature);
    let chunks = split_into_best_sentences(tokenizer, text, None);
    let mut rng = TtsRng::new(temperature, rng_seed);

    let mut all_tokens = vec![];
    let mut max_seq_budget = 0;
    for chunk in chunks.iter() {
        let (prepared, frames_after_eos) = prepare_text_prompt(chunk);
        let tokens = model.flow_lm.conditioner.tokenize(&prepared).expect("tokenize failed");
        let num_tokens = tokens.len();
        let max_frames = ((num_tokens as f64 / 3.0 + 2.0) * 12.5).ceil() as usize;
        let seq_budget = num_tokens + 512 + max_frames;
        max_seq_budget = max_seq_budget.max(seq_budget);
        all_tokens.push((tokens, max_frames, frames_after_eos));
    }

    let gen_start = Instant::now();
    let mut ttfa: Option<f64> = None;
    let mut all_pcm = Vec::new();
    let mut total_chunks = 0usize;

    for (tokens, max_frames, frames_after_eos) in all_tokens.into_iter() {
        let mut tts_state = voice_state.clone();
        let mut mimi_state = mimi_state_template.clone();

        model
            .prompt_text(&mut tts_state, &tokens)
            .expect("prompt_text failed");

        let ldim = cfg.flow_lm.ldim;
        let nan_data: Vec<f32> = vec![f32::NAN; ldim];
        let mut prev_latent: Tensor<f32, xn::CpuDevice> =
            Tensor::from_vec(nan_data, (1, 1, ldim), &xn::CPU).expect("tensor failed");

        let mut eos_countdown: Option<usize> = None;

        for _step in 0..max_frames {
            let (next_latent, is_eos) = model
                .generate_step(&mut tts_state, &prev_latent, &mut rng)
                .expect("generate_step failed");

            let audio_chunk = model
                .decode_latent(&next_latent, &mut mimi_state)
                .expect("decode_latent failed");

            let pcm = audio_chunk.to_vec().expect("to_vec failed");

            if ttfa.is_none() && !pcm.is_empty() {
                ttfa = Some(gen_start.elapsed().as_secs_f64() * 1000.0);
            }

            all_pcm.extend_from_slice(&pcm);
            total_chunks += 1;

            if is_eos && eos_countdown.is_none() {
                eos_countdown = Some(frames_after_eos);
            }

            if let Some(ref mut countdown) = eos_countdown {
                if *countdown == 0 {
                    break;
                }
                *countdown -= 1;
            }

            prev_latent = next_latent;
        }
    }

    (all_pcm, ttfa, total_chunks)
}

fn main() {
    println!("=== Pocket TTS Benchmark: xn-ptts (LaurentMazare) ===\n");

    let temperature = 0.7f32;
    let seed = 4242424242424242u64;
    let cfg = TTSConfig::v202601(temperature);

    // Load model
    println!("Loading model...");
    let start = Instant::now();

    let model_dir = model_dir();
    let weights_path = format!("{model_dir}/tts_b6369a24.safetensors");
    let weights_path = std::path::PathBuf::from(&weights_path);
    let tokenizer_path = format!("{model_dir}/tokenizer.model");

    let vb = VB::load_with_key_map(&[&weights_path], xn::CPU, remap_key)
        .expect("Failed to load weights");
    let vb = vb.root();

    let sp = sentencepiece::SentencePieceProcessor::open(&tokenizer_path)
        .expect("Failed to load tokenizer");
    let tokenizer = SpTokenizer(sp);

    let model: TTSModel<xn::Unquantized<f32, xn::CpuDevice>> =
        TTSModel::load(&vb, Box::new(SpTokenizer(
            sentencepiece::SentencePieceProcessor::open(&tokenizer_path).unwrap()
        )), &cfg)
            .expect("Failed to load TTS model");

    let mimi_enc: MimiEnc<xn::Unquantized<f32, xn::CpuDevice>> =
        MimiEnc::load(&vb, &cfg).expect("Failed to load MimiEnc");

    let model_load_ms = start.elapsed().as_millis();
    println!("Model loaded in {model_load_ms}ms");

    println!(
        "SIMD: avx={}, neon={}, simd128={}, f16c={}",
        xn::with_avx(),
        xn::with_neon(),
        xn::with_simd128(),
        xn::with_f16c()
    );

    // Load voice
    println!("Loading voice (alba.wav)...");
    let start = Instant::now();

    let (pcm, sample_rate) = pcm_decode(&voice_wav());
    let pcm = if sample_rate as usize != cfg.mimi.sample_rate {
        resample(&pcm, sample_rate as usize, cfg.mimi.sample_rate)
    } else {
        pcm
    };
    // Trim to 10s max
    let pcm = if pcm.len() > cfg.mimi.sample_rate * 10 {
        pcm[..cfg.mimi.sample_rate * 10].to_vec()
    } else {
        pcm
    };
    let pcm_tensor: Tensor<f32, xn::CpuDevice> =
        Tensor::from_vec(pcm, (1, 1, ()), &xn::CPU).expect("tensor failed");
    let voice_emb = mimi_enc
        .encode_audio(&pcm_tensor)
        .expect("encode_audio failed");

    // Create base state with voice conditioning baked in
    let max_seq_budget = 2048;
    let mut base_state = model
        .init_flow_lm_state(1, max_seq_budget)
        .expect("init state failed");
    model
        .prompt_audio(&mut base_state, &voice_emb)
        .expect("prompt_audio failed");

    let mimi_state = model.init_mimi_state(1, 250).expect("init mimi failed");

    let voice_load_ms = start.elapsed().as_millis();
    println!("Voice loaded in {voice_load_ms}ms\n");

    // Benchmark generation
    println!(
        "{:<8} {:>10} {:>10} {:>10} {:>8}",
        "Label", "Chars", "Samples", "Time(ms)", "RTF"
    );
    println!("{}", "-".repeat(56));

    for (label, text) in TEXTS {
        let start = Instant::now();
        let (samples, _ttfa, _chunks) = generate_full(
            &model,
            &tokenizer,
            &base_state,
            &mimi_state,
            text,
            seed,
            temperature,
        );
        let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
        let duration_s = samples.len() as f64 / cfg.mimi.sample_rate as f64;
        let rtf = duration_s / (elapsed_ms / 1000.0);

        println!(
            "{:<8} {:>10} {:>10} {:>10.0} {:>8.2}x",
            label,
            text.len(),
            samples.len(),
            elapsed_ms,
            rtf,
        );
    }

    // Streaming benchmark (same loop, but report TTFA)
    println!("\n--- Streaming (TTFA) ---");
    println!(
        "{:<8} {:>10} {:>10} {:>10} {:>10} {:>8}",
        "Label", "Chars", "Chunks", "TTFA(ms)", "Total(ms)", "RTF"
    );
    println!("{}", "-".repeat(70));

    for (label, text) in TEXTS {
        let start = Instant::now();
        let (samples, ttfa, chunks) = generate_full(
            &model,
            &tokenizer,
            &base_state,
            &mimi_state,
            text,
            seed,
            temperature,
        );
        let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
        let duration_s = samples.len() as f64 / cfg.mimi.sample_rate as f64;
        let rtf = duration_s / (elapsed_ms / 1000.0);

        println!(
            "{:<8} {:>10} {:>10} {:>10.0} {:>10.0} {:>8.2}x",
            label,
            text.len(),
            chunks,
            ttfa.unwrap_or(0.0),
            elapsed_ms,
            rtf,
        );
    }

    // Peak RSS
    println!("\nPeak RSS: {:.1} MB", peak_rss_mb());
    println!("Sample rate: {} Hz", cfg.mimi.sample_rate);
}

fn peak_rss_mb() -> f64 {
    let mut usage = std::mem::MaybeUninit::uninit();
    let maxrss = unsafe {
        libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr());
        usage.assume_init().ru_maxrss as f64
    };
    if cfg!(target_os = "macos") {
        maxrss / (1024.0 * 1024.0)
    } else {
        maxrss / 1024.0
    }
}
