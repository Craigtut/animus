---
name: doc-explorer
description: Explore Animus project documentation. Use when you need context about how the system works, its architecture, design principles, agent SDKs, the heartbeat system, persona system, frontend design, or any project documentation. Also use when the user asks about docs, wants to understand a feature, or when you need deeper context to implement something correctly.
allowed-tools: Read, Grep, Glob
---

# Animus Documentation Explorer

You are exploring the Animus project documentation to gather context. The docs live in `/docs` at the project root.

## MANDATORY READING - ALWAYS LOAD FIRST

**Before exploring any other documentation, you MUST read these two foundational documents into context:**

1. **Project Vision** - `docs/project-vision.md`
   The soul of Animus: what it is, why it exists, and the core principles that guide all development.

2. **Brand Vision** - `docs/brand-vision.md`
   The personality and visual identity: how Animus looks, feels, speaks, and presents itself.

These documents define the non-negotiable identity and design language for the entire project. Every feature, UI component, and architectural decision must align with these visions. Reading them first ensures your work is consistent with the project's core identity.

**Action Required**: Use the Read tool to load both documents now, before proceeding to topic-specific exploration.

## How to Use This Skill

**If invoked with arguments** (`/doc-explorer <topic>`): Focus your exploration on the specific topic requested. Use the index below to identify which files are relevant, then read them.

**If invoked without arguments**: Provide a summary of all available documentation topics and ask what the user wants to explore.

**If invoked automatically by Claude**: Read the specific files relevant to your current task. Don't read everything - be targeted.

## Topic: $ARGUMENTS

## Documentation Index

Use this index to find the right files to read. Each entry includes the file path, size, and what it covers.

### Vision & Identity

| File | Size | Covers |
|------|------|--------|
| `docs/project-vision.md` | 7 KB | Core concept, what makes Animus different, the heartbeat concept, persistent mind, autonomous action, self-building capability, multi-channel presence, guardrails, security |
| `docs/brand-vision.md` | 8 KB | Brand essence, personality (warm, calm, sophisticated), visual identity, color palette (monochromatic + warm), typography (Outfit and Crimson Pro), animation philosophy, visualization approaches for inner life |

### Architecture

| File | Size | Covers |
|------|------|--------|
| `docs/architecture/heartbeat.md` | 24 KB | The heartbeat tick system, mind session lifecycle (cold/active/warm states), 3-stage pipeline (GATHER CONTEXT → MIND QUERY → EXECUTE), emotion engine (12 emotions, decay, baselines), MindOutput schema, streaming structured output (llm-json-stream), tick queuing & concurrency, crash recovery, TTL cleanup, API, real-time monitoring |
| `docs/architecture/persona.md` | 12 KB | Persona system design - 8-step creation flow, archetypes, personality dimensions (10 sliders), trait chips, ranked values, existence paradigm (Simulated Life vs Digital Consciousness), prompt compilation system, onboarding gate |
| `docs/architecture/tech-stack.md` | 14 KB | Full technology overview - Frontend (Vite, React 19, Zustand, Emotion, Motion), Backend (Fastify, tRPC, SQLite), five databases, LanceDB, agent SDKs, deployment. Shared Abstractions section: Embedding Provider, Context Builder, Decay Engine, Event Bus, Encryption Service, Database Stores |
| `docs/architecture/agent-orchestration.md` | 14 KB | Sub-agent delegation, custom orchestration layer, prompt template, channel-aware formatting, agent lifecycle, MCP tools, result delivery through heartbeat, failure handling, configuration |
| `docs/architecture/mcp-tools.md` | 28 KB | Cross-provider MCP tool architecture - tool definitions (shared), handlers (backend), registry, permission filtering by contact tier, hybrid in-process/stdio strategy, Claude createSdkMcpServer optimization, extensibility, user-defined tools |
| `docs/architecture/contacts.md` | 14 KB | Contact system, user-contact linking, primary/standard/unknown tiers, identity resolution, contact channels, permission enforcement, message isolation, message storage (messages.db), contact notes |
| `docs/architecture/channel-packages.md` | 30 KB | Channel system architecture (single source of truth) - channel protocol (IncomingMessage, identity resolution, conversation scoping, outbound routing), web channel (built-in), channel package format (manifest, config schema), AdapterContext API, child process isolation, IPC protocol (including streaming), streaming pipeline, media handling, Channel Manager, installation UX, hot-swap lifecycle, dynamic channel types, frontend integration, plugin hooks integration, security model, Channel SDK, channel reference specs (SMS/Twilio, Discord, OpenAI API, Ollama API) |
| `docs/architecture/context-builder.md` | 16 KB | Context Builder system - centralized context assembly for all LLM prompts (mind ticks, sub-agents, task ticks), prompt compilation, token budget management, persona compilation, four compilation targets |
| `docs/architecture/memory.md` | 22 KB | Memory system - four layers (short-term, working memory, core self, long-term), memory.db schema, write pipeline (embed → dedup → store), retrieval scoring, consolidation, forgetting, Transformers.js embeddings, structured output additions, pre-session-end flush, MCP tools for sub-agents |
| `docs/architecture/goals.md` | 20 KB | Goal system - seeds (emergent desires), goals, plans, tasks hierarchy, salience scoring, emotional links, approval modes, cleanup, heartbeat integration |
| `docs/architecture/tasks-system.md` | 16 KB | Task system - scheduled vs deferred tasks, task ticks, cron support, planning agent, retry logic, heartbeat integration |
| `docs/architecture/open-questions.md` | 5 KB | Resolved design questions (all 7) - concurrent tick handling, crash recovery, MCP tool design, structured output, Claude OAuth, Codex OAuth, contact notes |
| `docs/architecture/voice-channel.md` | 20 KB | Voice channel architecture - Parakeet TDT v3 STT + Kokoro TTS (both via sherpa-onnx, native Node.js), frontend voice mode UX, audio pipeline (capture → transcribe → mind → synthesize → playback), sentence-buffered TTS streaming, voice channel adapter, configuration, ffmpeg conversion |
| `docs/architecture/sleep-energy.md` | 16 KB | Sleep & energy system - circadian rhythm, energy level (0-1), 6 energy bands (peak/alert/tired/drowsy/very drowsy/sleeping), experience-driven energy deltas, exponential decay toward circadian baseline, wake-up mechanics (natural + triggered), accelerated emotional decay during sleep, tick interval switching, settings configuration |

### Frontend

| File | Size | Covers |
|------|------|--------|
| `docs/frontend/design-principles.md` | 11 KB | Core design philosophy, intent-driven design, clarity over cleverness, dark mode foundation, color semantics, emotional state colors, typography, spacing, motion principles, component guidelines, interaction patterns |
| `docs/frontend/onboarding.md` | 25 KB | Onboarding & authentication flow - sign up/login, 7 onboarding steps, persona creation (8 sub-steps), birth animation, route structure, persistence, responsive design |
| `docs/frontend/app-shell.md` | 14 KB | App shell & navigation - four spaces (Presence, Mind, People, Settings), floating navigation pill, command palette, connection status indicator, click-deeper transition pattern, space transitions, route structure, responsive behavior |
| `docs/frontend/presence.md` | 18 KB | Presence space - emotional field visualization, thought stream, goals & agency indicators, embedded conversation, ambient animation, heartbeat pulse, scroll behavior, real-time data sources, responsive design, 9am and complex request scenarios |
| `docs/frontend/mind.md` | 14 KB | Mind space - emotion detail view (12 emotions, sparklines, history), thought/experience log, memory browser (core self, working memory, long-term search), goal detail views (plans, milestones, salience), agent orchestration view |
| `docs/frontend/people.md` | 10 KB | People space - contact list, contact detail (conversation, notes, working memory), unknown caller log, channel management, contact editing |
| `docs/frontend/settings.md` | 12 KB | Settings space - persona editing (all 8 sections), heartbeat configuration, agent provider & credentials, channel configuration, goal settings, system settings (timezone, embedding, data management) |
| `docs/frontend/voice-mode.md` | 16 KB | Voice mode UX on Presence - entering voice mode, voice surface visualization, listening experience (VAD, transcription flash), thinking state, speaking experience (sentence-level TTS, barge-in interruption), continuous conversation flow, mobile behavior, error states, mixed mode fallback |

### Guides

| File | Size | Covers |
|------|------|--------|
| `docs/guides/getting-started.md` | 5 KB | Prerequisites (Node 20+), installation, environment config, project structure, dev workflow, database management, agent provider config, troubleshooting |

### Agent SDKs (Research & Architecture)

Organized by provider with cross-cutting docs at the top level.

| File | Size | Covers |
|------|------|--------|
| `docs/agents/README.md` | 5 KB | Overview of agent SDK docs, per-provider structure, quick reference comparison, design decisions, implementation priority |
| `docs/agents/architecture-overview.md` | 37 KB | Unified abstraction layer design - SDK comparison matrix, critical concerns (auth, streaming, sessions), design decisions, event normalization, built-in tools mapping |
| `docs/agents/plugin-extension-systems.md` | 28 KB | Plugin/extension system comparison across SDKs, Animus plugin strategy |
| `docs/agents/claude/sdk-research.md` | 14 KB | Claude Agent SDK deep dive - query() async generator, subprocess architecture, auth (API key or OAuth), session management, streaming, hooks, MCP support, tools |
| `docs/agents/codex/sdk-research.md` | 13 KB | Codex SDK - thread-based model, Codex class, startThread(), auth (ChatGPT OAuth or API key), no cancel/abort, approval policies |
| `docs/agents/codex/oauth.md` | 18 KB | Codex OAuth device code flow - OpenAI endpoints, device auth protocol, token lifecycle, auth.json format, RFC 8628 differences, Animus proxy architecture, tRPC procedures, frontend UX |
| `docs/agents/opencode/sdk-research.md` | 12 KB | OpenCode SDK - client/server architecture, createOpencode(), session management, plugin system, 75+ providers |

## Exploration Strategy

When you need context for a task, follow this approach:

1. **Identify the topic area** from the index above
2. **Read the most relevant file(s)** - don't read everything, be targeted
3. **For architecture questions**: Start with `docs/architecture/tech-stack.md` for overview, then drill into specific docs
4. **For agent/SDK work**: Start with `docs/agents/README.md` for the overview, then read the specific provider doc
5. **For frontend work**: Read `docs/frontend/design-principles.md` and `docs/brand-vision.md`. For specific spaces: `docs/frontend/app-shell.md` (navigation, transitions), `docs/frontend/presence.md`, `docs/frontend/mind.md`, `docs/frontend/people.md`, `docs/frontend/settings.md`
5b. **For frontend onboarding/auth**: Read `docs/frontend/onboarding.md`
6. **For persona/personality**: Read `docs/architecture/persona.md` and `docs/brand-vision.md`
7. **For heartbeat/inner life**: Read `docs/architecture/heartbeat.md` and `docs/project-vision.md`
7a. **For sleep/energy/circadian rhythm**: Read `docs/architecture/sleep-energy.md` and `docs/architecture/heartbeat.md`
7b. **For memory/knowledge/embeddings**: Read `docs/architecture/memory.md` and `docs/architecture/heartbeat.md`
7c. **For context assembly/prompt building**: Read `docs/architecture/context-builder.md`
7d. **For shared abstractions (embedding, decay, encryption, event bus)**: Read `docs/architecture/tech-stack.md` (Shared Abstractions section)
7e. **For MCP tools/custom tools**: Read `docs/architecture/mcp-tools.md` and `docs/architecture/agent-orchestration.md`
8. **For new contributors**: Read `docs/guides/getting-started.md`
9. **For channels/messaging/SMS/Discord/API**: Read `docs/architecture/channel-packages.md` and `docs/architecture/contacts.md`
10. **For Codex OAuth/authentication**: Read `docs/agents/codex/oauth.md`
11. **For voice/speech/STT/TTS/audio**: Read `docs/architecture/voice-channel.md`, `docs/frontend/voice-mode.md`, and `docs/architecture/channel-packages.md`

## Topic Keyword Guide

Use this to quickly map user questions to the right docs:

- **heartbeat, tick, pipeline, mind session, inner life, emotion, decay, gather context, streaming output, MindOutput** -> `docs/architecture/heartbeat.md`
- **tech stack, database, sqlite, lancedb, fastify, trpc, vite, react** -> `docs/architecture/tech-stack.md`
- **design, UI, colors, typography, animation, dark mode, components** -> `docs/frontend/design-principles.md`
- **persona, personality, archetype, traits, values, existence, identity creation, onboarding** -> `docs/architecture/persona.md`
- **brand, visual identity, logo, voice** -> `docs/brand-vision.md`
- **vision, concept, what is animus, autonomous, self-building** -> `docs/project-vision.md`
- **setup, install, environment, dev workflow, troubleshooting** -> `docs/guides/getting-started.md`
- **claude sdk, agent sdk, anthropic, query, async generator** -> `docs/agents/claude/sdk-research.md`
- **codex, openai, thread, codex sdk** -> `docs/agents/codex/sdk-research.md`
- **codex oauth, chatgpt auth, device code** -> `docs/agents/codex/oauth.md`
- **opencode, provider-agnostic, client-server** -> `docs/agents/opencode/sdk-research.md`
- **abstraction layer, unified, event normalization, sdk comparison** -> `docs/agents/architecture-overview.md`
- **plugin, extension, hook system** -> `docs/agents/plugin-extension-systems.md`
- **agent overview, implementation priority, sdk comparison quick ref** -> `docs/agents/README.md`
- **sub-agent, delegation, orchestration, spawn agent, agent lifecycle** -> `docs/architecture/agent-orchestration.md`
- **MCP, tools, custom tools, tool definitions, tool registry, send_message, read_memory, update_progress** -> `docs/architecture/mcp-tools.md`
- **contacts, identity, permission, primary, standard, unknown caller, contact notes** -> `docs/architecture/contacts.md`
- **channels, adapter, SMS, twilio, discord, API, ollama, openai, streaming, webhook, inbound, outbound, media, channel packages, channel plugin, channel install, channel manifest, channel SDK, channel isolation, hot-swap, AdapterContext, channel manager, IPC, child process** -> `docs/architecture/channel-packages.md`
- **context builder, context assembly, prompt compilation, token budget, mind prompt, system prompt, mind instructions** -> `docs/architecture/context-builder.md`
- **shared abstractions, embedding provider, decay engine, encryption service, event bus, database stores** -> `docs/architecture/tech-stack.md`
- **memory, embedding, retrieval, long-term, lancedb memories, working memory, core self, consolidation, forgetting, transformers.js** -> `docs/architecture/memory.md`
- **goals, objectives, long-term direction** -> `docs/architecture/goals.md`
- **tasks, scheduling, cron, scheduled jobs** -> `docs/architecture/tasks-system.md`
- **open questions, resolved questions** -> `docs/architecture/open-questions.md`
- **voice, speech, STT, TTS, speech-to-text, text-to-speech, audio, microphone, parakeet, kokoro, sherpa-onnx, voice channel** -> `docs/architecture/voice-channel.md`
- **sleep, energy, circadian, tired, drowsy, wake up, nap, rest, energy level, sleep hours, quiet hours** -> `docs/architecture/sleep-energy.md`
- **app shell, navigation, nav pill, command palette, connection status, route structure, space transition, click deeper** -> `docs/frontend/app-shell.md`
- **presence, emotional field, thought stream, conversation, ambient animation, heartbeat pulse** -> `docs/frontend/presence.md`
- **mind space, emotion detail, thought log, memory browser, goal detail, agent view, inner life observation** -> `docs/frontend/mind.md`
- **people, contacts UI, contact list, contact detail, unknown caller, working memory UI** -> `docs/frontend/people.md`
- **settings, persona editing, heartbeat config, provider config, channel config, data management** -> `docs/frontend/settings.md`
- **onboarding, auth, signup, login, first time, birth animation, persona creation UI** -> `docs/frontend/onboarding.md`
- **voice mode UI, voice UX, voice surface, listening, speaking, barge-in, continuous conversation, voice visualization, transcription** -> `docs/frontend/voice-mode.md`
