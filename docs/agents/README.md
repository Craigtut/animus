# Agent SDK Documentation

This folder contains comprehensive research and design documentation for the four agent SDKs that the `@animus-labs/agents` package unifies.

## Structure

```
docs/agents/
├── README.md                    # This file
├── architecture-overview.md  # Cross-cutting: unified abstraction layer design
├── plugin-extension-systems.md # Plugin/extension comparison & Animus plugin strategy
├── claude/
│   └── sdk-research.md          # Claude Agent SDK deep dive
├── codex/
│   ├── sdk-research.md          # OpenAI Codex SDK deep dive
│   └── oauth.md                 # Codex OAuth device code proxy design
├── opencode/
│   └── sdk-research.md          # OpenCode SDK deep dive
└── pi/
    ├── sdk-research.md            # Pi AI + Pi Agent Core deep dive
    └── adapter-implementation.md  # Pi adapter implementation plan
```

## Per-Provider Documentation

### Claude (`@anthropic-ai/claude-agent-sdk`)

| Document | Description |
|----------|-------------|
| [claude/sdk-research.md](./claude/sdk-research.md) | SDK API, auth methods, streaming, hooks, MCP support |

- **Architecture**: Async generator, spawns Claude Code CLI as subprocess
- **Auth**: API key or subscription (OAuth token / long-lived token)
- **Strengths**: Most mature, full hook support (can block/modify), native subagents

### Codex (`@openai/codex-sdk`)

| Document | Description |
|----------|-------------|
| [codex/sdk-research.md](./codex/sdk-research.md) | SDK API, thread model, auth, streaming, approval policies |
| [codex/oauth.md](./codex/oauth.md) | Device code OAuth proxy design for web UI |

- **Architecture**: CLI subprocess (Rust core), thread/turn model
- **Auth**: API key or ChatGPT OAuth (device code flow)
- **Limitations**: No cancel/abort, no native subagents, observe-only hooks

### OpenCode (`@opencode-ai/sdk`)

| Document | Description |
|----------|-------------|
| [opencode/sdk-research.md](./opencode/sdk-research.md) | SDK API, client/server arch, plugin system, multi-provider |

- **Architecture**: Client/server (REST + SSE)
- **Auth**: Per-provider API keys
- **Strengths**: 75+ providers, native plan mode, full tool-level permissions

### Pi (`@mariozechner/pi-ai` + `@mariozechner/pi-agent-core`)

| Document | Description |
|----------|-------------|
| [pi/sdk-research.md](./pi/sdk-research.md) | Pi AI multi-provider LLM abstraction + Pi Agent Core framework deep dive |
| [pi/adapter-implementation.md](./pi/adapter-implementation.md) | Full implementation plan for adding Pi as fourth adapter |

- **Architecture**: In-process library (no subprocess or server)
- **Auth**: Per-provider API keys, dynamic key resolution, OAuth for 5 providers
- **Strengths**: 20+ providers via 9 API backends, `transformContext` hook (dynamic context reshaping), cross-provider handoffs, `steer()` for mid-execution interrupts, excellent cost tracking
- **Limitations**: No MCP (bridged at adapter), no native sub-agents, TypeBox not Zod, sequential tool execution

## Cross-Cutting Documentation

| Document | Description |
|----------|-------------|
| [architecture-overview.md](./architecture-overview.md) | Unified abstraction layer design, SDK comparison matrix, interface definitions, design decisions |
| [plugin-extension-systems.md](./plugin-extension-systems.md) | Plugin/extension system comparison & Animus plugin strategy (skills, tools, hooks, agents) |

## Quick Reference

### SDK Comparison

| Aspect | Claude | Codex | OpenCode | Pi |
|--------|--------|-------|----------|-----|
| Package | `@anthropic-ai/claude-agent-sdk` | `@openai/codex-sdk` | `@opencode-ai/sdk` | `@mariozechner/pi-ai` + `pi-agent-core` |
| Architecture | Async generator (spawns CLI) | CLI subprocess | Client/Server | In-process library |
| Auth | API key / OAuth token | API key / ChatGPT OAuth | Per-provider API keys | Per-provider + dynamic + OAuth |
| Streaming | Generator yield | Event iterator | SSE subscription | Async iterable + result promise |
| Cancel/Abort | AbortController | Not supported | session.abort() | AbortController |
| Pre-exec hooks | Can block/modify | Observe only | Can block (throw) + modify | Via tool wrapping (adapter) |
| Subagents | Task tool | Not native | @mentions | Not native |
| MCP Support | Native (in-process + stdio) | stdio-based | Via config | None (bridged at adapter) |
| Context Transform | Not supported | Not supported | Not supported | transformContext hook |
| Mid-exec Steering | injectMessage | Not supported | Not supported | steer() (best) |

### Design Decisions

| Decision | Approach |
|----------|----------|
| OpenCode server | Auto-start via `createOpencode()` |
| Codex auth | Automatic discovery from `~/.codex/auth.json` + OAuth proxy for web UI |
| MCP tools | Cross-provider via MCP protocol (all three support it) |
| Subagents | Unified API with graceful fallback (error for Codex) |
| Context window | Expose metrics, let SDKs handle compaction |
| Codex cancel | No-op with warning |
| Permissions | Two-tier: `executionMode` (plan/build) + `approvalLevel` (strict/normal/trusted/none) |
| Hooks | Event emitter with graceful degradation |
| Session IDs | Provider prefix: `{provider}:{native_id}` |
| Streaming output | Cognitive MCP tools with phase-based natural language streaming |

### Implementation Priority

1. **Claude Adapter** (first) - Most mature SDK, best documentation
2. **Codex Adapter** (second) - Popular, subscription auth option
3. **OpenCode Adapter** (third) - Most different architecture
4. **Pi Adapter** (fourth) - Unique transformContext, multi-provider gateway

## External References

### Claude Agent SDK
- [Docs](https://platform.claude.com/docs/en/agent-sdk/overview)
- [TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)

### OpenAI Codex SDK
- [Docs](https://developers.openai.com/codex/sdk/)
- [GitHub](https://github.com/openai/codex/tree/main/sdk/typescript)
- [npm](https://www.npmjs.com/package/@openai/codex-sdk)

### OpenCode SDK
- [Docs](https://opencode.ai/docs/sdk/)
- [GitHub](https://github.com/opencode-ai/opencode)
- [npm](https://www.npmjs.com/package/@opencode-ai/sdk)

### Pi (pi-ai + pi-agent-core)
- [GitHub: pi-mono](https://github.com/badlogic/pi-mono)
- [npm: @mariozechner/pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai)
- [npm: @mariozechner/pi-agent-core](https://www.npmjs.com/package/@mariozechner/pi-agent-core)

---

*Research conducted: 2026-02-04, restructured: 2026-02-08, Pi added: 2026-02-17*
