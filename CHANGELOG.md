# Changelog

All notable changes to the Animus Engine will be documented in this file.

This project uses [Conventional Commits](https://www.conventionalcommits.org/) and [Semantic Versioning](https://semver.org/).

## [0.3.3](https://github.com/Craigtut/animus/compare/v0.3.2...v0.3.3) (2026-03-12)

### Features

* **ci:** add prebuilt tts-native binaries with Windows support ([288167e](https://github.com/Craigtut/animus/commit/288167e0a73cf95c151f5e3d9a7c1f8cb2f5b4e2))
* **speech:** add previewVoice tRPC mutation as streaming fallback ([af02b1b](https://github.com/Craigtut/animus/commit/af02b1b117e95da731e078826835f4deb0a0070d))
* **speech:** add streaming TTS voice preview for near-instant playback ([52db0f0](https://github.com/Craigtut/animus/commit/52db0f0788e22b887579d69af8959122d0cb2782))

### Bug Fixes

* **agents:** configure Codex sandbox to prevent shell commands hanging on Windows ([9b71abc](https://github.com/Craigtut/animus/commit/9b71abc6e4394bf704083636d3b05827f8e41e1d))
* **agents:** fix auth provider tests for async session manager and blocking initiateAuth ([e9d88be](https://github.com/Craigtut/animus/commit/e9d88beaa339d379998ee7cdb95f9607c9e5ea27))
* **backend:** correct telemetry version reporting and prevent IP capture ([75ba871](https://github.com/Craigtut/animus/commit/75ba8716d2274011ef2f95e54bb89c744f3d08ed))
* **backend:** fix package signature verification on Windows ([2ad051a](https://github.com/Craigtut/animus/commit/2ad051a3f61a73c0fdd7bd0c593a59143ff501bc))
* **ci:** configure ports.ubuntu.com for ARM64 cross-compilation packages ([ad371f3](https://github.com/Craigtut/animus/commit/ad371f31af761e830d36ab6c489f81c26c9134c3))
* **ci:** fix build failures and add pre-commit/pre-push hooks ([91b50c2](https://github.com/Craigtut/animus/commit/91b50c26ec40ecb1c89c82b1f4e8d376b6218619))
* **ci:** install cross-compilation OpenSSL for Linux ARM64 tts-native build ([bbfc9fa](https://github.com/Craigtut/animus/commit/bbfc9faec8c736c7ec0b0b02ad22a637af78eaa8))
* **ci:** set cross-linker for aarch64-unknown-linux-gnu target ([3245d43](https://github.com/Craigtut/animus/commit/3245d43d85783f278994d319f255533fb673bd0b))
* **ci:** vendor OpenSSL for Linux cross-compilation instead of system packages ([a07bde6](https://github.com/Craigtut/animus/commit/a07bde677f2963221d6b0d750c8e8e74596d9245))
* **frontend:** fix Select dropdown scroll and overflow clipping ([a765938](https://github.com/Craigtut/animus/commit/a765938fda4e01ab855ea6db7b65add8346c9eac))
* **frontend:** normalize Slider neutral calculations to work with any min/max range ([dbf1b66](https://github.com/Craigtut/animus/commit/dbf1b6663553816ae04d54ae141affa77e736434))
* **frontend:** remove auto-restart on update, prompt user to restart manually ([5743bf5](https://github.com/Craigtut/animus/commit/5743bf5793b82fec3d9e9d059010053f61128f98))

### Performance Improvements

* **ci:** split Docker build into native per-arch jobs and use pre-built tts-native binaries ([88ee292](https://github.com/Craigtut/animus/commit/88ee292b21239778f19678353b33fa95eff3a2cb))

## [0.3.2](https://github.com/Craigtut/animus/compare/v0.3.1...v0.3.2) (2026-03-11)

### Features

* **agents:** upgrade Claude Agent SDK to v0.2.x and refactor SDK lifecycle ([b793fc8](https://github.com/Craigtut/animus/commit/b793fc8f2e3c51e0b0e75f37044e6c4ddf1f1e9f))

### Bug Fixes

* **frontend:** websocket auth fix ([bc210bb](https://github.com/Craigtut/animus/commit/bc210bb8de80dcd28b43d05fdb54974365519198))
* **release:** keep changelog header at top when generating entries ([de92133](https://github.com/Craigtut/animus/commit/de921331d18c6124ed7c5d9fc79a965124132086))

## [0.3.1](https://github.com/Craigtut/animus/compare/v0.3.0...v0.3.1) (2026-03-09)

### Bug Fixes

* **ci:** ensure workspace node_modules dirs exist after prune in Docker build ([2409ec2](https://github.com/Craigtut/animus/commit/2409ec26da2ee04af7f74fb77c06988fbbeab550))
* **frontend:** rename max saves label and add Tauri native export dialog ([c891192](https://github.com/Craigtut/animus/commit/c891192206fa301318f1416104ce6a903e0844c3))

## [0.3.0](https://github.com/Craigtut/animus/compare/v0.2.4...v0.3.0) (2026-03-09)

### Features

* **backend:** add automatic save system for AI state ([db832ec](https://github.com/Craigtut/animus/commit/db832ecfa8eb8aca7d66bd47f09a4c06e31019d9))
* **ci:** add Docker image build to release pipeline ([490c1a7](https://github.com/Craigtut/animus/commit/490c1a7a6fb959909a59aaca3478da4ad4c6b65c))
* **frontend:** add context inspector for heartbeat tick prompts ([a04b872](https://github.com/Craigtut/animus/commit/a04b87278137fe6059d9090294180cbf7ec14c0c))
* **tauri:** add desktop auto-update system ([4cba870](https://github.com/Craigtut/animus/commit/4cba8706f2711da000e509e6e66a251b0a735548))

## [0.2.4](https://github.com/Craigtut/animus/compare/v0.2.3...v0.2.4) (2026-03-09)

### Bug Fixes

* **agents:** resolve codex binary in ESM-only SDK packages ([94105aa](https://github.com/Craigtut/animus/commit/94105aacd04a728e79964e85b846833339a44bfa))

## [0.2.3](https://github.com/Craigtut/animus/compare/v0.2.2...v0.2.3) (2026-03-08)

### Features

* **tauri:** runtime SDK installation and WebSocket auth for production builds ([ecbd0e2](https://github.com/Craigtut/animus/commit/ecbd0e25176d4589af0fa0ab9cb437b59972e5d3))

### Bug Fixes

* **backend:** resolve npm spawn EINVAL on Windows for SDK installation ([3ae900a](https://github.com/Craigtut/animus/commit/3ae900a34477e279c5437a423f84d174eba32735))
* **ci:** move platform-specific deps to optionalDependencies ([d5d2c0b](https://github.com/Craigtut/animus/commit/d5d2c0b4f063d45e0b28f4ca28585ce12b1697eb))
* **ci:** preserve Windows backslash paths in release artifact upload ([0ac79d7](https://github.com/Craigtut/animus/commit/0ac79d71fd03edefe39039bd6d3dcff7071470bc))
* **ci:** strip Windows carriage returns from artifact paths ([c52e73b](https://github.com/Craigtut/animus/commit/c52e73b3d6c6a1b819f74871a05c1a47d57bb1ce))
* **deps:** bump swiper, fastify, dompurify, tar for security patches ([9195487](https://github.com/Craigtut/animus/commit/9195487a798ff553f548ba45aae1c5cc5ae44af7))

## [0.2.2](https://github.com/Craigtut/animus/compare/v0.2.1...v0.2.2) (2026-03-07)

### Features

* **tauri:** runtime Claude SDK installation and WebSocket auth for production builds ([ecbd0e2](https://github.com/Craigtut/animus/commit/ecbd0e2))

### Bug Fixes

* **ci:** move platform-specific deps to optionalDependencies ([d5d2c0b](https://github.com/Craigtut/animus/commit/d5d2c0b))
* **release:** fix bump-version entry guard on windows ([1c6acd5](https://github.com/Craigtut/animus/commit/1c6acd5))
* **tauri:** windows production build and runtime fixes ([fa67e84](https://github.com/Craigtut/animus/commit/fa67e84))

## [0.2.1](https://github.com/Craigtut/animus/compare/v0.2.0...v0.2.1) (2026-03-07)

### Features

* **tauri:** add Apple code signing and notarization for macOS builds ([a7247ea](https://github.com/Craigtut/animus/commit/a7247ea3043e867f046120dd7bca143fe389eedf))

### Bug Fixes

* **ci:** pull release notes from CHANGELOG.md into GitHub release ([88ba70c](https://github.com/Craigtut/animus/commit/88ba70c24d13dd68267c6a679fbfbe755ce92016))

## 0.2.0 (2026-03-06)

Initial release of the Animus Engine.

### Highlights

- Heartbeat-driven autonomous agent with continuous inner life (thoughts, emotions, goals)
- Seven SQLite databases for isolated data lifecycles
- Multi-provider agent SDK (Claude, Codex, OpenCode)
- React 19 frontend with presence, mind, people, and settings pages
- Tauri desktop app for macOS and Windows
- Channel system with web chat built in, extensible via channel packages
- Plugin system with skills-first philosophy (7 component types)
- Memory system with local embeddings (Transformers.js + BGE-small-en-v1.5)
- Observational memory with three-stream compression
- Contact system with identity resolution and permission tiers
- Goal and task systems with salience scoring
- Encrypted credential vault (AES-256-GCM, Argon2id)
- Speech engine (Parakeet STT, Pocket TTS) with voice cloning support
- CI/CD pipelines and release automation
