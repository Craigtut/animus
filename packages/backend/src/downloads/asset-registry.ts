/**
 * Static registry of downloadable assets for the Animus project.
 * Defines model files that need to be downloaded (e.g., speech models).
 */

export interface ArchiveAsset {
  id: string;
  label: string;
  category: string;
  url: string;
  estimatedBytes: number;
  extractionConfig: {
    type: 'tar.bz2';
    stripComponents: number;
    targetDir: string;
  };
  requiredFiles: string[];
}

export interface FileGroupAsset {
  id: string;
  label: string;
  category: string;
  estimatedBytes: number;
  extractionConfig: {
    type: 'files';
    targetDir: string;
  };
  files: { url: string; filename: string }[];
  requiredFiles: string[];
}

export type AssetDefinition = ArchiveAsset | FileGroupAsset;

export const ASSET_REGISTRY: Record<string, AssetDefinition> = {
  'stt-parakeet-tdt-v3': {
    id: 'stt-parakeet-tdt-v3',
    label: 'Speech Recognition (Parakeet TDT v3)',
    category: 'speech',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2',
    estimatedBytes: 660_000_000,
    extractionConfig: {
      type: 'tar.bz2',
      stripComponents: 1,
      targetDir: 'models/stt',
    },
    requiredFiles: [
      'encoder.int8.onnx',
      'decoder.int8.onnx',
      'joiner.int8.onnx',
      'tokens.txt',
    ],
  },

  'tts-pocket-tts': {
    id: 'tts-pocket-tts',
    label: 'Text-to-Speech (Pocket TTS)',
    category: 'speech',
    estimatedBytes: 300_000_000,
    extractionConfig: {
      type: 'files',
      targetDir: 'models/tts',
    },
    files: [
      {
        url: 'https://github.com/Craigtut/animus/releases/download/speech-models-v1.0.0/tts_b6369a24.safetensors',
        filename: 'tts_b6369a24.safetensors',
      },
      {
        url: 'https://github.com/Craigtut/animus/releases/download/speech-models-v1.0.0/tokenizer.model',
        filename: 'tokenizer.model',
      },
      {
        url: 'https://github.com/Craigtut/animus/releases/download/speech-models-v1.0.0/b6369a24.yaml',
        filename: 'b6369a24.yaml',
      },
    ],
    requiredFiles: ['tts_b6369a24.safetensors', 'tokenizer.model', 'b6369a24.yaml'],
  },

  'tts-pocket-voices': {
    id: 'tts-pocket-voices',
    label: 'Pocket TTS Voices',
    category: 'speech',
    estimatedBytes: 7_200_000,
    extractionConfig: {
      type: 'files',
      targetDir: 'models/tts/test_wavs',
    },
    files: [
      { url: 'https://huggingface.co/kyutai/tts-voices/resolve/main/alba-mackenna/casual.wav', filename: 'alba.wav' },
      { url: 'https://huggingface.co/kyutai/tts-voices/resolve/main/voice-donations/Selfie.wav', filename: 'marius.wav' },
      { url: 'https://huggingface.co/kyutai/tts-voices/resolve/main/voice-donations/Butter.wav', filename: 'javert.wav' },
      { url: 'https://huggingface.co/kyutai/tts-voices/resolve/main/ears/p010/freeform_speech_01.wav', filename: 'jean.wav' },
      { url: 'https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/p244_023.wav', filename: 'fantine.wav' },
      { url: 'https://huggingface.co/kyutai/tts-voices/resolve/main/expresso/ex04-ex02_confused_001_channel1_499s.wav', filename: 'cosette.wav' },
      { url: 'https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/p262_023.wav', filename: 'eponine.wav' },
      { url: 'https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/p303_023.wav', filename: 'azelma.wav' },
    ],
    requiredFiles: [
      'alba.wav',
      'marius.wav',
      'javert.wav',
      'jean.wav',
      'fantine.wav',
      'cosette.wav',
      'eponine.wav',
      'azelma.wav',
    ],
  },
};

/**
 * Returns both speech assets in order: STT first, then TTS.
 */
export function getSpeechAssets(): AssetDefinition[] {
  return [
    ASSET_REGISTRY['stt-parakeet-tdt-v3']!,
    ASSET_REGISTRY['tts-pocket-tts']!,
    ASSET_REGISTRY['tts-pocket-voices']!,
  ];
}

/**
 * Returns all assets matching the given category.
 */
export function getAssetsByCategory(category: string): AssetDefinition[] {
  return Object.values(ASSET_REGISTRY).filter(
    (asset) => asset.category === category
  );
}
