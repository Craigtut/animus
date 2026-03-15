---
name: doc-explorer
description: Explore Animus project documentation. Use when you need context about how the system works, its architecture, design principles, agent SDKs, the heartbeat system, persona system, or any project documentation. Also use when the user asks about docs, wants to understand a feature, or when you need deeper context to implement something correctly.
allowed-tools: Read Grep Glob
---

# Animus Documentation Explorer

You are exploring the Animus project documentation to gather context. The docs live in `/docs` at the project root.

## MANDATORY READING - ALWAYS LOAD FIRST

**Before exploring any other documentation, you MUST read these two foundational documents into context:**

1. **Product Vision** - `docs/product-vision.md`
   The soul of Animus: what it is, why it exists, and the core principles that guide all development.

2. **Brand Vision** - `docs/brand-vision.md`
   The personality and visual identity: how Animus looks, feels, speaks, and presents itself.

These documents define the non-negotiable identity and design language for the entire project. Every feature, UI component, and architectural decision must align with these visions. Reading them first ensures your work is consistent with the project's core identity.

**Action Required**: Use the Read tool to load both documents now, before proceeding to topic-specific exploration.

## How to Use This Skill

**If invoked with arguments** (`/doc-explorer <topic>`): Focus your exploration on the specific topic requested. Use the index below to identify which files are relevant, then read them.

**If invoked without arguments**: Provide a summary of all available documentation topics and ask what the user wants to explore.

**If invoked automatically by Claude**: Read the specific files relevant to your current task. Don't read everything, be targeted.

## Topic: $ARGUMENTS

## Documentation Index

Use this index to find the right files to read. Each entry includes the file path and what it covers.

### Vision, Identity & Design

| File | Covers |
|------|--------|
| `docs/product-vision.md` | Core concept, what makes Animus different, the heartbeat concept, persistent mind, autonomous action, self-building capability, multi-channel presence, guardrails, security |
| `docs/brand-vision.md` | Brand essence, personality (warm, calm, sophisticated), visual identity, color palette (monochromatic + warm), typography (Outfit and Crimson Pro), animation philosophy, visualization approaches for inner life |
| `docs/design-principles.md` | Core design philosophy, intent-driven design, clarity over cleverness, dark mode foundation, color semantics, emotional state colors, typography, spacing, motion principles, component guidelines, interaction patterns |

### Architecture (Backend)

| File | Covers |
|------|--------|
| `docs/architecture/heartbeat.md` | The heartbeat tick system, mind session lifecycle (cold/active/warm states), 3-stage pipeline (GATHER CONTEXT, MIND QUERY, EXECUTE), 5 tick triggers (interval, message, scheduled_task, agent_complete, plugin_trigger), emotion engine (12 emotions, decay, baselines), MindOutput schema, streaming structured output, tick queuing and concurrency, crash recovery, TTL cleanup |
| `docs/architecture/context-builder.md` | Context Builder system, centralized context assembly for all LLM prompts (mind ticks, sub-agents, task ticks), prompt compilation, token budget management, persona compilation, four compilation targets |
| `docs/architecture/persona.md` | Persona system design, 8-step creation flow, archetypes, personality dimensions (10 sliders), trait chips, ranked values, existence paradigm (Simulated Life vs Digital Consciousness), prompt compilation system, onboarding gate |
| `docs/architecture/memory.md` | Memory system, four layers (short-term, working memory, core self, long-term), memory.db schema, write pipeline (embed, dedup, store), retrieval scoring, consolidation, forgetting, Transformers.js embeddings |
| `docs/architecture/observational-memory.md` | Three-stream compression (messages/thoughts/experiences), Observer and Reflector agents, token-based thresholds, batch threshold mechanism, async processing in EXECUTE phase, temporal annotations |
| `docs/architecture/goals.md` | Goal system, seeds (emergent desires), goals, plans, tasks hierarchy, salience scoring, emotional links, approval modes, cleanup, heartbeat integration |
| `docs/architecture/tasks-system.md` | Task system, scheduled vs deferred tasks, task ticks, cron support, planning agent, retry logic, heartbeat integration |
| `docs/architecture/contacts.md` | Contact system, user-contact linking, primary/standard/unknown tiers, identity resolution, contact channels, permission enforcement, message isolation |
| `docs/architecture/agent-orchestration.md` | Sub-agent delegation, custom orchestration layer, prompt template, channel-aware formatting, agent lifecycle, MCP tools, result delivery through heartbeat, failure handling |
| `docs/architecture/sleep-energy.md` | Sleep and energy system, circadian rhythm, energy level (0-1), 6 energy bands, experience-driven energy deltas, exponential decay toward circadian baseline, wake-up mechanics, accelerated emotional decay during sleep |
| `docs/architecture/mcp-tools.md` | Cross-provider MCP tool architecture, tool definitions (shared), handlers (backend), registry, permission filtering by contact tier, hybrid in-process/stdio strategy |
| `docs/architecture/tool-permissions.md` | Tool permission and approval system, three permission states (off/ask/always_allow), four risk tiers, two-tick approval pattern, deterministic approval interceptor (phrase matching), one-at-a-time enforcement, canUseTool callback, trust ramp, sub-agent filtering |
| `docs/architecture/plugin-system.md` | Plugin system architecture, skills-first philosophy, 7 component types (skills, MCP tools, context sources, hooks, decision types, triggers, agents), manifest format, config schemas, credential handling, hot-swap lifecycle, security model |
| `docs/architecture/channel-packages.md` | Channel system architecture (single source of truth), channel protocol (IncomingMessage, identity resolution, conversation scoping, outbound routing), web channel (built-in), channel package format, AdapterContext API, child process isolation, IPC protocol, streaming pipeline, media handling, Channel Manager, hot-swap lifecycle, security model, Channel SDK |
| `docs/architecture/channels.md` | Channel reference specs for specific adapters: SMS/Twilio, Discord, OpenAI API, Ollama API. Protocol-level implementation details. See channel-packages.md for system architecture. |
| `docs/architecture/voice-channel.md` | Voice channel architecture, frontend voice mode UX, audio pipeline (capture, transcribe, mind, synthesize, playback), sentence-buffered TTS streaming, voice channel adapter. See speech-engine.md for engine internals. |
| `docs/architecture/speech-engine.md` | Shared speech engine, STTEngine (sherpa-onnx Parakeet TDT v3), TTSEngine (@animus-labs/tts-native, Pocket TTS), VoiceManager, zero-shot voice cloning, lazy loading, voice manifest, MCP tools. See voice-channel.md for interaction layer. |
| `docs/architecture/tts-licensing-and-distribution.md` | TTS model licensing (CC-BY-4.0), redistribution compliance, weight bundling approach, voice cloning consent flow, attribution requirements. See speech-engine.md for technical details. |
| `docs/architecture/encryption-architecture.md` | Encryption architecture (implemented), password-derived keys (Argon2id), envelope encryption (DEK wrapped with password key), sealed/unsealed server states, vault.json format, unlock paths, file deny list, deployment scenarios, threat model |
| `docs/architecture/credential-passing.md` | Agent-blind credential pattern, four credential storage locations, plugin credentials (three injection paths), channel credentials (IPC injection), password vault, credential audit logging, frontend credential UI, security boundaries |
| `docs/architecture/data-directory.md` | Data directory layout (`ANIMUS_DATA_DIR`), directory structure, secrets lifecycle, deployment modes (dev, Docker, Tauri, custom) |
| `docs/architecture/package-installation.md` | Package distribution (.anpk install flow), verification chain, rollback, update checking, config migration, store browser UI. **STATUS: PARTIALLY IMPLEMENTED** |
| `docs/architecture/backend-architecture.md` | Backend modular monolith architecture: store patterns, service layer, subsystem lifecycles, pipeline deps, decision handler registry, anti-patterns |
| `docs/architecture/release-engineering.md` | Release engineering: versioning policy (lockstep vs independent packages), conventional commits, CI pipeline (typecheck/lint/test), release workflow (tag-triggered Tauri builds for macOS + Windows), bump-version and release scripts, cross-compilation, code signing (future), changelog generation |
| `docs/architecture/telemetry.md` | Telemetry system: 5 PostHog events (install, app_started, daily_active, feature_used, error_occurred), anonymous ID, deduplication, opt-out mechanisms, privacy guarantees, TelemetryService singleton, event bus integration |
| `docs/architecture/tech-stack.md` | Full technology overview, frontend stack (Vite, React 19, Zustand, Emotion, Motion), backend stack (Fastify, tRPC, SQLite), seven databases, LanceDB, agent SDKs, deployment paths, shared abstractions (Embedding Provider, Context Builder, Decay Engine, Event Bus, Encryption Service, Database Stores, Migrations) |

### Agent SDKs

| File | Covers |
|------|--------|
| `docs/agents/README.md` | Overview of agent SDK docs, per-provider structure, quick reference comparison, design decisions, implementation priority |
| `docs/agents/sdk-comparison.md` | Consolidated comparison of Claude vs Codex vs OpenCode: authentication, streaming, tools, sessions, cost tracking, trade-offs, when to use each |
| `docs/agents/architecture-overview.md` | Unified abstraction layer design, SDK comparison matrix, critical concerns (auth, streaming, sessions), design decisions, event normalization, built-in tools mapping |
| `docs/agents/sdk-cli-architecture.md` | How agent SDK CLIs are bundled and resolved (Claude bundled cli.js, Codex native binaries, path resolution) |
| `docs/agents/claude/sdk-research.md` | Claude Agent SDK deep dive: query() async generator, subprocess architecture, auth, session management, streaming, hooks, MCP support. **STATUS: REFERENCE** |
| `docs/agents/codex/sdk-research.md` | Codex SDK: thread-based model, auth (ChatGPT OAuth or API key), approval policies. **STATUS: REFERENCE** |
| `docs/agents/codex/oauth.md` | Codex OAuth device code flow: OpenAI endpoints, device auth protocol, token lifecycle, auth.json format, Animus proxy architecture, tRPC procedures. **STATUS: REFERENCE** |
| `docs/agents/codex/app-server-protocol.md` | Codex app-server JSON-RPC protocol: initialization handshake, method inventory, turn management. **STATUS: REFERENCE** |
| `docs/agents/opencode/sdk-research.md` | OpenCode SDK: client/server architecture, session management, plugin system, 75+ providers. **STATUS: REFERENCE** |

### Research (Planned/Exploratory)

| File | Covers |
|------|--------|
| `docs/research/reflex-system.md` | Reflex fast-response system design: dual-path voice architecture, Vercel AI SDK, lightweight context assembly. **STATUS: PLANNED, not implemented.** |
| `docs/research/voice-mode.md` | Frontend voice mode UX design: mic button, voice visualization, VAD, listening/speaking states. **STATUS: PLANNED, not implemented.** |
| `docs/research/tauri-v2-os-features.md` | Tauri v2 desktop features research: system tray, autostart, global shortcuts, background audio. **STATUS: RESEARCH, not implemented.** |
| `docs/research/twilio-mms-media-hosting.md` | Twilio MMS media hosting options: ImgBB, Cloudflare R2, pluggable hosting. **STATUS: RESEARCH, not implemented.** |
| `docs/research/Claude-Agent-SDK-Research.md` | Deep Claude Agent SDK API reference. **STATUS: REFERENCE** |
| `docs/research/opencode-sdk-research.md` | Deep OpenCode SDK API reference. **STATUS: REFERENCE** |
| `docs/research/agentic-loop-architecture.md` | Blueprint for building Animus's own agentic loop. Covers Pi Agent Core patterns, Claude Code internals comparison, missing features checklist (compaction, budget guards, permissions, MCP, sub-agents), implementation phases, single-vs-double loop analysis. **STATUS: RESEARCH, active design.** |
| `docs/agents/pi/research/sdk-research.md` | Pi AI + Pi Agent Core research: in-process library, transformContext hook, multi-provider gateway. **STATUS: RESEARCH, Pi adapter not implemented.** |
| `docs/agents/pi/research/adapter-implementation.md` | Pi adapter implementation plan: PiAdapter/PiSession design, transformContext exposure, MCP tool bridging. **STATUS: RESEARCH, not implemented.** |

### Guides

| File | Covers |
|------|--------|
| `docs/guides/getting-started.md` | Prerequisites (Node 24+), installation, environment config, project structure, dev workflow, database management, agent provider config, troubleshooting |

## Exploration Strategy

When you need context for a task, follow this approach:

1. **Identify the topic area** from the index above
2. **Read the most relevant file(s)**, don't read everything, be targeted
3. **For architecture questions**: Start with `docs/architecture/tech-stack.md` for overview, then drill into specific docs
4. **For agent/SDK work**: Start with `docs/agents/sdk-comparison.md` for the comparison, then read the specific provider doc
5. **For frontend work**: Read `docs/design-principles.md` and `docs/brand-vision.md`. Frontend page specs have been removed; the code in `packages/frontend/src/` is the authoritative source.
6. **For persona/personality**: Read `docs/architecture/persona.md` and `docs/brand-vision.md`
7. **For heartbeat/inner life**: Read `docs/architecture/heartbeat.md` and `docs/product-vision.md`
8. **For sleep/energy/circadian rhythm**: Read `docs/architecture/sleep-energy.md`
9. **For memory/knowledge/embeddings**: Read `docs/architecture/memory.md`
10. **For observational memory/compression**: Read `docs/architecture/observational-memory.md`
11. **For context assembly/prompt building**: Read `docs/architecture/context-builder.md`
12. **For shared abstractions (embedding, decay, encryption, event bus)**: Read `docs/architecture/tech-stack.md` (Shared Abstractions section)
13. **For MCP tools/custom tools**: Read `docs/architecture/mcp-tools.md`
14. **For tool permissions/approval flow**: Read `docs/architecture/tool-permissions.md`
15. **For plugin system**: Read `docs/architecture/plugin-system.md`
16. **For channels/messaging**: Read `docs/architecture/channel-packages.md` (system architecture) and `docs/architecture/channels.md` (adapter specs)
17. **For contacts/identity/permissions**: Read `docs/architecture/contacts.md`
18. **For voice/speech/STT/TTS**: Read `docs/architecture/voice-channel.md` and `docs/architecture/speech-engine.md`
19. **For encryption/vault**: Read `docs/architecture/encryption-architecture.md`
20. **For release engineering/CI/CD/versioning**: Read `docs/architecture/release-engineering.md`
20. **For credentials/secrets/agent-blind pattern**: Read `docs/architecture/credential-passing.md`
21. **For data directory layout**: Read `docs/architecture/data-directory.md`
22. **For sub-agent orchestration**: Read `docs/architecture/agent-orchestration.md`
23. **For backend architecture patterns**: Read `docs/architecture/backend-architecture.md`
24. **For new contributors**: Read `docs/guides/getting-started.md`
25. **For reflex/fast-response (PLANNED)**: Read `docs/research/reflex-system.md`
26. **For Codex OAuth**: Read `docs/agents/codex/oauth.md`
27. **For telemetry/analytics/PostHog**: Read `docs/architecture/telemetry.md`

## Topic Keyword Guide

Use this to quickly map user questions to the right docs:

- **heartbeat, tick, pipeline, mind session, inner life, emotion, decay, gather context, streaming output, MindOutput, plugin trigger** -> `docs/architecture/heartbeat.md`
- **tech stack, database, sqlite, lancedb, fastify, trpc, vite, react, shared abstractions, embedding provider, decay engine, encryption service, event bus, database stores** -> `docs/architecture/tech-stack.md`
- **design, UI, colors, typography, animation, dark mode, components, interaction patterns** -> `docs/design-principles.md`
- **persona, personality, archetype, traits, values, existence, identity creation** -> `docs/architecture/persona.md`
- **brand, visual identity, logo, voice** -> `docs/brand-vision.md`
- **vision, concept, what is animus, autonomous, self-building** -> `docs/product-vision.md`
- **setup, install, environment, dev workflow, troubleshooting** -> `docs/guides/getting-started.md`
- **plugin, extension, hook system, plugin architecture, skills-first, SKILL.md** -> `docs/architecture/plugin-system.md`
- **sub-agent, delegation, orchestration, spawn agent, agent lifecycle** -> `docs/architecture/agent-orchestration.md`
- **MCP, tools, custom tools, tool definitions, tool registry, send_message, read_memory** -> `docs/architecture/mcp-tools.md`
- **tool permissions, tool approval, ask first, always allow, risk tier, trust ramp** -> `docs/architecture/tool-permissions.md`
- **contacts, identity, permission, primary, standard, unknown caller** -> `docs/architecture/contacts.md`
- **channels, adapter, SMS, twilio, discord, API, ollama, openai, channel packages, channel manifest, channel SDK, channel isolation, hot-swap** -> `docs/architecture/channel-packages.md`
- **channel reference, channel specs, twilio config, discord config, ollama config** -> `docs/architecture/channels.md`
- **context builder, context assembly, prompt compilation, token budget, system prompt** -> `docs/architecture/context-builder.md`
- **memory, embedding, retrieval, long-term, lancedb, working memory, core self, consolidation, forgetting** -> `docs/architecture/memory.md`
- **observational memory, observer, reflector, compression, token threshold** -> `docs/architecture/observational-memory.md`
- **goals, objectives, seeds, salience, plans** -> `docs/architecture/goals.md`
- **tasks, scheduling, cron, scheduled jobs, deferred tasks** -> `docs/architecture/tasks-system.md`
- **voice, speech, STT, TTS, audio, microphone, parakeet, pocket tts, sherpa-onnx** -> `docs/architecture/voice-channel.md`, `docs/architecture/speech-engine.md`
- **speech engine, voice manager, voice cloning, voice manifest** -> `docs/architecture/speech-engine.md`
- **tts licensing, model distribution, voice cloning consent, attribution** -> `docs/architecture/tts-licensing-and-distribution.md`
- **sleep, energy, circadian, tired, drowsy, wake up, energy level** -> `docs/architecture/sleep-energy.md`
- **encryption, vault, sealed, unsealed, password-derived key, DEK, Argon2id** -> `docs/architecture/encryption-architecture.md`
- **credential, API key, secret, agent-blind, credential manifest, run_with_credentials, vault entries** -> `docs/architecture/credential-passing.md`
- **data directory, ANIMUS_DATA_DIR, database paths, deployment modes** -> `docs/architecture/data-directory.md`
- **package installation, .anpk, store browser, update checking** -> `docs/architecture/package-installation.md`
- **backend architecture, modular monolith, store pattern, service layer, decision handler** -> `docs/architecture/backend-architecture.md`
- **telemetry, analytics, PostHog, usage tracking, anonymous, opt-out, DO_NOT_TRACK** -> `docs/architecture/telemetry.md`
- **agent SDK, sdk comparison, claude vs codex vs opencode** -> `docs/agents/sdk-comparison.md`
- **agent abstraction, unified interface, event normalization** -> `docs/agents/architecture-overview.md`
- **claude sdk, anthropic, query, async generator** -> `docs/agents/claude/sdk-research.md`
- **codex, openai, thread, codex sdk** -> `docs/agents/codex/sdk-research.md`
- **codex oauth, chatgpt auth, device code** -> `docs/agents/codex/oauth.md`
- **opencode, provider-agnostic, client-server** -> `docs/agents/opencode/sdk-research.md`
- **pi, pi-ai, transformContext, multi-provider** -> `docs/agents/pi/research/sdk-research.md`
- **reflex, fast response, voice latency, dual path, Vercel AI SDK** -> `docs/research/reflex-system.md`
- **voice mode UI, voice UX, voice visualization, barge-in** -> `docs/research/voice-mode.md`
