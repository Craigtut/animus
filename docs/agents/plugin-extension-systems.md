# Plugin & Extension Systems Research

> **Status**: Research complete, strategy proposed
> **Date**: 2026-02-08

## Executive Summary

This document compares the plugin/extension architectures across all three agent SDKs and proposes an **Animus-level plugin system** that abstracts over them. The two primary extension capabilities we need are **custom tools** (via MCP, universally supported) and **skills** (instruction packages that teach agents how to perform specific tasks — a harder problem requiring Animus-level abstraction).

## SDK Plugin Architectures

### Claude Agent SDK — First-Class Plugin System

Claude has the most mature plugin ecosystem. Plugins are **manifest-based packaging units** that bundle multiple component types into a distributable directory.

**Plugin Manifest** (`.claude-plugin/plugin.json`):
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "author": { "name": "Author" },
  "skills": "./skills/",
  "agents": "./agents/",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json",
  "lspServers": "./.lsp.json"
}
```

**Plugin Directory Structure:**
```
my-plugin/
├── .claude-plugin/
│   └── plugin.json           # Manifest (required)
├── skills/                    # Model-invoked capabilities
│   └── code-review/
│       └── SKILL.md
├── agents/                    # Subagent definitions
│   └── security-reviewer.md
├── hooks/                     # Lifecycle event handlers
│   └── hooks.json
├── commands/                  # User-invoked slash commands (legacy)
│   └── deploy.md
├── .mcp.json                  # MCP server definitions
└── .lsp.json                  # LSP server configurations
```

**6 Component Types:**

| Component | Description |
|-----------|-------------|
| **Skills** | Markdown instructions (`SKILL.md`) with frontmatter. Model reads and follows them based on task context. |
| **Agents** | Subagent definitions (markdown with system prompt). Specialized for focused tasks. |
| **Hooks** | Lifecycle event handlers. 14+ events including `PreToolUse` (can block), `PostToolUse`, `SessionStart/End`, `SubagentStart/Stop`. Three types: command (shell), prompt (LLM eval), agent (agentic verifier). |
| **MCP Servers** | Custom tool servers. Start automatically when plugin is enabled. |
| **LSP Servers** | Language intelligence servers (go-to-definition, diagnostics). |
| **Commands** | Legacy slash commands (being replaced by Skills). |

**Installation Methods:**
- CLI: `claude --plugin-dir ./my-plugin` or `claude plugin install name@marketplace`
- SDK: `plugins: [{ type: "local", path: "./my-plugin" }]` in `query()` options
- Scoped: user, project, local, or managed

**Key Characteristics:**
- Plugins are **file-based** — hooks run as external processes, not in-process code
- SDK-level hooks CAN be in-process callbacks, but plugin hooks cannot
- Namespaced: `/{plugin-name}:{command}` prevents collisions
- `${CLAUDE_PLUGIN_ROOT}` env var for portable paths
- Cache-based isolation — plugins are copied, not run in-place

**SDK Plugin Loading:**
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "...",
  options: {
    plugins: [{ type: "local", path: "./my-plugin" }],
    // These coexist with plugin-provided config:
    mcpServers: { ... },
    hooks: { ... },
    agents: { ... }
  }
})) {}
```

### Codex SDK — No Formal Plugin System

Codex has **no plugin abstraction**. Extension capabilities are fragmented across separate mechanisms.

**Extension Mechanisms:**

| Mechanism | Purpose | Programmatic? | Adds Tools? | Can Block? |
|-----------|---------|---------------|-------------|------------|
| **MCP Servers** | Custom tools (primary extension) | Yes, via `config` option | Yes | No |
| **Agent Skills** | Instruction + script packages | No (file-based only) | Indirectly (via MCP deps) | No |
| **AGENTS.md** | Behavioral instructions | Via `developer_instructions` | No | No |
| **Notification Hook** | Post-turn observe-only callback | Via `notify` config | No | No |
| **SDK Events** | `runStreamed()` observation | Yes | No | No |

**MCP Configuration (programmatic via SDK):**
```typescript
const codex = new Codex({
  config: {
    mcp_servers: {
      my_tool: {
        command: "node",
        args: ["./my-mcp-server.js"],
        env: { API_KEY: "secret" },
      }
    }
  }
});
```

**Agent Skills (file-based):**
```
.agents/skills/
  my-skill/
    SKILL.md                  # Instructions + frontmatter
    scripts/                  # Optional executable code
    references/               # Optional supporting docs
    agents/openai.yaml        # Optional MCP dependencies
```

Skills are discovered from `.agents/skills/` at repo, user, admin, and system scopes. They can declare MCP tool dependencies. They activate either explicitly (user references) or implicitly (model auto-selects based on description).

**Key Limitations:**
- No `registerTool()` or `addPlugin()` API
- No pre-execution hooks (GitHub issue #2109, 388 upvotes, still not shipped)
- Notification hook is post-turn, observe-only
- Custom tools ONLY through MCP servers

### OpenCode SDK — Programmatic Plugin System

OpenCode has a **code-first plugin system** via the `@opencode-ai/plugin` package. Plugins are TypeScript functions that return hook objects.

**Plugin Structure:**
```typescript
import { type Plugin, tool } from "@opencode-ai/plugin";

export const MyPlugin: Plugin = async (ctx) => {
  // ctx has: client, project, directory, worktree, serverUrl, $ (bun shell)
  return {
    tool: {
      my_tool: tool({
        description: "Custom tool",
        args: { query: tool.schema.string() },
        async execute(args, context) {
          return `Result: ${args.query}`;
        }
      })
    },
    "tool.execute.before": async (input, output) => {
      // Can modify output.args or throw to BLOCK execution
    },
    "tool.execute.after": async (input, output) => {
      // Observe/modify results
    },
    event: async ({ event }) => {
      // React to any system event
    }
  };
};
```

**15+ Hook Points:**

| Hook | Purpose | Can Block? |
|------|---------|------------|
| `event` | Subscribe to all system events | No |
| `config` | Modify config at load time | N/A |
| `chat.message` | Intercept/modify messages before LLM | No (mutate) |
| `chat.params` | Adjust temperature, topP, topK | No (mutate) |
| `chat.headers` | Add/modify HTTP headers to LLM | No (mutate) |
| `permission.ask` | Auto-allow/deny permissions | Yes (set status) |
| `command.execute.before` | Intercept slash commands | No |
| `tool.execute.before` | Modify args or block execution | **Yes (throw)** |
| `tool.execute.after` | React to tool completion | No |
| `shell.env` | Inject env vars into shell commands | No |
| `experimental.chat.system.transform` | Inject into system prompts | No (append) |
| `experimental.chat.messages.transform` | Transform message history | No (mutate) |
| `experimental.session.compacting` | Customize context compaction | No |
| `experimental.text.complete` | Modify completed text | No (mutate) |

**Installation Methods:**
- npm packages in `opencode.json`: `"plugin": ["my-plugin", "@org/plugin"]`
- Local files: `.opencode/plugins/` or `~/.config/opencode/plugins/`
- Standalone tools: `.opencode/tools/my-tool.ts` (no plugin wrapper needed)

**Key Characteristics:**
- Plugins are **in-process TypeScript code** — direct access to event bus and SDK client
- Server-side only, loaded at startup, no hot-reload
- Cannot define agents directly (agents are separate config)
- No MCP bundling (MCP is separate `opencode.json` config)
- `tool.execute.before` CAN block execution by throwing (corrects our earlier docs)

**Known Limitations:**
- `tool.execute.before` does NOT intercept subagent tool calls ([Issue #5894](https://github.com/anomalyco/opencode/issues/5894))
- `tool.execute.before` does NOT intercept MCP tool calls ([Issue #2319](https://github.com/sst/opencode/issues/2319))
- No `tool.execute.error` hook yet ([Issue #10027](https://github.com/anomalyco/opencode/issues/10027))

## Comparison Matrix

### Plugin System Features

| Feature | Claude | Codex | OpenCode |
|---------|--------|-------|----------|
| **Formal plugin system** | First-class (manifest) | None | First-class (code) |
| **Plugin format** | Directory + JSON manifest | N/A | TypeScript function |
| **Custom tools** | MCP in plugin | MCP only (config) | `tool()` helper |
| **Pre-tool hooks (block)** | Block + modify | Observe only | Block (throw) + modify |
| **Post-tool hooks** | Full | Via events only | Full |
| **Custom agents in plugin** | Yes (`agents/` dir) | No (AGENTS.md separate) | No (separate config) |
| **Skills in plugin** | Yes (`skills/` dir) | Yes (`.agents/skills/` separate) | No |
| **MCP bundling** | Yes (`.mcp.json` in plugin) | No (config.toml) | No (`opencode.json`) |
| **Auth hooks** | No | No | Yes |
| **Chat/message hooks** | No | No | Yes |
| **System prompt injection** | Via `systemPrompt` option | Via AGENTS.md | Experimental hook |
| **Distribution** | Marketplace + git repos | File-system only | npm packages |
| **In-process code hooks** | SDK-level only | No | Yes (plugins are code) |
| **Namespacing** | Plugin name prefix | N/A | N/A |

### Skills Comparison

| Aspect | Claude | Codex | OpenCode |
|--------|--------|-------|----------|
| **Has skills?** | Yes | Yes | No |
| **Format** | `SKILL.md` with frontmatter | `SKILL.md` with frontmatter | N/A |
| **Activation** | Model auto-selects or user invokes | Model auto-selects or user invokes | N/A |
| **Bundled in plugins?** | Yes | No (separate `.agents/skills/`) | N/A |
| **Can declare tool deps?** | Via MCP in plugin | Via `agents/openai.yaml` | N/A |
| **Can include scripts?** | Yes (supporting files) | Yes (scripts/, references/) | N/A |
| **Discovery** | Plugin dirs + `.claude/skills/` | `.agents/skills/` at multiple scopes | N/A |

## The Skills Problem

Skills are the **hardest extension type to abstract** because:

1. **Only two of three SDKs support them** — OpenCode has no skill concept at all
2. **Skills are prompt-injected instructions** — they modify what the LLM knows and does, not what tools are available
3. **Skill activation requires LLM awareness** — the model must know a skill exists to decide to use it, which means skills must appear in context
4. **Context budget pressure** — every loaded skill consumes tokens from the context window
5. **Provider-native skills are tied to SDK internals** — Claude and Codex handle skill discovery, activation, and injection internally within their CLI subprocesses, which our adapters don't control

### Why We Can't Just Pass Through Native Skills

When Animus spawns a sub-agent session, the session runs inside the SDK's subprocess (Claude CLI, Codex CLI, or OpenCode server). Native skills would need to be:
- Placed in the right filesystem locations for each SDK
- Written in the right format for each SDK
- Discovered by the SDK's internal skill loader

This creates several problems:
- **Format fragmentation**: Claude uses `.claude/skills/`, Codex uses `.agents/skills/`, OpenCode has no equivalent
- **Frontmatter differences**: Each SDK has different frontmatter schemas and conventions
- **No OpenCode support**: A third of our providers can't use skills at all
- **Animus orchestrator is invisible**: The mind system controls what sub-agents do via system prompts. If skills are loaded by the SDK internally, the mind can't control when or which skills are active
- **No skill awareness in mind context**: If skills only exist inside sub-agent sessions, the mind can't reason about available skills when making delegation decisions

### What Skills Actually Are (Core Abstraction)

At their essence, skills are:
1. **A set of instructions** — markdown text telling the LLM how to perform a specific task
2. **A description for activation** — metadata telling the system when this skill is relevant
3. **Optional tool dependencies** — MCP servers or custom tools the skill needs
4. **Optional supporting resources** — scripts, templates, reference docs

Skills are NOT tools (they don't add callable functions). They're closer to **dynamic system prompt segments** that get injected when relevant.

## Proposed Strategy: Animus-Level Plugin System

### Design Philosophy

Build an **Animus-level plugin format** that operates above the SDK adapters. Animus plugins are consumed by the **orchestrator** (heartbeat pipeline + mind + context builder), not by the SDK sessions directly. The orchestrator then translates plugin components into whatever the target SDK needs.

```
┌─────────────────────────────────────────────────┐
│               Animus Plugin                      │
│  ┌─────────┐ ┌────────┐ ┌───────┐ ┌──────────┐ │
│  │ Skills  │ │ Tools  │ │ Hooks │ │ Agents   │ │
│  │ (.md)   │ │ (MCP)  │ │       │ │ (prompts)│ │
│  └─────────┘ └────────┘ └───────┘ └──────────┘ │
└─────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────┐
│          Animus Orchestrator                     │
│  ┌──────────────────┐  ┌──────────────────────┐ │
│  │  Context Builder  │  │  Plugin Manager      │ │
│  │  (injects skills  │  │  (loads, activates,  │ │
│  │   into prompts)   │  │   passes MCP config) │ │
│  └──────────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
┌────────┐ ┌────────┐ ┌────────┐
│ Claude │ │ Codex  │ │OpenCode│
│Adapter │ │Adapter │ │Adapter │
└────────┘ └────────┘ └────────┘
```

### Plugin Format (Proposed)

An Animus plugin is a directory with a manifest:

```
my-plugin/
├── plugin.json               # Manifest
├── skills/                    # Skills (Animus-managed)
│   └── code-review/
│       ├── skill.md           # Instructions + frontmatter
│       └── resources/         # Supporting files (templates, examples)
├── tools/                     # Custom tools (MCP servers)
│   ├── mcp.json               # MCP server definitions
│   └── servers/               # Optional bundled MCP server code
├── hooks/                     # Animus lifecycle hooks
│   └── hooks.json
└── agents/                    # Sub-agent prompt templates
    └── security-reviewer.md
```

**Manifest (`plugin.json`):**
```json
{
  "name": "code-quality",
  "version": "1.0.0",
  "description": "Code review and quality analysis tools",
  "author": "animus-plugins",

  "skills": "./skills/",
  "tools": "./tools/mcp.json",
  "hooks": "./hooks/hooks.json",
  "agents": "./agents/"
}
```

### How Each Component Works

#### Skills — Animus-Managed Context Injection

Skills are **consumed by the Context Builder**, not by the SDK. This means they work identically regardless of which provider is active.

**Skill definition (`skills/code-review/skill.md`):**
```yaml
---
name: code-review
description: Performs thorough code reviews focusing on bugs, security, and maintainability
activation: auto           # auto (model decides) | manual (user invokes) | always
maxTokens: 2000            # Budget cap for this skill's instructions
toolDependencies:           # MCP tools this skill needs
  - grep
  - read
tags:                       # For relevance matching
  - review
  - quality
  - security
---

## Code Review Process

When reviewing code, follow these steps:

1. **Read the full file** before making any judgments
2. **Check for security issues** first (injection, auth bypass, data exposure)
3. **Check for logic errors** (off-by-one, null handling, race conditions)
4. **Check for maintainability** (naming, complexity, duplication)
...
```

**How skills flow through the system:**

1. **Plugin Manager** loads all plugins at startup, indexes skills by name/description/tags
2. **Gather Context** (heartbeat pipeline stage 1) determines which skills are relevant:
   - **always** skills: Always included in context
   - **auto** skills: Included when the current tick's context matches the skill's description/tags (semantic match or keyword match — NOT a full embedding search, just lightweight relevance scoring)
   - **manual** skills: Only included when the mind explicitly requests them or user invokes them
3. **Context Builder** injects active skills into the system prompt for the mind session or sub-agent session
4. **Mind** sees available skills in its context and can reference them in decisions
5. **Sub-agent sessions** receive relevant skills via their system prompt — the Context Builder adds skill instructions to the sub-agent's prompt template before sending to the SDK adapter

**This approach solves the cross-provider problem**: Skills are just text injected into system prompts. Every SDK supports system prompts. No native skill format translation needed.

**Context budget management**: Each skill declares a `maxTokens` budget. The Context Builder tracks total skill tokens against the overall context budget and drops lower-priority skills when budget is tight (same priority logic as the existing context builder design — see `docs/architecture/context-builder.md`).

#### Tools — MCP Passthrough

Tools use MCP as the universal mechanism. The Plugin Manager reads MCP server definitions from the plugin and passes them to the active SDK adapter.

**MCP config (`tools/mcp.json`):**
```json
{
  "code-analysis": {
    "command": "node",
    "args": ["${PLUGIN_ROOT}/servers/analysis-server.js"],
    "env": { "MAX_FILE_SIZE": "1048576" }
  }
}
```

**How tools flow:**
1. Plugin Manager reads `tools/mcp.json` from each plugin
2. MCP server definitions are collected and passed to the adapter's session config
3. All three SDKs support MCP — Claude via `mcpServers`, Codex via `config.mcp_servers`, OpenCode via config
4. `${PLUGIN_ROOT}` is substituted with the plugin's absolute path at load time

#### Hooks — Animus Lifecycle Events

Plugin hooks operate at the **Animus orchestrator level**, not the SDK level. They hook into heartbeat pipeline events, not SDK-internal tool calls.

**Hook config (`hooks/hooks.json`):**
```json
{
  "preTick": [{
    "matcher": "message_received",
    "command": "${PLUGIN_ROOT}/scripts/pre-tick.sh"
  }],
  "postDecision": [{
    "matcher": "send_message",
    "command": "${PLUGIN_ROOT}/scripts/validate-response.sh"
  }]
}
```

**Available Animus hook events:**

| Event | When | Can Block? |
|-------|------|------------|
| `preTick` | Before a heartbeat tick processes | Yes |
| `postTick` | After a tick completes | No |
| `preDecision` | Before EXECUTE processes a mind decision | Yes |
| `postDecision` | After a decision is executed | No |
| `preSubAgent` | Before a sub-agent is spawned | Yes |
| `postSubAgent` | After a sub-agent completes | No |
| `preMessage` | Before a message is sent to a contact | Yes (can modify) |
| `postMessage` | After a message is sent | No |

These are **Animus-level hooks**, completely independent of SDK-internal hooks. They operate in the EXECUTE stage of the heartbeat pipeline where the orchestrator has full control.

#### Agents — Sub-Agent Prompt Templates

Agent definitions in plugins provide prompt templates for specialized sub-agents. These are consumed by the orchestrator when the mind decides to delegate work.

**Agent definition (`agents/security-reviewer.md`):**
```yaml
---
name: security-reviewer
description: Reviews code for security vulnerabilities and OWASP Top 10 issues
tools:
  - read
  - grep
  - glob
---

You are a security-focused code reviewer. Your expertise covers:
- OWASP Top 10 vulnerabilities
- Authentication and authorization flaws
- Input validation and injection attacks
- Cryptographic weaknesses
...
```

The orchestrator merges the Animus personality prompt with the agent definition's instructions when creating a sub-agent session.

### Plugin Loading & Lifecycle

```
Startup
  │
  ▼
┌──────────────────────────────────┐
│  Plugin Manager                   │
│  1. Scan plugin directories       │
│  2. Validate manifests (Zod)      │
│  3. Index skills (name, tags)     │
│  4. Collect MCP server configs    │
│  5. Register hooks                │
│  6. Index agent templates         │
└──────────────────────────────────┘
  │
  ▼
Runtime (per tick)
  │
  ├─→ Context Builder requests active skills
  │     └─→ Plugin Manager returns relevant skills based on tick context
  │
  ├─→ Mind decides to spawn sub-agent
  │     ├─→ Plugin Manager provides agent template
  │     └─→ Plugin Manager provides MCP config for sub-agent session
  │
  └─→ EXECUTE processes decisions
        └─→ Plugin hooks fire (preTick, preDecision, etc.)
```

**Plugin Discovery Locations:**
1. `~/.animus/plugins/` — user-level plugins
2. `{project}/plugins/` — project-level plugins (if Animus supports project scoping in the future)
3. Configured in system.db settings — explicit plugin paths

**No marketplace initially.** Plugins are local directories. Marketplace/npm distribution is a future concern.

### Open Questions

#### Skill Activation Strategy

How does the system determine which "auto" skills are relevant for a given tick?

**Options:**

1. **Keyword matching** — Match skill tags against tick trigger content and recent messages. Simple, fast, no embedding cost. Risk: misses semantic matches.

2. **Lightweight embedding similarity** — Embed skill descriptions at load time (one-time cost). Each tick, embed the trigger context and find similar skills. More accurate but adds latency per tick (~50-100ms with local embeddings).

3. **Mind self-selection** — Include a skill catalog (name + description only, not full instructions) in the mind's context. Let the mind request specific skills by name. Most accurate but consumes context tokens for the catalog and requires an extra round-trip or structured output field.

4. **Hybrid** — Use keyword matching as a fast first pass, then let the mind see a short list of candidate skills and confirm which to activate.

**Recommendation**: Start with **option 3 (mind self-selection)** — it's the simplest to implement and most accurate. The skill catalog (just names + one-line descriptions) is tiny. Add a `requestSkills: string[]` field to the mind's structured output. On the next tick (or mid-session via a tool), the requested skills are injected.

**Trade-off**: This means skills can't be active on the first tick they're relevant — there's a one-tick delay for auto skills. For message-triggered ticks this is acceptable since the mind is already processing the context and can request skills for its response. For always-on skills, there's no delay at all.

#### Skill vs Agent Boundary

When should something be a skill vs a sub-agent definition?

- **Skill**: Instructions the mind (or any agent) follows inline. No delegation, no separate session. Example: "How to write good commit messages."
- **Agent**: A specialized sub-agent that gets its own session with focused tools and instructions. Involves delegation and a separate context. Example: "Security reviewer that audits an entire codebase."

The boundary is clear: **skills are knowledge, agents are delegation.**

#### Native Skill Passthrough (Future)

Should Animus optionally pass skills through to SDKs that support them natively?

**Arguments for:**
- Claude and Codex have optimized skill discovery and activation built into their CLIs
- Native skills benefit from SDK-level caching and context management
- Less context budget pressure on the Animus system prompt

**Arguments against:**
- Format translation complexity (Animus → Claude, Animus → Codex, nothing for OpenCode)
- Loss of orchestrator control over which skills are active
- Skills would be invisible to the mind's decision-making

**Recommendation**: Don't pursue native passthrough initially. Animus-managed skills via context injection gives us full control and works universally. Revisit if context budget becomes a bottleneck.

#### Plugin Isolation

Should plugins run in isolated environments?

**Recommendation**: No, not initially. Plugins are trusted (self-hosted, single-user system). MCP servers already run as separate processes with their own isolation. Hooks run as shell commands in separate processes. The only in-process code is the Plugin Manager itself reading manifest files and markdown.

## References

### Agent Skills Standard (Cross-Vendor)
- [Agent Skills Specification](https://agentskills.io/specification) — the open format for SKILL.md, adopted by Claude, Codex, OpenCode, Cursor, GitHub, Gemini CLI, and 20+ others
- [Agent Skills GitHub](https://github.com/agentskills/agentskills) — reference library and validation tools
- [Example Skills](https://github.com/anthropics/skills) — official example skills

### Claude Plugin System
- [Create plugins — Claude Code Docs](https://code.claude.com/docs/en/plugins)
- [Plugins reference — Claude Code Docs](https://code.claude.com/docs/en/plugins-reference)
- [Plugins in the SDK — Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/plugins)
- [Claude Code Plugins README — GitHub](https://github.com/anthropics/claude-code/blob/main/plugins/README.md)

### Codex Extension Mechanisms
- [Codex MCP Documentation](https://developers.openai.com/codex/mcp/)
- [Codex Agent Skills](https://developers.openai.com/codex/skills)
- [Custom Instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md/)
- [Codex Configuration Reference](https://developers.openai.com/codex/config-reference/)

### OpenCode Plugin System
- [OpenCode Plugins Documentation](https://opencode.ai/docs/plugins/)
- [OpenCode Custom Tools Documentation](https://opencode.ai/docs/custom-tools/)
- [@opencode-ai/plugin — npm](https://www.npmjs.com/package/@opencode-ai/plugin)
- [Plugin Source Code — GitHub](https://github.com/anomalyco/opencode/tree/dev/packages/plugin/src)

---

*Research conducted: 2026-02-08*
