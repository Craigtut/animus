# Agent SDK Research Documentation

This folder contains comprehensive research on the three agent SDKs that the `@animus/agents` package will unify.

## Documents

| Document | Description |
|----------|-------------|
| [01-claude-agent-sdk.md](./01-claude-agent-sdk.md) | Claude Agent SDK deep dive |
| [02-openai-codex-sdk.md](./02-openai-codex-sdk.md) | OpenAI Codex SDK deep dive |
| [03-opencode-sdk.md](./03-opencode-sdk.md) | OpenCode SDK deep dive |
| [04-architecture-overview.md](./04-architecture-overview.md) | Unified architecture design & concerns |

## Quick Reference

### SDK Comparison

| SDK | Package | Architecture | Auth |
|-----|---------|--------------|------|
| Claude | `@anthropic-ai/claude-agent-sdk` | Async generator (spawns CLI) | API key or subscription (OAuth token) |
| Codex | `@openai/codex-sdk` | CLI subprocess | API key or ChatGPT OAuth |
| OpenCode | `@opencode-ai/sdk` | Client/Server | Per-provider API keys |

### Key Concerns

1. **Claude SDK subscription auth** requires `CLAUDE_CODE_OAUTH_TOKEN` or pre-authenticated Claude Code (long-lived tokens valid 1 year)
2. **Codex SDK has no cancel/abort** - operations run to completion
3. **OpenCode uses client/server** - fundamentally different from the others
4. **All three have different streaming models** - need unified event normalization
5. **Session management varies significantly** - needs careful abstraction

### Design Decisions

| Decision | Approach |
|----------|----------|
| OpenCode server | Auto-start via `createOpencode()` |
| Codex auth | Automatic discovery from `~/.codex/auth.json` |
| MCP tools | Expose full config, consumer manages MCP server lifecycle |
| Subagents | Unified API with graceful fallback (error for Codex) |
| Context window | Expose metrics (total/used/remaining), let SDKs handle compaction |
| Codex cancel | No-op with warning (not supported by SDK) |
| Permissions | Two-tier model: `executionMode` (plan/build) + `approvalLevel` (strict/normal/trusted/none) |
| Hooks | Event emitter pattern with graceful degradation (blocking only on Claude) |
| Session IDs | Pass-through with provider prefix: `{provider}:{native_id}` |
| Model registry | JSON config with capability metadata (to be populated) |
| Timeouts | Per-prompt timeout, default 5 minutes, configurable |
| Concurrency | Fully supported, independent state per session |
| Retry | Consumer responsibility, provide utility helpers |
| Logging | Injectable logger with debug/info/warn/error levels |
| Config validation | Zod schemas with discriminated union by provider |
| Process cleanup | Register exit handlers, end all sessions gracefully |

### Event Normalization

Our unified event types (from `@animus/agents`):

```typescript
type AgentEventType =
  | 'session_start'
  | 'session_end'
  | 'input_received'
  | 'thinking_start'
  | 'thinking_end'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'tool_error'
  | 'response_start'
  | 'response_chunk'
  | 'response_end';
```

### Built-in Tools (Common Across All)

| Tool | Claude | Codex | OpenCode |
|------|--------|-------|----------|
| Read files | Read | ✅ | read |
| Write files | Write | ✅ | write |
| Edit files | Edit | ✅ | edit |
| Run commands | Bash | ✅ | bash |
| Search patterns | Glob | ✅ | glob |
| Search content | Grep | ✅ | grep |
| Web search | WebSearch | ✅ | webfetch |

## Implementation Priority

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

*Research conducted: 2026-02-04*
