# Third-Party Licenses

Animus Engine includes or depends on the following third-party components.

---

## AI Models

The following AI models are bundled with or downloaded by Animus Engine. Models
released under CC-BY-4.0 require visible attribution.

### Pocket TTS

- **Author**: Kyutai
- **License**: CC-BY-4.0
- **Source**: https://huggingface.co/kyutai/pocketlm-tts-pretrained-v1
- **Description**: Lightweight text-to-speech model (weights, tokenizer, and configuration files)
- **Full License**: https://creativecommons.org/licenses/by/4.0/

### Kyutai TTS Voices

- **Author**: Kyutai
- **License**: CC-BY-4.0
- **Source**: https://huggingface.co/kyutai/pocketlm-tts-pretrained-v1
- **Description**: 8 built-in voice prompt WAV files, sourced from:
  - VCTK Corpus (University of Edinburgh)
  - EAR Dataset
  - Expresso Dataset
- **Full License**: https://creativecommons.org/licenses/by/4.0/

### Parakeet TDT v3

- **Author**: NVIDIA (ONNX conversion by k2-fsa/sherpa-onnx)
- **License**: CC-BY-4.0
- **Source**: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2
- **Description**: Automatic speech recognition model (ONNX format)
- **Full License**: https://creativecommons.org/licenses/by/4.0/

### BGE-small-en-v1.5

- **Author**: BAAI (Beijing Academy of Artificial Intelligence)
- **License**: MIT
- **Source**: https://huggingface.co/BAAI/bge-small-en-v1.5
- **Description**: Text embedding model for semantic search and memory retrieval
- **Full License**: https://opensource.org/licenses/MIT

---

## Libraries

The following libraries are notable dependencies with specific attribution
requirements.

### pocket-tts (Rust port)

- **Author**: babybirdprd
- **License**: MIT
- **Source**: https://github.com/babybirdprd/pocket-tts
- **Description**: Rust implementation of Pocket TTS inference, used by the native TTS module
- **Full License**: https://opensource.org/licenses/MIT

### sharp / libvips

- **Author**: Lovell Fuller
- **License**: Apache-2.0 (sharp) / LGPL-3.0 (libvips, dynamically linked)
- **Source**: https://github.com/lovell/sharp
- **Description**: High-performance image processing library for Node.js
- **Full License (Apache-2.0)**: https://www.apache.org/licenses/LICENSE-2.0
- **Full License (LGPL-3.0)**: https://www.gnu.org/licenses/lgpl-3.0.html
