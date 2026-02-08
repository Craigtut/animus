# Agent SDK Documentation

This folder contains comprehensive research and design documentation for the three agent SDKs that the `@animus/agents` package unifies.

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
└── opencode/
    └── sdk-research.md          # OpenCode SDK deep dive
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

## Cross-Cutting Documentation

| Document | Description |
|----------|-------------|
| [architecture-overview.md](./architecture-overview.md) | Unified abstraction layer design, SDK comparison matrix, interface definitions, design decisions |
| [plugin-extension-systems.md](./plugin-extension-systems.md) | Plugin/extension system comparison & Animus plugin strategy (skills, tools, hooks, agents) |

## Quick Reference

### SDK Comparison

| Aspect | Claude | Codex | OpenCode |
|--------|--------|-------|----------|
| Package | `@anthropic-ai/claude-agent-sdk` | `@openai/codex-sdk` | `@opencode-ai/sdk` |
| Architecture | Async generator (spawns CLI) | CLI subprocess | Client/Server |
| Auth | API key / OAuth token | API key / ChatGPT OAuth | Per-provider API keys |
| Streaming | Generator yield | Event iterator | SSE subscription |
| Cancel/Abort | AbortController | Not supported | session.abort() |
| Pre-exec hooks | Can block/modify | Observe only | Can block (throw) + modify |
| Subagents | Task tool | Not native | @mentions |
| MCP Support | Native (in-process + stdio) | stdio-based | Via config |

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
| Streaming output | `llm-json-stream` for field-level streaming from structured JSON |

### Implementation Priority

1. **Claude Adapter** (first) - Most mature SDK, best documentation
2. **Codex Adapter** (second) - Popular, subscription auth option
3. **OpenCode Adapter** (third) - Most different architecture

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

---

*Research conducted: 2026-02-04, restructured: 2026-02-08*
