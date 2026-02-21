# TTS Model Licensing, Distribution & Voice Cloning Consent

Research document covering the legal landscape for bundling Pocket TTS weights into Animus, attribution requirements, and the voice cloning consent flow.

**Decision**: Bundle all model weights directly into the application so TTS works out of the box. No HuggingFace account, no API tokens, no runtime downloads for core functionality.

---

## Components & Their Licenses

Animus uses three distinct sets of assets for speech. Each has its own license and source.

### 1. Pocket TTS Model Weights (voice cloning variant)

| Field | Value |
|-------|-------|
| **Source** | [kyutai/pocket-tts](https://huggingface.co/kyutai/pocket-tts) on HuggingFace |
| **License** | CC-BY-4.0 |
| **HuggingFace gating** | Yes — automatic approval after agreeing to prohibited use terms |
| **Files** | `tts_b6369a24.safetensors` (~300 MB), `tokenizer.model` |
| **Author** | Kyutai (kyutai.org) |

This is the full model that supports both standard TTS and zero-shot voice cloning.

**HuggingFace gate terms** (what users currently must agree to):
- No voice impersonation or cloning without explicit and lawful consent
- No misinformation, disinformation, or deception
- No generation of unlawful, harmful, libelous, abusive, harassing, discriminatory, hateful, or privacy-invasive content

### 2. Pocket TTS Model Weights (non-cloning variant)

| Field | Value |
|-------|-------|
| **Source** | [kyutai/pocket-tts-without-voice-cloning](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning) on HuggingFace |
| **License** | CC-BY-4.0 |
| **HuggingFace gating** | **None** — fully open, no account needed |
| **Author** | Kyutai |

Same architecture but without voice cloning capability. Downloads freely without authentication.

### 3. Built-in Voice Reference WAVs

| Field | Value |
|-------|-------|
| **Source** | [kyutai/tts-voices](https://huggingface.co/kyutai/tts-voices) on HuggingFace |
| **License** | CC-BY-4.0 |
| **HuggingFace gating** | None |
| **Files** | 8 WAV files (~7.2 MB total) |
| **Voices** | alba, marius, javert, jean, fantine, cosette, eponine, azelma |
| **Author** | Kyutai + various contributors (VCTK corpus, EAR dataset, Expresso dataset, voice donations) |

The voice samples are drawn from multiple sources. The VCTK and EAR corpora have their own licenses (both permissive for research/non-commercial, but CC-BY-4.0 is applied by Kyutai for these processed excerpts in tts-voices).

### 4. Parakeet TDT v3 STT Model

| Field | Value |
|-------|-------|
| **Source** | [sherpa-onnx releases](https://github.com/k2-fsa/sherpa-onnx/releases) (GitHub) |
| **License** | CC-BY-4.0 |
| **Gating** | None |
| **Files** | encoder.int8.onnx, decoder.int8.onnx, joiner.int8.onnx, tokens.txt (~630 MB) |
| **Author** | NVIDIA (model), k2-fsa/sherpa-onnx (ONNX conversion) |

### 5. BabyBird Rust Port (pocket-tts crate)

| Field | Value |
|-------|-------|
| **Source** | [babybirdprd/pocket-tts](https://github.com/babybirdprd/pocket-tts) on GitHub |
| **License** | MIT (code only — model weights retain CC-BY-4.0) |
| **Author** | babybirdprd |

This is the Rust/Candle port we use via `@animus/tts-native`. The code is MIT but it loads the same Kyutai model weights, which remain CC-BY-4.0.

---

## CC-BY-4.0: What It Allows

CC-BY-4.0 is one of the most permissive Creative Commons licenses. It permits:

- **Redistribution** — copy and redistribute in any medium or format
- **Commercial use** — for any purpose, including commercial
- **Adaptation** — remix, transform, and build upon the material
- **No additional restrictions** — you may not apply legal terms or technological measures that restrict others from doing anything the license permits

**The only requirement is attribution.** You must:

1. Give appropriate credit to the creator
2. Provide a link to the license
3. Indicate if changes were made

You may satisfy these conditions in any reasonable manner, but not in a way that suggests the licensor endorses you or your use.

**Key implication for Animus**: We are legally permitted to bundle and redistribute all CC-BY-4.0 model weights as long as we provide proper attribution.

---

## The HuggingFace Gate vs. The License

There is a distinction between:

- **The license (CC-BY-4.0)** — the legal terms governing use and redistribution. Permits redistribution with attribution.
- **The HuggingFace gate** — a technical access control mechanism. Requires users to click through prohibited use terms before downloading from HuggingFace.

The gate is not a license restriction. It is an additional ethical guardrail that Kyutai layered on top of the permissive CC-BY-4.0 license specifically for the voice cloning variant. The CC-BY-4.0 license itself does not prohibit redistribution — the gate is HuggingFace platform-level access control, not a legal constraint on downstream redistribution.

**However**, we should respect Kyutai's intent. They gated voice cloning because it can be misused. Our approach should balance:
- Great UX (works out of the box)
- Respecting the model author's ethical concerns
- Legal compliance (attribution)

---

## Distribution Approach

### Bundle Everything

All model weights ship with the application. No runtime downloads from HuggingFace.

**What we bundle:**

| Asset | Size | License | Gated on HF? |
|-------|------|---------|--------------|
| Pocket TTS weights (voice cloning variant) | ~300 MB | CC-BY-4.0 | Yes (auto-approve) |
| Tokenizer | ~2 MB | CC-BY-4.0 | No |
| 8 built-in voice WAVs | ~7.2 MB | CC-BY-4.0 | No |
| Parakeet STT weights | ~630 MB | CC-BY-4.0 | No |
| **Total** | **~940 MB** | | |

**Why bundle the voice-cloning variant instead of the non-cloning variant:**
- Voice cloning is a core feature of Animus (persona voice customization)
- The non-cloning variant cannot do zero-shot cloning from reference audio
- Users would have a degraded experience without voice cloning
- The license permits redistribution — the gate is a platform mechanism, not a legal restriction

### Current State vs. Target State

**Current** (`asset-registry.ts`): Downloads from HuggingFace URLs at runtime. The TTS safetensors file points to the gated `kyutai/pocket-tts` repo, which would require `HF_TOKEN` for authenticated download.

**Target**: Weights are bundled into the application distribution (Tauri bundle, npm package, or downloaded during `npm install` / first-run setup for dev). No HuggingFace authentication needed by end users.

### Bundling Mechanism

For the Tauri desktop app, model weights go into the resources bundle:
- macOS: `Contents/Resources/models/`
- The Tauri `resources` config already handles bundling files into the app package

For development / npm distribution:
- A post-install script or first-run download can fetch weights from our own hosting (GitHub Releases, S3, etc.) rather than HuggingFace
- This removes the HuggingFace account/token dependency entirely

---

## Attribution Requirements

### What We Must Show

CC-BY-4.0 requires "appropriate credit." We need to show attribution for every CC-BY-4.0 component we bundle. This should be visible in the application — not just in a LICENSE file buried in the repo.

### Required Attributions

**1. Pocket TTS Model**
```
Pocket TTS by Kyutai (https://kyutai.org)
Licensed under CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/)
Source: https://huggingface.co/kyutai/pocket-tts
```

**2. Pocket TTS Rust Port (code)**
```
pocket-tts Rust port by babybirdprd
Licensed under MIT
Source: https://github.com/babybirdprd/pocket-tts
```

**3. Built-in Voice Samples**
```
Voice samples from Kyutai TTS Voices collection
Licensed under CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/)
Source: https://huggingface.co/kyutai/tts-voices
Includes samples from: VCTK Corpus, EAR Dataset, Expresso Dataset, voice donations
```

**4. Parakeet TDT v3 STT Model**
```
Parakeet TDT v3 by NVIDIA
Licensed under CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/)
ONNX conversion by sherpa-onnx (https://github.com/k2-fsa/sherpa-onnx)
```

### Where to Show Attribution

1. **Settings > About / Licenses page** — full attribution text for all bundled models and libraries. This is the primary location. Every model, its author, license, and source link.

2. **THIRD-PARTY-LICENSES.md** (repo root) — machine-readable and human-readable file listing all third-party assets, their licenses, and sources. Bundled into the app distribution.

3. **First-run / onboarding** — brief mention that speech is powered by Pocket TTS and Parakeet (no need for full legal text here, just credit).

---

## Voice Cloning Consent Flow

### Why a Consent Screen

Kyutai gated the voice cloning model on HuggingFace specifically because voice cloning can be misused. Even though we're legally permitted to redistribute the weights, we should implement our own consent mechanism that:

1. Informs users about the ethical implications of voice cloning
2. Gets explicit acknowledgment before enabling the feature
3. Respects the spirit of Kyutai's gating decision

### When to Show the Consent Screen

The consent screen should appear **the first time a user attempts to use voice cloning** — not during onboarding or general setup. This means:

- **Built-in voices work immediately** — no consent needed, these are pre-made reference voices
- **Custom voice upload triggers consent** — when the user first tries to upload their own WAV file or record a voice sample for cloning
- **Consent is stored persistently** — once accepted, never shown again (stored in system.db settings)

### What the Consent Screen Should Show

```
Voice Cloning

Animus can clone voices from audio samples. This is a powerful capability
that comes with responsibility.

By enabling voice cloning, you agree to:

• Only clone voices with the explicit consent of the voice owner
• Not use cloned voices for impersonation, fraud, or deception
• Not create misleading, harmful, or harassing content with cloned voices
• Comply with all applicable laws regarding synthetic voice generation

Voice cloning is powered by Pocket TTS by Kyutai, licensed under CC-BY-4.0.

[Cancel]  [I Understand & Agree]
```

### Implementation Details

- **Setting key**: `voice_cloning_consent_accepted` (boolean) in `system_settings`
- **Timestamp**: `voice_cloning_consent_accepted_at` (ISO string) for audit trail
- **Backend enforcement**: `VoiceManager.addCustomVoice()` checks consent before allowing upload
- **Frontend**: Modal dialog triggered by the "Add Custom Voice" button in Persona settings
- **No consent needed for**: selecting built-in voices, adjusting voice speed, using TTS with built-in voices

---

## Risk Assessment

### Legal Risk: Low

- CC-BY-4.0 explicitly permits redistribution with attribution
- We provide full attribution in the app and in repo files
- The HuggingFace gate is a platform feature, not a license term
- We implement our own consent mechanism for voice cloning

### Ethical Risk: Mitigated

- Consent screen for voice cloning respects Kyutai's intent
- Prohibited use terms are surfaced to users before enabling cloning
- This is a self-hosted, single-user application — the user is both the operator and the responsible party
- Built-in voices work without any consent flow (these are already-published reference voices)

### Practical Risk: None

- No dependency on HuggingFace infrastructure for end users
- No accounts, tokens, or API keys needed
- TTS works immediately after installation
- Models are static files — no version drift or breaking changes from upstream

---

## Summary

| Concern | Resolution |
|---------|-----------|
| Can we redistribute weights? | Yes — CC-BY-4.0 permits it with attribution |
| Do users need HuggingFace accounts? | No — we bundle weights, bypassing HuggingFace entirely |
| What about the HuggingFace gate? | It's platform-level access control, not a license restriction. We implement our own consent flow for voice cloning instead |
| What attribution is required? | Credit to Kyutai, link to CC-BY-4.0 license, link to source. Shown in Settings > About and in THIRD-PARTY-LICENSES.md |
| When do users see consent? | Only when first enabling custom voice cloning (uploading their own voice sample) |
| Do built-in voices need consent? | No — they're pre-published reference voices, not cloned from user audio |
| Which model variant do we bundle? | The full voice-cloning variant (`kyutai/pocket-tts`) — it's the same license, and voice cloning is a core feature |
| What about the Rust port license? | MIT for code, CC-BY-4.0 for model weights. Both permit our use case |

---

## Related Documents

- `docs/architecture/speech-engine.md` — speech engine architecture
- `docs/architecture/voice-channel.md` — voice channel design
- `docs/architecture/credential-passing.md` — secrets and credential handling (for reference on consent patterns)
- `docs/frontend/settings.md` — settings page where attribution and consent live
