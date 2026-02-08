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
| `docs/brand-vision.md` | 8 KB | Brand essence, personality (warm, calm, sophisticated), visual identity, color palette (monochromatic + warm), typography (Plus Jakarta Sans), animation philosophy, visualization approaches for inner life |

### Architecture

| File | Size | Covers |
|------|------|--------|
| `docs/architecture/heartbeat.md` | 24 KB | The heartbeat tick system, mind session lifecycle (cold/active/warm states), 3-stage pipeline (GATHER CONTEXT → MIND QUERY → EXECUTE), emotion engine (12 emotions, decay, baselines), MindOutput schema, streaming structured output (llm-json-stream), tick queuing & concurrency, crash recovery, TTL cleanup, API, real-time monitoring |
| `docs/architecture/persona.md` | 12 KB | Persona system design - 8-step creation flow, archetypes, personality dimensions (10 sliders), trait chips, ranked values, existence paradigm (Simulated Life vs Digital Consciousness), prompt compilation system, onboarding gate |
| `docs/architecture/tech-stack.md` | 14 KB | Full technology overview - Frontend (Vite, React 19, Zustand, Emotion, Motion), Backend (Fastify, tRPC, SQLite), five databases, LanceDB, agent SDKs, deployment. Shared Abstractions section: Embedding Provider, Context Builder, Decay Engine, Event Bus, Encryption Service, Database Stores |
| `docs/architecture/agent-orchestration.md` | 14 KB | Sub-agent delegation, custom orchestration layer, prompt template, channel-aware formatting, agent lifecycle, MCP tools, result delivery through heartbeat, failure handling, configuration |
| `docs/architecture/mcp-tools.md` | 28 KB | Cross-provider MCP tool architecture - tool definitions (shared), handlers (backend), registry, permission filtering by contact tier, hybrid in-process/stdio strategy, Claude createSdkMcpServer optimization, extensibility, user-defined tools |
| `docs/architecture/contacts.md` | 14 KB | Contact system, user-contact linking, primary/standard/unknown tiers, identity resolution, contact channels, permission enforcement, message isolation, message storage (messages.db), contact notes |
| `docs/architecture/channels.md` | 18 KB | Channel adapter layer - IncomingMessage interface, identity resolution, Web/tRPC, SMS/Twilio (webhooks, MMS, signature validation), Discord/discord.js (bot, intents, conversation scoping), OpenAI-compatible API (SSE streaming), Ollama-compatible API (NDJSON streaming), streaming pipeline, media handling, credential management, outbound routing, channel lifecycle |
| `docs/architecture/context-builder.md` | 16 KB | Context Builder system - centralized context assembly for all LLM prompts (mind ticks, sub-agents, task ticks), prompt compilation, token budget management, persona compilation, four compilation targets |
| `docs/architecture/memory.md` | 22 KB | Memory system - four layers (short-term, working memory, core self, long-term), memory.db schema, write pipeline (embed → dedup → store), retrieval scoring, consolidation, forgetting, Transformers.js embeddings, structured output additions, pre-session-end flush, MCP tools for sub-agents |
| `docs/architecture/goals.md` | 20 KB | Goal system - seeds (emergent desires), goals, plans, tasks hierarchy, salience scoring, emotional links, approval modes, cleanup, heartbeat integration |
| `docs/architecture/tasks-system.md` | 16 KB | Task system - scheduled vs deferred tasks, task ticks, cron support, planning agent, retry logic, heartbeat integration |
| `docs/architecture/open-questions.md` | 5 KB | Resolved design questions (all 7) - concurrent tick handling, crash recovery, MCP tool design, structured output, Claude OAuth, Codex OAuth, contact notes |

### Frontend

| File | Size | Covers |
|------|------|--------|
| `docs/frontend/design-principles.md` | 11 KB | Core design philosophy, intent-driven design, clarity over cleverness, dark mode foundation, color semantics, emotional state colors, typography, spacing, motion principles, component guidelines, interaction patterns |

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
5. **For frontend work**: Read `docs/frontend/design-principles.md` and `docs/brand-vision.md`
6. **For persona/personality**: Read `docs/architecture/persona.md` and `docs/brand-vision.md`
7. **For heartbeat/inner life**: Read `docs/architecture/heartbeat.md` and `docs/project-vision.md`
7b. **For memory/knowledge/embeddings**: Read `docs/architecture/memory.md` and `docs/architecture/heartbeat.md`
7c. **For context assembly/prompt building**: Read `docs/architecture/context-builder.md`
7d. **For shared abstractions (embedding, decay, encryption, event bus)**: Read `docs/architecture/tech-stack.md` (Shared Abstractions section)
7e. **For MCP tools/custom tools**: Read `docs/architecture/mcp-tools.md` and `docs/architecture/agent-orchestration.md`
8. **For new contributors**: Read `docs/guides/getting-started.md`
9. **For channels/messaging/SMS/Discord/API**: Read `docs/architecture/channels.md` and `docs/architecture/contacts.md`
10. **For Codex OAuth/authentication**: Read `docs/agents/codex/oauth.md`

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
- **channels, adapter, SMS, twilio, discord, API, ollama, openai, streaming, webhook, inbound, outbound, media** -> `docs/architecture/channels.md`
- **context builder, context assembly, prompt compilation, token budget, mind prompt, system prompt, mind instructions** -> `docs/architecture/context-builder.md`
- **shared abstractions, embedding provider, decay engine, encryption service, event bus, database stores** -> `docs/architecture/tech-stack.md`
- **memory, embedding, retrieval, long-term, lancedb memories, working memory, core self, consolidation, forgetting, transformers.js** -> `docs/architecture/memory.md`
- **goals, objectives, long-term direction** -> `docs/architecture/goals.md`
- **tasks, scheduling, cron, scheduled jobs** -> `docs/architecture/tasks-system.md`
- **open questions, resolved questions** -> `docs/architecture/open-questions.md`
