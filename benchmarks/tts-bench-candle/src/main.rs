use std::time::Instant;

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

fn main() {
    println!("=== Pocket TTS Benchmark: Candle (babybirdprd) ===\n");

    // Load model
    println!("Loading model...");
    let start = Instant::now();

    let model_dir = model_dir();
    let config_path = format!("{model_dir}/b6369a24.yaml");
    let weights_path = format!("{model_dir}/tts_b6369a24.safetensors");
    let tokenizer_path = format!("{model_dir}/tokenizer.model");

    let config = std::fs::read(&config_path).expect("Failed to read config");
    let weights = std::fs::read(&weights_path).expect("Failed to read weights");
    let tokenizer = std::fs::read(&tokenizer_path).expect("Failed to read tokenizer");

    let model = pocket_tts::TTSModel::load_from_bytes(&config, &weights, &tokenizer)
        .expect("Failed to load model");

    let model_load_ms = start.elapsed().as_millis();
    println!("Model loaded in {model_load_ms}ms");

    // Load voice
    println!("Loading voice (alba.wav)...");
    let start = Instant::now();
    let wav_bytes = std::fs::read(voice_wav()).expect("Failed to read voice WAV");
    let voice_state = model
        .get_voice_state_from_bytes(&wav_bytes)
        .expect("Failed to create voice state");
    let voice_load_ms = start.elapsed().as_millis();
    println!("Voice loaded in {voice_load_ms}ms\n");

    // Benchmark generation
    println!("{:<8} {:>10} {:>10} {:>10} {:>8}", "Label", "Chars", "Samples", "Time(ms)", "RTF");
    println!("{}", "-".repeat(56));

    for (label, text) in TEXTS {
        let start = Instant::now();
        let audio = model
            .generate(text, &voice_state)
            .expect("Generation failed");

        let flat = audio.flatten_all().expect("Flatten failed");
        let samples: Vec<f32> = flat.to_vec1().expect("to_vec1 failed");

        let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
        let duration_s = samples.len() as f64 / model.sample_rate as f64;
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

    // Streaming benchmark (collect all chunks)
    println!("\n--- Streaming ---");
    println!("{:<8} {:>10} {:>10} {:>10} {:>8} {:>10}", "Label", "Chars", "Chunks", "TTFA(ms)", "Total(ms)", "RTF");
    println!("{}", "-".repeat(70));

    for (label, text) in TEXTS {
        let start = Instant::now();
        let mut ttfa: Option<f64> = None;
        let mut total_samples = 0usize;
        let mut chunk_count = 0usize;

        for chunk in model.generate_stream(text, &voice_state) {
            let tensor = chunk.expect("Stream chunk error");
            let flat = tensor.flatten_all().expect("Flatten failed");
            let samples: Vec<f32> = flat.to_vec1().expect("to_vec1 failed");

            if ttfa.is_none() && !samples.is_empty() {
                ttfa = Some(start.elapsed().as_secs_f64() * 1000.0);
            }

            total_samples += samples.len();
            chunk_count += 1;
        }

        let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
        let duration_s = total_samples as f64 / model.sample_rate as f64;
        let rtf = duration_s / (elapsed_ms / 1000.0);

        println!(
            "{:<8} {:>10} {:>10} {:>10.0} {:>8.0} {:>10.2}x",
            label,
            text.len(),
            chunk_count,
            ttfa.unwrap_or(0.0),
            elapsed_ms,
            rtf,
        );
    }

    // Peak RSS
    println!("\nPeak RSS: {:.1} MB", peak_rss_mb());
    println!("Sample rate: {} Hz", model.sample_rate);
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
