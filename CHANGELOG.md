# Changelog

All notable changes to the Animus Engine will be documented in this file.

This project uses [Conventional Commits](https://www.conventionalcommits.org/) and [Semantic Versioning](https://semver.org/).

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
