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

# Changelog

All notable changes to the Animus Engine will be documented in this file.

This project uses [Conventional Commits](https://www.conventionalcommits.org/) and [Semantic Versioning](https://semver.org/).

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
