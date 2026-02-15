# Animus Plugin System Architecture

> **Status**: Implemented
> **Date**: 2026-02-13, updated 2026-02-15
> **Supersedes**: `docs/agents/plugin-extension-systems.md` (research doc, retained for reference)

## Executive Summary

This document defines the Animus plugin system — a cross-provider plugin architecture that operates above the SDK layer and is designed from the ground up for an eventual plugin store where both humans and AIs can discover, purchase, and install plugins.

An Animus plugin is a **directory with a manifest** that bundles up to seven component types: **skills** (knowledge injection via the Agent Skills standard), **tools** (MCP servers), **context sources** (dynamic data providers), **hooks** (lifecycle interceptors), **agents** (sub-agent templates), **decision types** (custom EXECUTE handlers), and **triggers** (custom tick trigger sources). Plugins operate at the Animus orchestrator level, not at the SDK level — hooks, decisions, triggers, and context sources work identically across Claude, Codex, and OpenCode. Skills use native SDK passthrough (all three SDKs now support the Agent Skills SKILL.md standard), and tools use MCP (universally supported).

### Design Principles

1. **Orchestrator-level for control, SDK-level for skills.** Hooks, decisions, triggers, and context sources operate at the heartbeat pipeline level (Gather → Mind → Execute). Skills use native SDK progressive disclosure for same-turn loading. MCP tools pass through to all SDKs natively.

2. **Agent Skills standard for knowledge.** Skills use the open [Agent Skills SKILL.md specification](https://agentskills.io/specification) — the cross-vendor standard adopted by Anthropic, OpenAI, Microsoft, Google, Cursor, GitHub, and others. One SKILL.md works in all three SDKs. Skills can also bundle CLI tools via `scripts/` directories.

3. **MCP for structured tool access.** Tools use MCP with **stdio** transport for bundled/local servers (universally supported) and **Streamable HTTP** for remote servers. Skills with bundled CLI tools offer a lighter alternative for simple integrations.

4. **AI-installable.** The plugin system exposes MCP tools (`browse_plugins`, `install_plugin`) so the Animus mind can discover and install plugins autonomously, with user approval.

5. **Built-in plugins ship the same way.** Internal plugins that come with the engine use the exact same format as third-party plugins. No special paths or exceptions.

6. **Custom decision types and triggers are first-class.** Plugins can extend the mind's vocabulary of actions (new decision types with custom EXECUTE handlers) and create new reasons for the heartbeat to tick (custom triggers from external events).

### The Skills-First Philosophy

Animus plugins take a deliberately opinionated stance: **teach agents to use tools, don't wrap tools for agents.**

The instinct when building agent integrations is to create structured APIs — MCP servers with typed schemas, request/response protocols, managed transport. This is the "build a bridge" approach. But agents already know how to use Bash. They understand CLI tools, stdout, pipes, file I/O, and exit codes. The most natural way to give an agent a new capability is often the simplest: write a script, document it in a SKILL.md, and let the agent run it.

This isn't laziness — it's a deliberate architectural choice rooted in three principles:

**1. Token efficiency is capability.** Every token consumed by tool schemas, JSON-RPC framing, and MCP server descriptions is a token that can't be used for reasoning, memory, or persona. A typical MCP server contributes 13,000-18,000 tokens to the context just from its tool definitions. A SKILL.md that teaches the same capability might use 500 tokens of instructions and produce only the output the agent actually needs. When you're running a mind with persona, emotions, memories, goals, and working context — every token matters.

**2. Composability beats structure.** MCP tool results pass through the agent's context window as structured JSON responses — one tool at a time, one result at a time. CLI scripts can pipe output to files, chain with other tools, redirect to streams, and compose naturally through the shell. The agent can run a script that produces output, decide what to do with it, and run another script — all within the same Bash session. This is how experienced developers work, and it's how agents work most naturally.

**3. Agents should build their own tools.** Animus's vision includes eventual self-modification. An agent that knows how to write and run Bash scripts can create new tools for itself. An agent that depends on MCP servers cannot meaningfully extend its own capabilities — it would need to write a JSON-RPC server, manage transport, register tool schemas. The skills+CLI pattern means the agent is always one SKILL.md away from a new capability.

**When MCP is the right choice:**

MCP isn't wrong — it's the right tool for specific problems:

- **Credential isolation**: When secrets must never appear in shell history or process lists. MCP servers receive credentials through environment variables at spawn time, invisible to the agent.
- **Persistent connections**: WebSocket connections, database pools, long-lived sessions. Scripts start and stop; MCP servers maintain state across calls.
- **Structured access control**: When you need fine-grained permission filtering on which tools are available to which contacts at which permission tiers.
- **Complex state machines**: Multi-step protocols where the server must maintain internal state between calls (OAuth flows, transaction sequences).
- **Third-party servers**: When an external service already publishes an MCP server (Home Assistant, databases), use it directly rather than reimplementing.

The rule of thumb: **start with a skill and a script. Reach for MCP when the script can't solve the problem.**

Our own plugins demonstrate this hierarchy:
- **Weather**: Pure skill — teaches `curl` commands against free APIs. Zero infrastructure.
- **Agent Browser**: Pure skill — teaches CLI commands against an external tool. The agent runs `agent-browser open`, `agent-browser snapshot`, etc.
- **Nano Banana Pro**: Skill + bundled script — teaches the agent to invoke a Node.js script through `run_with_credentials` for credential isolation.
- **Home Assistant**: Skill + MCP — uses Home Assistant's own MCP server over HTTP because HA exposes hundreds of entities that benefit from structured tool access and persistent connection.

This gradient — from pure documentation to bundled scripts to MCP servers — is intentional. Plugin authors should use the lightest approach that solves their problem.

---

## Industry Context

### Why This Architecture

As of February 2026, the landscape has converged:

- **MCP is the universal tool standard** — 97M monthly SDK downloads, 10,000+ active servers, under Linux Foundation governance (AAIF). All three SDKs support it natively. **stdio** for local tools, **Streamable HTTP** for remote — both universally supported.

- **Agent Skills (SKILL.md) is the universal knowledge standard** — adopted by Claude, Codex, OpenCode, Cursor, GitHub Copilot, Gemini CLI, and 20+ other tools. All three of our SDKs support it natively with progressive disclosure (metadata at startup, full content on-demand within the same turn). One SKILL.md works everywhere.

- **Skills are replacing MCP for simple integrations** — a growing pattern where skills bundle CLI tools in `scripts/` and teach agents to use Bash instead of MCP servers. 4x more token-efficient for equivalent tasks. MCP remains essential for credential isolation, persistent connections, and structured access control.

- **Hooks remain provider-dependent** — Claude has full pre/post hooks, Codex has observe-only, OpenCode has partial hooks with unresolved subagent interception bugs (#5894, #2319). Our Animus-level hooks bypass all of this by operating at the orchestrator level.

- **No complete cross-platform plugin format exists** — Claude's `.claude-plugin` is the closest, but it's Claude-specific. Our format fills this gap for the Animus ecosystem, combining Agent Skills + MCP + orchestrator-level extensions into a single manifest.

### Lessons From the Landscape

| Source | Lesson Applied |
|--------|---------------|
| **Agent Skills standard** | Use SKILL.md as-is for cross-platform skill portability. Native SDK progressive disclosure. |
| **Skills + CLI pattern** | Skills can bundle CLI tools in `scripts/`, teaching agents to use Bash. Lighter than MCP for simple tools. |
| **MCP standard** | Universal tool transport. stdio for local, Streamable HTTP for remote. |
| **ACI.dev** | Dynamic tool discovery via search meta-function — reduces context window load |
| **Claude plugins** | Manifest-based directory structure, namespacing, marketplace distribution |
| **Semantic Kernel** | Plugins as grouped functions with semantic descriptions for LLM awareness |
| **GPT Store** | Monetization is hard — start with free distribution, add payments later |
| **ClawHavoc incident** | Community plugin registries are vulnerable. Permission declaration + user approval are essential. |

---

## Plugin Format

### Directory Structure

```
my-plugin/
├── plugin.json                 # Manifest (required)
├── README.md                   # Human-readable description (optional)
├── icon.png                    # Plugin icon (optional, 256x256)
├── skills/                     # Knowledge injection (Agent Skills standard)
│   └── code-review/
│       ├── SKILL.md            # Standard Agent Skills format
│       ├── scripts/            # Optional: CLI tools the agent runs via Bash
│       │   └── analyze.sh
│       └── references/         # Optional: docs loaded on demand
│           └── owasp-top10.md
├── tools/                      # MCP servers
│   ├── mcp.json                # MCP server definitions
│   └── servers/                # Optional bundled server code
├── context/                    # Dynamic context providers
│   └── context.json            # Context source definitions
├── hooks/                      # Lifecycle interceptors
│   └── hooks.json              # Hook definitions
├── decisions/                  # Custom decision type handlers
│   └── decisions.json          # Decision type definitions
├── triggers/                   # Custom tick trigger sources
│   └── triggers.json           # Trigger definitions
└── agents/                     # Sub-agent prompt templates
    └── security-reviewer.md    # Agent definition with frontmatter
```

### Manifest (`plugin.json`)

```json
{
  "$schema": "https://animus.dev/schemas/plugin/v1.json",

  "name": "code-quality",
  "version": "1.0.0",
  "description": "Code review, security analysis, and quality metrics for your codebase.",
  "author": {
    "name": "Animus Labs",
    "url": "https://animus.dev"
  },
  "license": "MIT",

  "engine": ">=0.1.0",

  "components": {
    "skills": "./skills/",
    "tools": "./tools/mcp.json",
    "context": "./context/context.json",
    "hooks": "./hooks/hooks.json",
    "decisions": "./decisions/decisions.json",
    "triggers": "./triggers/triggers.json",
    "agents": "./agents/"
  },

  "dependencies": {
    "plugins": [],
    "system": {
      "node": ">=24.0.0"
    }
  },

  "permissions": {
    "tools": ["read", "grep", "glob", "bash"],
    "network": false,
    "filesystem": "read-only"
  },

  "configSchema": {
    "type": "object",
    "properties": {
      "haUrl": {
        "type": "string",
        "description": "Home Assistant URL",
        "format": "url"
      },
      "apiToken": {
        "type": "string",
        "description": "Long-lived access token",
        "sensitive": true
      },
      "pollingInterval": {
        "type": "number",
        "description": "How often to check for device state (seconds)",
        "default": 60,
        "minimum": 10
      }
    },
    "required": ["haUrl", "apiToken"]
  },

  "setup": "${PLUGIN_ROOT}/scripts/setup.sh"
}
```

**Manifest Fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique plugin identifier (lowercase, hyphens, no spaces). Namespace for all components. |
| `version` | Yes | SemVer version string |
| `description` | Yes | One-line description for store listings and skill catalogs |
| `author` | Yes | Author metadata |
| `license` | No | SPDX license identifier |
| `engine` | No | Minimum Animus engine version required |
| `components` | Yes | Paths to component directories/files. Omit any component type not used. |
| `dependencies.plugins` | No | Other plugins this plugin depends on |
| `dependencies.system` | No | System requirements (Node.js version, etc.) |
| `permissions` | No | Declared permission requirements. Displayed to user before installation. |
| `configSchema` | No | JSON Schema describing plugin-specific configuration. Enables dynamic config forms in the UI. Fields marked `"sensitive": true` are encrypted in the DB using the Encryption Service (same pattern as channel credentials). |
| `setup` | No | Optional setup command run once after installation (e.g., install script dependencies). Receives `PLUGIN_ROOT` env var. |
| `store` | No | Store/marketplace metadata (categories, tags, pricing, screenshots). Fully optional — omit entirely for local/built-in plugins. Required only for future store submissions. |

---

## Component Types

### 1. Skills — Knowledge Injection (Agent Skills Standard)

Skills use the open [Agent Skills SKILL.md specification](https://agentskills.io/specification), the cross-vendor standard now supported natively by all three SDKs (Claude, Codex, OpenCode). The SDK handles progressive disclosure: metadata loaded at startup (~100 tokens per skill), full instructions loaded on-demand within the same turn when the agent decides a skill is relevant.

**Skill definition (`skills/code-review/SKILL.md`):**
```yaml
---
name: code-review
description: >
  Performs thorough code reviews focusing on bugs, security vulnerabilities,
  and maintainability issues. Use when asked to review code, audit security,
  or check code quality.
license: MIT
allowed-tools: Read Grep Glob Bash
metadata:
  author: animus-labs
  version: "1.0"
---

## Code Review Process

When reviewing code, follow these steps:

1. **Read the full file** before making any judgments
2. **Check for security issues** first (injection, auth bypass, data exposure)
3. **Check for logic errors** (off-by-one, null handling, race conditions)
4. **Check for maintainability** (naming, complexity, duplication)

### Output Format

For each issue found, report:
- **Severity**: critical / warning / suggestion
- **Location**: file path and line number
- **Issue**: What's wrong
- **Fix**: Recommended change
```

**Frontmatter fields (Agent Skills standard):**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | 1-64 chars, lowercase alphanumeric + hyphens, no consecutive `--`, must match parent directory name |
| `description` | Yes | Max 1024 chars. Describes when and how to use the skill. Include keywords for task matching. |
| `license` | No | License name or reference to bundled license file |
| `compatibility` | No | Max 500 chars. Environment requirements (intended product, system packages, network access) |
| `allowed-tools` | No | Space-delimited list of pre-approved tools (experimental). E.g. `Read Grep Glob Bash` |
| `metadata` | No | Arbitrary key-value pairs (author, version, tags, etc.) |

**How skills flow through the system (native SDK passthrough):**

```
Engine Startup
  └→ Plugin Manager scans plugin skills/ directories
      └→ Symlinks or copies SKILL.md directories to the active provider's
         discovery path:
           • Claude:   .claude/skills/{skill}/SKILL.md
           • Codex:    .agents/skills/{skill}/SKILL.md
           • OpenCode: .opencode/skills/{skill}/SKILL.md

Per Session (Mind or Sub-Agent)
  └→ SDK discovers skills automatically
      └→ Parses frontmatter (name + description) → ~100 tokens per skill
      └→ Makes skill catalog available to the LLM

When Skill Is Needed (same turn — no round-trip)
  └→ LLM decides skill is relevant based on metadata
      └→ Calls built-in "Skill" tool (Claude) or equivalent
          └→ Full SKILL.md body loaded into conversation context
              └→ Agent acts on enriched instructions immediately
                  └→ If skill references scripts/, agent runs them via Bash
```

**Skills can bundle CLI tools via `scripts/`:**

A powerful pattern where skills teach agents to interact with external systems through shell commands rather than MCP servers. The agent never reads script source into context — it runs scripts as black boxes and only consumes their output.

```
skills/twitter-research/
├── SKILL.md                # Teaches how to search, pull threads, monitor
├── scripts/
│   ├── search.ts           # CLI: npx tsx scripts/search.ts "query"
│   ├── thread.ts           # CLI: npx tsx scripts/thread.ts <url>
│   └── analytics.ts        # CLI: npx tsx scripts/analytics.ts <handle>
└── references/
    └── api-limits.md       # Rate limit documentation (loaded on demand)
```

**When to use skills with scripts vs MCP:**

| Use Case | Skills + Scripts | MCP Server |
|----------|-----------------|------------|
| Simple CLI wrappers | Best choice — lightweight, token-efficient | Overkill |
| Existing CLI tools (git, docker, psql) | Best choice — teach agent to use what exists | Unnecessary |
| Credential isolation needed | Not ideal — creds may appear in shell history | Best choice |
| Persistent connections (WebSocket, DB) | Not possible | Best choice |
| Structured access control | Limited | Best choice |
| Agent self-modification | Possible — agent can edit its own scripts | Not possible |
| Token efficiency | ~4x better (only script output in context) | JSON schemas consume significant tokens |

**Cross-provider compatibility**: One SKILL.md works natively in all three SDKs. The Plugin Manager handles placing skills in the correct provider-specific directory.

### 2. Tools — MCP Servers

Tools use MCP as the universal mechanism. All three SDKs support MCP natively.

**Transport**: Plugins MUST use **stdio** for bundled/local MCP servers. This is universally supported and recommended by the MCP spec. Remote MCP servers (future store scenario) use **Streamable HTTP**.

**MCP config (`tools/mcp.json`):**
```json
{
  "code-analysis": {
    "command": "node",
    "args": ["${PLUGIN_ROOT}/servers/analysis-server.js"],
    "env": {
      "MAX_FILE_SIZE": "1048576"
    },
    "description": "Static analysis tools for code quality metrics"
  }
}
```

**How tools flow:**

1. Plugin Manager reads `tools/mcp.json` from each enabled plugin
2. `${PLUGIN_ROOT}` is substituted with the plugin's absolute path
3. MCP server definitions are merged into the session's `mcpServers` config
4. Config is translated to each SDK's format:
   - Claude: `{ command, args, env }` (identical)
   - Codex: `{ command, args, env }` (identical)
   - OpenCode: `{ type: "local", command: [command, ...args], environment: env }`
5. Tools are filtered by contact permission tier before session creation

**Tool naming**: Tools from plugins are namespaced as `{plugin-name}__{tool-name}` to prevent collisions across plugins.

### 3. Context Sources — Dynamic Data Providers

Context sources provide **dynamic data** that changes per tick — external knowledge bases, API data, live system state. Unlike skills (which are instructions handled by the SDK), context sources are Animus-managed and injected into the system prompt by the Context Builder.

**Context source config (`context/context.json`):**
```json
{
  "sources": [
    {
      "name": "project-docs",
      "description": "Relevant project documentation based on current task",
      "type": "retrieval",
      "maxTokens": 3000,
      "priority": 4,
      "provider": {
        "command": "node",
        "args": ["${PLUGIN_ROOT}/providers/doc-retriever.js"]
      }
    },
    {
      "name": "team-conventions",
      "description": "Team coding conventions and style guide",
      "type": "static",
      "maxTokens": 1500,
      "priority": 6,
      "content": "${PLUGIN_ROOT}/data/conventions.md"
    }
  ]
}
```

**Source types:**

| Type | Description | Execution |
|------|-------------|-----------|
| `static` | Fixed content loaded from file. Reference data, not instructions. | Read file at startup, cache. |
| `retrieval` | Dynamic content generated per tick. Receives tick context, returns relevant content. | Run provider process, pass context via stdin, read result from stdout. |

**How context sources flow:**

```
Per Tick (GATHER CONTEXT)
  └→ Context Builder requests active context sources from Plugin Manager
      ├→ Static sources: return cached content
      └→ Retrieval sources: invoke provider process with tick context
          └→ Provider returns relevant content (e.g., search results from external KB)
              └→ Content injected into context, subject to token budget
```

**Why separate from skills?** Skills are _instructions_ (how to do something) and are handled by the SDK's native progressive disclosure. Context sources are _information_ (what to know) and are Animus-managed with per-tick dynamic retrieval. This distinction matters for token budgeting and lifecycle management.

### 4. Hooks — Lifecycle Interceptors

Hooks operate at the **Animus orchestrator level**, completely independent of SDK-internal hooks. This means they work identically regardless of which provider is active. This bypasses Codex's lack of hooks and OpenCode's unresolved subagent interception bugs.

**Hook config (`hooks/hooks.json`):**
```json
{
  "hooks": [
    {
      "event": "preDecision",
      "matcher": { "type": "send_message" },
      "handler": {
        "type": "command",
        "command": "${PLUGIN_ROOT}/scripts/validate-response.sh"
      }
    },
    {
      "event": "postTick",
      "handler": {
        "type": "command",
        "command": "${PLUGIN_ROOT}/scripts/log-tick.sh"
      }
    }
  ]
}
```

**Available hook events:**

| Event | When | Can Block? | Receives |
|-------|------|------------|----------|
| `preTick` | Before heartbeat tick processes | Yes | Trigger context, contact info |
| `postTick` | After tick completes | No | Tick result summary |
| `preDecision` | Before EXECUTE processes a mind decision | Yes (can modify or veto) | Decision object |
| `postDecision` | After a decision is executed | No | Decision + outcome |
| `preSubAgent` | Before a sub-agent is spawned | Yes | Agent config, task description |
| `postSubAgent` | After a sub-agent completes | No | Agent result |
| `preMessage` | Before a message is sent to a contact | Yes (can modify content) | Message content, channel, contact |
| `postMessage` | After a message is sent | No | Delivery confirmation |
| `onPluginInstall` | After a plugin is installed | No | Plugin manifest |
| `onPluginRemove` | Before a plugin is removed | No | Plugin name |

**Handler types:**

| Type | Description |
|------|-------------|
| `command` | Shell command. Receives event data via stdin (JSON), returns result via stdout. Non-zero exit = block (for blocking events). |

**Why not in-process hooks?** Plugins come from external sources. Running plugin code as separate processes provides basic isolation without the complexity of sandboxing. The overhead is minimal for the events we support (tick-level, not per-token).

### 5. Agents — Sub-Agent Templates

Agent definitions provide prompt templates for specialized sub-agents. The orchestrator merges the Animus personality with the agent's instructions when creating sessions.

**Agent definition (`agents/security-reviewer.md`):**
```yaml
---
name: security-reviewer
description: Reviews code for security vulnerabilities and OWASP Top 10 issues
tools:
  - read
  - grep
  - glob
maxTurns: 20
---

You are a security-focused code reviewer. Your expertise covers:
- OWASP Top 10 vulnerabilities
- Authentication and authorization flaws
- Input validation and injection attacks
- Cryptographic weaknesses
- Sensitive data exposure

## Review Process

1. Identify all entry points (API endpoints, user inputs, file uploads)
2. Trace data flow from input to output
3. Check for missing validation, sanitization, or encoding
4. Review authentication and authorization logic
5. Check for hardcoded secrets or insecure configurations
```

**Frontmatter fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Agent name, used by mind when requesting delegation |
| `description` | Yes | Shown in agent catalog for mind's delegation decisions |
| `tools` | No | SDK-native tools this agent needs (read, write, bash, etc.) |
| `maxTurns` | No | Maximum turns for this agent type. Default from system settings. |

### 6. Decision Types — Custom EXECUTE Handlers

Plugins can register new decision types that the mind can output. Each type defines a schema for its decision payload and a handler that runs during the EXECUTE stage. This is what makes Animus plugins uniquely powerful — they extend what the mind can *do*, not just what it *knows*.

**Decision type config (`decisions/decisions.json`):**
```json
{
  "types": [
    {
      "name": "control_device",
      "description": "Control a smart home device (turn on/off, set temperature, etc.)",
      "payloadSchema": {
        "type": "object",
        "properties": {
          "deviceId": { "type": "string", "description": "Home Assistant device ID" },
          "action": { "type": "string", "enum": ["turn_on", "turn_off", "set_value"] },
          "value": { "type": "number", "description": "Value for set_value action" }
        },
        "required": ["deviceId", "action"]
      },
      "handler": {
        "type": "command",
        "command": "${PLUGIN_ROOT}/handlers/control-device.sh"
      },
      "contactTier": "primary"
    },
    {
      "name": "send_notification",
      "description": "Send a push notification to the user's devices",
      "payloadSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "body": { "type": "string" },
          "priority": { "type": "string", "enum": ["low", "normal", "high"] }
        },
        "required": ["title", "body"]
      },
      "handler": {
        "type": "command",
        "command": "${PLUGIN_ROOT}/handlers/push-notify.sh"
      },
      "contactTier": "primary"
    }
  ]
}
```

**How custom decisions flow through the system:**

```
Plugin Manager (startup)
  └→ Registers custom decision types from enabled plugins
      └→ Validates payload schemas, stores handler references

Context Builder (GATHER CONTEXT)
  └→ Includes available decision types in the mind's operational instructions:
      "You can also make these decisions:
       - control_device: Control a smart home device (turn on/off, set temperature, etc.)
       - send_notification: Send a push notification to the user's devices"
      └→ Includes payload schema descriptions so the mind knows what fields to provide

Mind (MIND QUERY)
  └→ Outputs a decision with a plugin-defined type:
      { "type": "control_device", "payload": { "deviceId": "light.office", "action": "turn_on" } }

EXECUTE Stage
  │
  ├→ Recognizes "control_device" as a plugin decision type
  │
  ├→ Validates contact tier (decision requires "primary", contact must be primary)
  │   └→ If contact is standard/unknown: drop decision, log as "permission denied"
  │
  ├→ Validates payload against registered JSON Schema
  │   └→ If invalid: drop decision, log as "invalid payload"
  │
  ├→ fireHook('preDecision', decision) — plugin hooks can still intercept
  │
  ├→ Executes handler:
  │   └→ Runs command as subprocess
  │       └→ Passes decision payload via stdin (JSON)
  │       └→ Reads result from stdout (JSON: { success: boolean, result?: any, error?: string })
  │       └→ Non-zero exit = failure
  │
  ├→ Logs decision outcome in tick_decisions table
  │
  └→ fireHook('postDecision', { decision, outcome })
```

**Decision type fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Decision type name. Must be unique across all plugins. |
| `description` | Yes | Human-readable description shown to the mind in context. |
| `payloadSchema` | Yes | JSON Schema for the decision's payload object. |
| `handler.type` | Yes | `"command"` — shell command handler. |
| `handler.command` | Yes | Command to execute. Receives payload via stdin, returns result via stdout. |
| `contactTier` | No | Minimum contact tier required (`primary`, `standard`). Default: `primary`. |

**Key constraints:**
- Custom decisions go through the same EXECUTE pipeline as built-in decisions (contact tier enforcement, hook firing, outcome logging).
- Handlers run as separate processes (basic isolation).
- The mind learns about available custom decisions from the Context Builder's operational instructions section.

### 7. Triggers — Custom Tick Trigger Sources

Plugins can register new tick trigger sources beyond the four built-in ones (interval timer, message received, scheduled task, sub-agent completion). Triggers allow external events to initiate heartbeat ticks.

**Trigger config (`triggers/triggers.json`):**
```json
{
  "triggers": [
    {
      "name": "webhook",
      "description": "Fires when an HTTP webhook is received",
      "type": "http",
      "config": {
        "path": "/webhooks/{plugin-name}",
        "methods": ["POST"]
      }
    },
    {
      "name": "file_change",
      "description": "Fires when watched files change",
      "type": "watcher",
      "config": {
        "command": "${PLUGIN_ROOT}/watchers/file-monitor.sh",
        "interval": 30
      }
    }
  ]
}
```

**How custom triggers flow through the system:**

```
Plugin Manager (startup)
  └→ Registers trigger sources from enabled plugins
      ├→ "http" triggers: registers routes on the Fastify server
      └→ "watcher" triggers: starts long-running watcher processes

External Event Occurs
  │
  ├→ HTTP trigger: POST /webhooks/home-assistant arrives
  │   └→ Plugin Manager receives event, extracts payload
  │
  └→ Watcher trigger: file-monitor.sh outputs an event to stdout
      └→ Plugin Manager reads event from process stdout

Plugin Manager
  └→ Creates a trigger context object:
      {
        "type": "plugin_trigger",
        "plugin": "home-assistant",
        "trigger": "webhook",
        "payload": { ... },          // The event data
        "contact_id": null            // No contact (system-initiated)
      }

Tick Queue
  └→ Enqueues a heartbeat tick with the plugin trigger context
      └→ Tick processes through normal pipeline: GATHER → MIND → EXECUTE
          └→ Mind sees trigger context and responds appropriately
```

**Trigger types:**

| Type | Description | Implementation |
|------|-------------|----------------|
| `http` | Registers an HTTP endpoint on the Animus server. External services send webhooks to trigger ticks. | Fastify route registered at plugin load time. |
| `watcher` | Long-running process that monitors for changes and outputs events. | Spawned as subprocess. Reads JSON events from stdout line-by-line. |

**Trigger definition fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Trigger name, unique within the plugin. |
| `description` | Yes | Human-readable description. |
| `type` | Yes | `"http"` or `"watcher"` |
| `config.path` | For `http` | URL path for the webhook endpoint. `{plugin-name}` is auto-substituted. |
| `config.methods` | For `http` | HTTP methods to accept. Default: `["POST"]` |
| `config.command` | For `watcher` | Command to run as long-lived process. |
| `config.interval` | For `watcher` | Polling interval in seconds (if applicable). |

**Key constraints:**
- Plugin triggers create **system-initiated ticks** (no contact). The mind processes them like interval ticks but with the plugin's event data as context.
- HTTP trigger endpoints are namespaced under `/webhooks/{plugin-name}` to prevent path collisions.
- Watcher processes are managed by the Plugin Manager and restarted on failure.
- Triggers respect the tick queue — rapid-fire events are debounced by the existing tick queue logic.

---

## Plugin Manager

The Plugin Manager is a backend service that loads, validates, indexes, and provides plugin components to the rest of the system.

### Lifecycle

```
Engine Startup
  │
  ▼
┌───────────────────────────────────────────────────────┐
│  Plugin Manager                                        │
│  1. Scan plugin directories                            │
│     • packages/backend/plugins/  (built-in, ship w/ engine) │
│     • ~/.animus/plugins/         (downloaded: git/npm/store) │
│     • system.db plugin_paths     (registered local paths)    │
│  2. Validate manifests (Zod schemas)                   │
│  3. Check engine version compatibility                 │
│  4. Resolve plugin dependencies                        │
│  5. Deploy skills to active provider's discovery dir   │
│  6. Collect MCP server configs                         │
│  7. Prepare context source providers                   │
│  8. Register hooks                                     │
│  9. Register custom decision types                     │
│  10. Register and start custom triggers                │
│  11. Index agent templates                             │
│  12. Store plugin state in system.db                   │
└───────────────────────────────────────────────────────┘
  │
  ▼
Runtime (per tick)
  │
  ├─→ Context Builder requests:
  │   ├─→ Custom decision type descriptions (for operational instructions)
  │   ├─→ Agent catalog (for delegation decisions)
  │   └─→ Context source content (static + retrieval results)
  │
  ├─→ SDK sessions automatically discover deployed skills
  │
  ├─→ Orchestrator requests:
  │   ├─→ MCP server configs for session
  │   ├─→ Agent templates for delegation
  │   ├─→ Decision type handlers for EXECUTE
  │   └─→ Hook handlers for lifecycle events
  │
  ├─→ EXECUTE fires hooks and runs decision handlers
  │
  └─→ Plugin triggers can enqueue new ticks at any time
```

### Hot-Swap Lifecycle

Plugins can be installed, enabled, disabled, and uninstalled **while the engine is running** — no restart required. This is critical for the future plugin store where the Animus mind itself can install plugins via MCP tools.

**How it works:** The heartbeat system naturally creates discrete agent sessions per tick. When a plugin changes, the next tick's session automatically picks up the new state. Components that don't depend on agent sessions (hooks, triggers, MCP servers) take effect immediately.

```
Plugin Install (runtime)
  │
  ├─→ Plugin Manager validates manifest
  ├─→ Deploy skills to active provider's discovery path (symlink)
  ├─→ Register hooks on EventBus                          ← immediate
  ├─→ Start MCP servers                                   ← immediate
  ├─→ Register custom decision types in registry           ← immediate
  ├─→ Register triggers (HTTP routes, start watchers)      ← immediate
  ├─→ Index agent templates                                ← immediate
  │
  ├─→ Emit 'plugin:changed' on EventBus
  │   └─→ Heartbeat sets sessionInvalidated = true
  │
  └─→ Next tick: forces cold session start (no warm session reuse)
      └─→ New session discovers deployed skills
      └─→ Context Builder includes new decision types
      └─→ Mind has full access to new plugin capabilities
```

```
Plugin Uninstall (runtime)
  │
  ├─→ Stop and deregister triggers (remove routes, kill watchers)  ← immediate
  ├─→ Deregister hooks from EventBus                                ← immediate
  ├─→ Stop MCP servers                                              ← immediate
  ├─→ Deregister custom decision types                              ← immediate
  ├─→ Remove agent templates                                        ← immediate
  ├─→ Remove skill symlinks from provider discovery path
  │
  ├─→ Emit 'plugin:changed' on EventBus
  │   └─→ Heartbeat sets sessionInvalidated = true
  │
  └─→ Next tick: forces cold session start
      └─→ Skills no longer discoverable
      └─→ Decision types no longer in context
      └─→ Removed cleanly — no stale references
```

**Session invalidation — why it matters:**

Message-received ticks may keep a **warm session** (continuing an existing conversation context) rather than starting cold each time. A warm session was initialized before the plugin change and won't see new skills or decision types. The `plugin:changed` event forces the next tick to start a cold session regardless of trigger type.

- **Mind sessions**: Cold start on next tick. New skills and decision types available immediately.
- **Running sub-agents**: Continue with their existing capabilities until completion. They were spawned for a specific task and shouldn't have context yanked mid-work. New sub-agents spawned after the change get the updated capabilities.

**Per-component hot-swap timing:**

| Component | When Available | Mechanism |
|-----------|---------------|-----------|
| **Skills** | Next tick (cold session) | Symlinks added/removed from SDK discovery path |
| **MCP Tools** | Process starts immediately, mind access on next tick | MCP server processes started/stopped immediately; mind needs cold session to see new tools |
| **Context Sources** | Next tick | Context Builder evaluates sources fresh each tick |
| **Hooks** | Immediately | Event listeners added/removed from EventBus |
| **Decision Types** | Next tick (cold session) | Registered in Plugin Manager, included by Context Builder |
| **Triggers** | Immediately | HTTP routes added/removed, watcher processes started/stopped |
| **Agents** | Next tick | Agent catalog refreshed, mind sees new options |

**OpenCode adapter reinitialization:**

OpenCode caches discovered skills at startup with no hot-reload. When `plugin:changed` fires, the OpenCode adapter reinitializes its connection with updated `config.skills.paths`, ensuring the next session sees the new skill set. Claude and Codex adapters don't need special handling — they scan the filesystem per session.

**Provider switching:**

When the user switches providers (e.g., Claude → Codex) via Settings, the Plugin Manager must redeploy all skills:

```
Provider Switch (Settings UI)
  │
  ├─→ Plugin Manager cleans up old provider's skill symlinks
  │     (remove all from .claude/skills/)
  │
  ├─→ Plugin Manager deploys skills to new provider's discovery path
  │     (symlink to .agents/skills/)
  │
  ├─→ If switching to OpenCode: reinitialize adapter with config.skills.paths
  │
  ├─→ Emit 'plugin:changed' on EventBus
  │
  └─→ Next tick starts cold session with new provider + correct skills
```

The provider switch handler (wherever it lives in the settings/orchestrator) must call `pluginManager.cleanupSkills()` then `pluginManager.deploySkills(newProvider)`. This is the same code path used during hot-swap — provider switching is just a special case of skill redeployment.

### Skill Deployment

At startup (and when plugins are installed/enabled), the Plugin Manager deploys skills to the active SDK's discovery directory:

```typescript
async function deploySkills(plugin: PluginManifest, provider: 'claude' | 'codex' | 'opencode') {
  const skillDirs = await scanSkillDirectories(plugin.path, plugin.components.skills);

  for (const skillDir of skillDirs) {
    // Use skill name directly — Agent Skills spec requires name to match parent dir
    const targetPath = getProviderSkillPath(provider, skillDir.name);
    // Collision detection: error if another plugin already has a skill with this name
    if (deployedSkills.has(skillDir.name)) {
      throw new Error(`Skill name collision: "${skillDir.name}"`);
    }
    await symlink(skillDir.absolutePath, targetPath);
    deployedSkills.add(skillDir.name);
  }
}

function getProviderSkillPath(provider: string, skillName: string): string {
  switch (provider) {
    case 'claude':   return path.join(process.cwd(), '.claude', 'skills', skillName);
    case 'codex':    return path.join(process.cwd(), '.agents', 'skills', skillName);
    case 'opencode': return path.join(process.cwd(), '.opencode', 'skills', skillName);
  }
}
```

Skills are cleaned up when plugins are disabled or uninstalled. Both deployment and cleanup happen at runtime without engine restart — the `plugin:changed` event ensures the next session picks up the changes.

### Plugin Storage

Plugin state is tracked in `system.db`:

```sql
CREATE TABLE plugins (
  name TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  path TEXT NOT NULL,              -- Absolute path to plugin directory
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL,      -- ISO 8601
  updated_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'local',  -- 'built-in' | 'local' | 'git' | 'npm' | 'store'
  store_id TEXT,                   -- Store listing ID (if from store)
  config_encrypted TEXT            -- Encrypted JSON blob (plugin-specific user config)
);

-- source values:
--   'built-in' — packages/backend/plugins/, auto-discovered, can disable but not uninstall
--   'local'    — registered path, plugin stays on disk where it is
--   'git'      — cloned to ~/.animus/plugins/, can update via git pull
--   'npm'      — installed to ~/.animus/plugins/, can update via npm
--   'store'    — downloaded to ~/.animus/plugins/, can update via store API
```

### Plugin Configuration

Plugins that connect to external services need user-provided configuration (API keys, URLs, preferences). This follows the same pattern as channel configuration (see `docs/architecture/channel-packages.md`).

**How it works:**

1. Plugin declares a `configSchema` in `plugin.json` (JSON Schema format)
2. Settings > Plugins UI renders a dynamic form from the schema
3. User fills in the config; it's validated against the schema
4. Sensitive fields (`"sensitive": true`) are encrypted using the Encryption Service before storage
5. Config is stored in the `plugins.config_encrypted` column (encrypted JSON blob)
6. Plugin handlers receive decrypted config via environment variables or stdin

**Config flow for handlers:**

```
User configures plugin in Settings
  └→ UI renders form from configSchema
      └→ User fills in values (haUrl, apiToken, pollingInterval)
          └→ Plugin Manager validates against schema
              └→ Sensitive fields encrypted via EncryptionService
                  └→ Stored in plugins.config_encrypted

Handler execution (decision/hook/trigger/context provider)
  └→ Plugin Manager decrypts config
      └→ Passes as JSON to handler via stdin alongside the event payload:
          {
            "event": { ... },       // Decision payload, hook data, etc.
            "config": {              // Decrypted plugin config
              "haUrl": "http://homeassistant.local:8123",
              "apiToken": "eyJ...",
              "pollingInterval": 60
            }
          }
```

**Why this pattern?** Same rationale as channel configs — credentials must be encrypted at rest, the UI needs to know what fields to render, and handlers need access to config at runtime. The `sensitive` flag is a custom extension to JSON Schema that tells the Plugin Manager which fields to encrypt, mirroring how channel configs encrypt the entire blob.

### API Surface

The Plugin Manager exposes these methods to the rest of the backend:

```typescript
interface IPluginManager {
  // Lifecycle (all mutating methods emit 'plugin:changed' on EventBus)
  loadAll(): Promise<void>;
  enable(name: string): Promise<void>;
  disable(name: string): Promise<void>;
  install(source: PluginSource): Promise<PluginManifest>;
  uninstall(name: string): Promise<void>;

  // Skills (native SDK passthrough)
  deploySkills(provider: string): Promise<void>;
  cleanupSkills(): Promise<void>;

  // Tools
  getMcpConfigs(): Record<string, McpServerConfig>;

  // Context
  getStaticContextSources(): ContextContent[];
  getRetrievalContextSources(tickContext: TickContext): Promise<ContextContent[]>;

  // Hooks
  fireHook(event: HookEvent, data: unknown): Promise<HookResult>;

  // Decisions
  getDecisionTypes(): DecisionTypeDefinition[];
  getDecisionDescriptions(): string;  // Formatted text for context builder
  executeDecision(type: string, payload: unknown, contact: Contact): Promise<DecisionResult>;

  // Triggers
  getTriggerSources(): TriggerSource[];
  startTriggers(): Promise<void>;
  stopTriggers(): Promise<void>;

  // Agents
  getAgentTemplate(name: string): AgentTemplate | undefined;
  getAgentCatalog(): AgentCatalogEntry[];

  // Store (future)
  browseStore(query: string): Promise<StoreListingEntry[]>;
  installFromStore(id: string): Promise<PluginManifest>;
}
```

---

## Integration Points

### Context Builder Integration

The Context Builder assembles the system prompt for mind ticks and sub-agent sessions. Plugin components integrate at specific points:

```
System Prompt Composition
├── Persona Section (compiled from personality config)
├── Core Self Section (agent's self-knowledge)
├── Emotional State Section
├── Contact & Permissions Section
├── Short-Term Memory Section
├── Working Memory Section
├── Long-Term Memory Section
├── Goals & Tasks Section
├── Agent Status Section
├── Operational Instructions Section
│   └── ── PLUGIN: Custom Decision Types ──    ← Descriptions + payload schemas
├── ── PLUGIN: Context Sources ──              ← Dynamic/static context data
├── ── PLUGIN: Agent Catalog ──                ← Available plugin agents for delegation
└── Session Notes (conditional)
```

**Skills are NOT in the system prompt.** The SDK handles skill discovery and progressive disclosure natively. Skills are deployed to the filesystem and the SDK's built-in Skill tool manages loading them on-demand.

**Custom decision types** are included in the operational instructions section so the mind knows what actions are available. The Context Builder formats decision descriptions and payload schemas into concise text.

**Token budget allocation**: Plugin context sources and decision descriptions compete for the overall context budget. Each component declares its `maxTokens`. The Context Builder enforces a **combined plugin budget** (configurable, default ~15% of context window) and drops lowest-priority items when over budget.

### EXECUTE Stage — Decisions and Hooks

During the EXECUTE stage, the orchestrator processes decisions from MindOutput, including both built-in and plugin-defined types:

```
EXECUTE processes decisions:
  for each decision in mindOutput.decisions:
    │
    ├─→ Is this a plugin decision type?
    │   ├─→ Yes: validate contact tier, validate payload schema
    │   └─→ No: use built-in handler
    │
    ├─→ fireHook('preDecision', decision)
    │   └─→ if blocked: log decision as "dropped by hook", skip
    │
    ├─→ Execute decision
    │   ├─→ Built-in: send_message, spawn_agent, update_goal, etc.
    │   └─→ Plugin: run handler command with payload via stdin
    │
    └─→ fireHook('postDecision', { decision, outcome })
```

### Orchestrator Integration

When spawning sub-agents, the orchestrator merges plugin components:

```
spawn_agent decision
  │
  ├─→ Get agent template from Plugin Manager (if plugin agent)
  │   └─→ Merge with Animus personality prompt
  │
  ├─→ Get MCP configs from Plugin Manager
  │   └─→ Merge plugin MCP servers with built-in tools
  │   └─→ Filter by contact permission tier
  │
  ├─→ Skills are already deployed to provider discovery directory
  │   └─→ SDK discovers them automatically for sub-agent sessions
  │
  └─→ Create session via adapter with merged config
```

---

## AI Self-Installation

A key differentiator: the Animus mind can discover and install plugins itself.

### Plugin Store MCP Tool

The Plugin Manager exposes MCP tools that the mind can use:

```typescript
// Tool: browse_plugins
{
  name: 'browse_plugins',
  description: 'Search the plugin store for plugins that could help with a task.',
  inputSchema: z.object({
    query: z.string().describe('Natural language search query'),
    category: z.string().optional(),
    limit: z.number().default(5),
  }),
}

// Tool: install_plugin
{
  name: 'install_plugin',
  description: 'Request installation of a plugin. Requires user approval.',
  inputSchema: z.object({
    pluginId: z.string().describe('Plugin store ID'),
    reason: z.string().describe('Why this plugin would be helpful'),
  }),
}

// Tool: list_installed_plugins
{
  name: 'list_installed_plugins',
  description: 'List all currently installed plugins and their status.',
  inputSchema: z.object({}),
}
```

### Installation Flow (AI-Initiated)

```
Mind encounters a task it can't handle well
  │
  ├─→ Mind calls browse_plugins("email integration tools")
  │   └─→ Returns: [{ name: "email-connector", description: "...", price: "free" }]
  │
  ├─→ Mind calls install_plugin({ pluginId: "email-connector", reason: "..." })
  │   └─→ Plugin Manager creates installation request
  │       └─→ User is notified: "Animus wants to install 'email-connector' because: ..."
  │           └─→ User approves or denies
  │
  └─→ If approved:
      ├─→ Plugin is downloaded and validated
      ├─→ Plugin Manager loads components, deploys skills
      └─→ Mind is informed: "Plugin installed. New capabilities available."
```

**User always approves.** The mind can suggest, but installation requires explicit user consent. This is non-negotiable for trust and security.

### Installation Flow (Human-Initiated)

**Local path (development / pre-store):**
```
User opens Settings > Plugins > "Add Local Plugin"
  │
  ├─→ Enters or browses for directory path
  │   └─→ Plugin Manager validates plugin.json at that path
  │
  ├─→ Reviews requested permissions
  │   └─→ "This plugin needs: bash access, network access"
  │
  ├─→ Path registered in system.db
  │   └─→ Plugin loaded, components activated (hot-swap lifecycle)
  │
  └─→ Plugin appears in Settings > Plugins
      └─→ Can enable/disable/configure/uninstall
```

**Git / npm (pre-store distribution):**
```
User opens Settings > Plugins > "Add from Git" or "Add from npm"
  │
  ├─→ Enters git URL or npm package name
  │   └─→ Plugin Manager clones/installs to ~/.animus/plugins/{name}/
  │
  ├─→ Validates plugin.json, reviews permissions
  │
  └─→ Plugin loaded and appears in Settings > Plugins
```

**Store (future):**
```
User browses store (web UI)
  │
  ├─→ Finds plugin, clicks "Install"
  │   └─→ Plugin Manager downloads to ~/.animus/plugins/{name}/
  │
  ├─→ Reviews requested permissions
  │
  └─→ Plugin loaded and appears in Settings > Plugins
```

---

## Distribution & Store Architecture

### Plugin Sources & Installation

Plugins come from three sources, each with different installation mechanics:

| Source | Installation | Where It Lands | Use Case |
|--------|-------------|----------------|----------|
| **Built-in** | Auto-discovered at startup | `packages/backend/plugins/` (in engine) | Core functionality shipped with Animus |
| **Local path** | Register path in system.db via Settings | Stays on disk where it is (no copy) | Development, first-party plugins |
| **Git repository** | `git clone` via Settings or CLI | `~/.animus/plugins/{name}/` | Open source distribution |
| **npm package** | `npm install` via Settings or CLI | `~/.animus/plugins/{name}/` | Community distribution |
| **Store** | Download via store UI or AI | `~/.animus/plugins/{name}/` | Future marketplace |

**Local path registration** is the key pre-store workflow. The plugin stays where it is on disk — Animus just learns where to find it. This is ideal for development because edits to the plugin source take effect on the next tick (after session invalidation). No file copying, no sync issues.

**Settings > Plugins page** provides:
1. **Add Local Plugin** — enter or browse for a directory path containing a `plugin.json`
2. **Add from Git** — enter a git URL, engine clones it to `~/.animus/plugins/`
3. **Add from npm** — enter a package name, engine installs to `~/.animus/plugins/`
4. **Browse Store** — future marketplace integration

All installed plugins appear in a list with enable/disable toggles, version info, and uninstall option. Built-in plugins can be disabled but not uninstalled.

### Monorepo Layout

The monorepo separates built-in plugins (ship with engine) from first-party plugins (same team, distributed separately):

```
/plugins/                        # First-party plugins (NOT shipped with engine)
├── home-assistant/              #   Distributed via store/git/npm
│   ├── plugin.json              #   Developed here for convenience
│   ├── skills/                  #   Installed locally via path registration during dev
│   │   └── home-control/
│   │       ├── SKILL.md
│   │       └── scripts/
│   │           └── ha-cli.sh
│   ├── tools/
│   │   └── mcp.json
│   ├── decisions/
│   │   └── decisions.json
│   ├── triggers/
│   │   └── triggers.json
│   └── agents/
│       └── home-automator.md
├── calendar/
│   ├── plugin.json
│   └── ...
└── email-connector/
    ├── plugin.json
    └── ...

/packages/
  /backend/
    /plugins/                    # Built-in plugins (shipped with engine)
    │ ├── web-research/          #   Auto-discovered at startup
    │ │   ├── plugin.json        #   Can be disabled, not uninstalled
    │ │   ├── skills/
    │ │   │   └── research/
    │ │   │       └── SKILL.md
    │ │   └── tools/
    │ │       └── mcp.json
    │ └── ...
    /src/
    /...
  /frontend/
  /shared/
  /agents/
```

**Built-in vs first-party distinction:**
- **Built-in** (`packages/backend/plugins/`): Ship with the engine binary/distribution. Auto-discovered. Can be disabled but not uninstalled. Examples: web research, core tools.
- **First-party** (`/plugins/`): Built by the Animus team, developed in the same monorepo for convenience, but distributed separately (eventually via store, for now via git/npm/local path). Users must explicitly install them. Examples: home-assistant, calendar, email.

### Store API (Future)

The plugin store is a remote service that Animus instances connect to:

```
┌────────────────────────┐         ┌─────────────────────────┐
│    Animus Instance      │  HTTPS  │    Plugin Store API      │
│                         │ ──────→ │                          │
│  Plugin Manager         │         │  GET /plugins?q=...     │
│    browse_plugins()     │ ←────── │  GET /plugins/:id       │
│    installFromStore()   │         │  GET /plugins/:id/dl    │
│                         │         │  POST /plugins/:id/rate │
│                         │         │                          │
│  User approves install  │         │  Auth: API key or        │
│    ↓                    │         │  anonymous browsing      │
│  Downloads & validates  │         └─────────────────────────┘
│  Loads plugin locally   │
└────────────────────────┘
```

**Store metadata per listing:**
- Name, description, version, author
- Category tags
- Install count, rating
- Screenshots
- Pricing (free / one-time / subscription)
- Permissions required
- Engine version compatibility
- Source code link (if open source)
- Review/audit status

**Trust model:**
- All plugins are reviewed before store listing
- Permission declarations are enforced (plugin can't access more than it declares)
- User sees permissions before installation
- Plugin code is auditable (source available or checksummed)

---

## Security & Permissions

### Plugin Permission Model

Plugins declare required permissions in `plugin.json`. Users review these before installation.

```json
{
  "permissions": {
    "tools": ["read", "grep", "glob"],
    "network": false,
    "filesystem": "read-only",
    "contacts": false,
    "memory": "read-only"
  }
}
```

| Permission | Values | Description |
|-----------|--------|-------------|
| `tools` | Tool name list | SDK-native tools the plugin's agents/skills need |
| `network` | `true/false` | Whether MCP servers need network access |
| `filesystem` | `none/read-only/read-write` | File system access for MCP servers |
| `contacts` | `true/false` | Whether the plugin can access contact information |
| `memory` | `none/read-only/read-write` | Access to Animus memory systems |

### Hard Constraints (Cannot Be Bypassed)

These are enforced by the engine regardless of plugin declarations:

1. **Contact tier enforcement**: Plugins cannot grant higher permissions than the contact's tier allows. Custom decision types specify a `contactTier` minimum.
2. **MindOutput schema**: Plugins cannot modify core schema fields. Custom decision types extend the `decisions` array with new type values.
3. **Sub-agent hierarchy**: Plugin agents cannot spawn further sub-agents.
4. **Memory write authority**: Only the mind writes long-term memory. Plugin agents have read-only access.
5. **Decision enforcement**: EXECUTE stage drops any decisions that violate contact tier restrictions, regardless of plugin hooks.
6. **Trigger isolation**: Plugin triggers can only enqueue ticks — they cannot directly modify state or bypass the heartbeat pipeline.

### Plugin Isolation

Plugins are trusted (self-hosted, single-user system), but basic isolation exists:

- **MCP servers**: Run as separate processes (inherent process isolation)
- **Hooks / Decision handlers**: Run as shell commands in separate processes
- **Trigger watchers**: Run as managed subprocesses
- **Skills**: Pure markdown files + optional scripts (agent decides what to execute)
- **Context sources**: Provider processes run in isolation

No sandboxing or VM isolation initially. If the store introduces untrusted third-party plugins in the future, we can add:
- Container-based isolation for MCP servers and handlers
- Permission enforcement via seccomp/AppArmor
- Network namespace isolation

### Handler Timeouts & Process Management

All plugin handlers run as subprocesses. Timeouts prevent hung processes from stalling the pipeline:

| Handler Type | Timeout | On Timeout |
|-------------|---------|------------|
| **Decision handlers** | 30s | Kill process, log decision as `failed`, continue EXECUTE |
| **Blocking hooks** (pre*) | 10s | Kill process, treat as "allow" (don't block), log warning |
| **Non-blocking hooks** (post*) | 30s | Kill process, log warning, continue |
| **Context retrieval providers** | 10s | Kill process, skip this source, log warning |
| **Watcher processes** | No timeout (long-running) | Restart on crash with exponential backoff |

**Watcher restart policy**: On crash, restart after 1s, then 2s, 4s, 8s, 16s, 32s, 60s (max). After 5 consecutive failures without a successful event, mark the trigger as `failed` and log an error. Reset the failure count on any successful event emission.

**Handler input/output protocol**: All handlers receive JSON on stdin and return JSON on stdout. The input always includes the event-specific payload plus the decrypted plugin config:

```json
{
  "event": { /* decision payload, hook data, trigger event, etc. */ },
  "config": { /* decrypted plugin config from system.db */ }
}
```

Handlers return:
```json
{
  "success": true,
  "result": { /* handler-specific result */ }
}
```

Or on error:
```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

Non-zero exit codes are treated as failures regardless of stdout content.

### Decision Type Name Collisions

Decision type names must be unique across all installed plugins. When installing a plugin, the Plugin Manager checks all registered decision type names. If a collision is found, installation fails with a clear error:

> "Cannot install 'smart-things': decision type 'control_device' conflicts with plugin 'home-assistant'"

This is enforced at install time, not runtime. Plugin authors should choose descriptive, specific names. Names are NOT namespaced (unlike MCP tools) because they appear directly in the mind's output — `control_device` is cleaner than `home-assistant__control_device` in structured LLM output.

### Script Dependencies

Skills can bundle CLI scripts in their `scripts/` directory. For dependency management, the ecosystem has converged on these patterns:

1. **Self-contained scripts** (preferred) — Use only Node.js built-ins or Python standard library. No external dependencies to manage.
2. **Runtime auto-install via npx/bunx** — Scripts use `npx` or `bunx` to run tools that auto-install and cache globally. No explicit install step needed.
3. **Optional setup command** — Plugins can declare a `setup` field in `plugin.json` pointing to a setup script. The Plugin Manager runs this once after installation. Use for heavier dependencies (e.g., `npm install` in the plugin directory).
4. **Document in SKILL.md** — Use the `compatibility` frontmatter field to note system requirements.

The Plugin Manager does NOT automatically install dependencies for scripts. Scripts should be self-contained where possible. For complex dependencies, use MCP servers instead (which have their own process and dependency isolation).

---

## Schemas (Zod)

All manifest and component formats are validated with Zod schemas, defined in `@animus/shared`.

```typescript
// packages/shared/src/schemas/plugin.ts

import { z } from 'zod';

// --- Manifest ---

export const PluginManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  description: z.string().max(200),
  author: z.object({
    name: z.string(),
    url: z.string().url().optional(),
  }),
  license: z.string().optional(),
  engine: z.string().optional(),

  components: z.object({
    skills: z.string().optional(),
    tools: z.string().optional(),
    context: z.string().optional(),
    hooks: z.string().optional(),
    decisions: z.string().optional(),
    triggers: z.string().optional(),
    agents: z.string().optional(),
  }),

  dependencies: z.object({
    plugins: z.array(z.string()).default([]),
    system: z.record(z.string()).default({}),
  }).default({}),

  permissions: z.object({
    tools: z.array(z.string()).default([]),
    network: z.boolean().default(false),
    filesystem: z.enum(['none', 'read-only', 'read-write']).default('none'),
    contacts: z.boolean().default(false),
    memory: z.enum(['none', 'read-only', 'read-write']).default('none'),
  }).default({}),

  configSchema: z.record(z.unknown()).optional(),  // JSON Schema for plugin-specific config
  setup: z.string().optional(),                     // Post-install setup command

  store: z.object({
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    pricing: z.enum(['free', 'paid', 'subscription']).default('free'),
    screenshots: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
  }).optional(),
});

// --- Agent Frontmatter ---

export const AgentFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string().max(200),
  tools: z.array(z.string()).default([]),
  maxTurns: z.number().positive().optional(),
});

// --- Context Sources ---

export const ContextSourceSchema = z.object({
  name: z.string(),
  description: z.string().max(200),
  type: z.enum(['static', 'retrieval']),
  maxTokens: z.number().positive(),
  priority: z.number().min(1).max(10).default(5),
  provider: z.object({
    command: z.string(),
    args: z.array(z.string()).default([]),
  }).optional(),
  content: z.string().optional(),
});

// --- Hooks ---

export const HookDefinitionSchema = z.object({
  event: z.enum([
    'preTick', 'postTick',
    'preDecision', 'postDecision',
    'preSubAgent', 'postSubAgent',
    'preMessage', 'postMessage',
    'onPluginInstall', 'onPluginRemove',
  ]),
  matcher: z.record(z.unknown()).optional(),
  handler: z.object({
    type: z.literal('command'),
    command: z.string(),
  }),
});

// --- Custom Decision Types ---

export const DecisionTypeSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/),
  description: z.string().max(500),
  payloadSchema: z.record(z.unknown()),  // JSON Schema object
  handler: z.object({
    type: z.literal('command'),
    command: z.string(),
  }),
  contactTier: z.enum(['primary', 'standard']).default('primary'),
});

// --- Custom Triggers ---

export const TriggerDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z0-9_-]+$/),
  description: z.string().max(200),
  type: z.enum(['http', 'watcher']),
  config: z.object({
    path: z.string().optional(),        // For http triggers
    methods: z.array(z.string()).default(['POST']),  // For http triggers
    command: z.string().optional(),      // For watcher triggers
    interval: z.number().optional(),     // For watcher triggers (seconds)
  }),
});

// --- MCP Server Config (for plugin tools) ---

export const PluginMcpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  description: z.string().optional(),
});

// --- Type Exports ---

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;
export type ContextSource = z.infer<typeof ContextSourceSchema>;
export type HookDefinition = z.infer<typeof HookDefinitionSchema>;
export type DecisionType = z.infer<typeof DecisionTypeSchema>;
export type TriggerDefinition = z.infer<typeof TriggerDefinitionSchema>;
export type PluginMcpServer = z.infer<typeof PluginMcpServerSchema>;
```

**Note**: Skills use the Agent Skills SKILL.md standard format and are validated by the SDK, not by Animus Zod schemas. The plugin manifest only references the skills directory path.

---

## Implementation Status

### Implemented

| Component | Status | Key Files |
|-----------|--------|-----------|
| **Plugin Manager** | Complete (~1,500 lines) | `packages/backend/src/services/plugin-manager.ts` |
| **Zod Schemas** | Complete | `packages/shared/src/schemas/plugin.ts` |
| **Database (plugins table)** | Complete | `packages/backend/src/db/migrations/system/006_plugins.sql` |
| **Plugin Store (DB)** | Complete | `packages/backend/src/db/stores/plugin-store.ts` |
| **tRPC API** | Complete (list, get, install, uninstall, enable, disable, getConfig, setConfig, validatePath) | `packages/backend/src/api/routers/plugins.ts` |
| **Frontend UI** | Complete (list, detail, configure, install, enable/disable) | `packages/frontend/src/pages/SettingsPage.tsx` |
| **Skills** | Complete (symlink deployment, collision detection, provider switching) | Plugin Manager |
| **MCP Tools** | Complete (namespacing, `${config.*}` resolution, SDK merge) | Plugin Manager |
| **Context Sources** | Complete (static + retrieval) | Plugin Manager |
| **Hooks** | Complete (10 events, blocking/non-blocking, timeout management) | Plugin Manager |
| **Decision Types** | Complete (registration, schema validation, contact tier enforcement, handler execution) | Plugin Manager |
| **Triggers** | Complete (HTTP routes, watcher processes) | Plugin Manager |
| **Agents** | Complete (template loading, catalog) | Plugin Manager |
| **Configuration** | Complete (AES-256-GCM encryption, dynamic forms, masked frontend display) | Plugin Manager + Encryption Service |
| **Credential Manifest** | Complete (injected into mind context) | Plugin Manager |
| **Hot-swap** | Complete (EventBus `plugin:changed`, session invalidation) | Plugin Manager + Heartbeat |
| **`run_with_credentials`** | Complete (subprocess credential injection, provider key stripping) | `packages/backend/src/tools/handlers/run-with-credentials.ts` |

### First-Party Plugins Shipped

Four reference plugins demonstrate the full spectrum of plugin patterns:

| Plugin | Pattern | Components | Requires Config |
|--------|---------|------------|-----------------|
| **Weather** | Pure skill (CLI docs) | 1 skill | No |
| **Agent Browser** | Pure skill (CLI docs) | 1 skill | No |
| **Nano Banana Pro** | Skill + bundled script + credentials | 1 skill, 1 script | Yes (API key) |
| **Home Assistant** | Skill + MCP + credentials | 1 skill, 1 MCP server | Yes (URL + token) |

### Not Yet Implemented

| Feature | Priority | Notes |
|---------|----------|-------|
| **Plugin store API** | Future | Browse/install from remote marketplace |
| **AI self-installation** | Future | `browse_plugins` / `install_plugin` MCP tools |
| **Git/npm source install** | Low | Local path registration works; git/npm is convenience |
| **Watcher tick enqueue** | Low | Watcher processes spawn but don't enqueue heartbeat ticks yet (TODO in code) |
| **Container isolation** | Future | Docker-based sandbox for untrusted plugins |
| **Dependency resolution** | Future | Check `dependencies.plugins` at install time |

## Plugin Gallery: Real-World Examples

These four plugins ship in the `/plugins/` directory as reference implementations. They demonstrate the skills-first philosophy in practice — ordered from simplest to most complex.

### Weather (Pure Skill — Zero Infrastructure)

The simplest possible plugin. A single SKILL.md that teaches the agent to use `curl` against free weather APIs.

```
plugins/weather/
├── plugin.json          # Manifest: just a skill, no config needed
├── icon.svg
└── skills/
    └── weather/
        └── SKILL.md     # Teaches curl commands for wttr.in and Open-Meteo
```

**Why it works as a skill**: Weather data is a simple HTTP GET. The agent already knows `curl`. The SKILL.md documents the URL patterns and format codes — that's all the agent needs. An MCP server for this would add thousands of tokens of tool schema for the same result.

**Token cost**: ~200 tokens for the skill metadata + full instructions. An equivalent MCP server would consume ~3,000+ tokens for tool definitions.

### Agent Browser (Pure Skill — External CLI Docs)

Teaches the agent to use the `agent-browser` CLI tool for browser automation. The tool is installed globally (`npm install -g agent-browser`), and the skill is pure documentation.

```
plugins/agent-browser/
├── plugin.json
├── icon.svg
└── skills/
    └── agent-browser/
        ├── SKILL.md          # Core workflow: open → snapshot → interact → re-snapshot
        ├── references/       # Deep-dive docs loaded on demand
        │   ├── commands.md
        │   ├── snapshot-refs.md
        │   ├── session-management.md
        │   └── ...
        └── templates/        # Ready-to-use shell scripts
            ├── form-automation.sh
            └── ...
```

**Why it works as a skill**: This is the blog-post pattern in action. Instead of an MCP server with tools like `browser_navigate`, `browser_click`, `browser_screenshot` (each consuming context tokens for schemas), the skill teaches the agent shell commands: `agent-browser open <url>`, `agent-browser click @e1`. The agent composes commands naturally through Bash, and only the output enters the context window.

**Contrast with Playwright MCP**: Playwright's MCP server defines 20+ tools consuming ~14,000 tokens. The agent-browser skill achieves equivalent capability with ~800 tokens of instructions. The `references/` directory provides deep-dive docs that the SDK loads on-demand only when needed — progressive disclosure in action.

### Nano Banana Pro (Skill + Script + Credentials)

Image generation using Google's Gemini 3 Pro. A skill teaches the agent how to invoke a bundled Node.js script, and credentials are handled through `run_with_credentials`.

```
plugins/nano-banana-pro/
├── plugin.json
├── config.schema.json        # Declares GEMINI_API_KEY (secret, required)
├── icon.svg
└── skills/
    └── nano-banana-pro/
        ├── SKILL.md           # Documents run_with_credentials usage
        └── scripts/
            └── generate-image.js  # Self-contained Node.js script
```

**Key pattern — `run_with_credentials`**: The SKILL.md teaches the agent to call the built-in `run_with_credentials` tool, which injects the API key as an environment variable into the script's subprocess. The agent never sees the raw API key — it only knows the credential reference (`nano-banana-pro.GEMINI_API_KEY`).

```
run_with_credentials({
  command: "node plugins/nano-banana-pro/scripts/generate-image.js --prompt \"...\"",
  credentialRef: "nano-banana-pro.GEMINI_API_KEY",
  envVar: "GEMINI_API_KEY"
})
```

**Why not MCP**: A single script with a few CLI flags is simpler than an MCP server. The credential isolation comes from `run_with_credentials`, not MCP transport. MCP would be warranted if the image generation needed persistent state (batch queues, progress tracking) — it doesn't.

### Home Assistant (Skill + MCP + Credentials)

Smart home control using Home Assistant's own MCP server. This is the one case where MCP is the right choice — HA exposes hundreds of entities through a structured API with persistent HTTP connection.

```
plugins/home-assistant/
├── plugin.json
├── config.schema.json         # HA_URL (text) + HA_ACCESS_TOKEN (secret)
├── icon.svg
├── skills/
│   └── home-assistant/
│       └── SKILL.md           # Teaches device control patterns
└── tools.json                 # MCP server definition with ${config.*}
```

**MCP config with credential resolution**:
```json
{
  "ha": {
    "type": "http",
    "url": "${config.HA_URL}/api/mcp",
    "headers": {
      "Authorization": "Bearer ${config.HA_ACCESS_TOKEN}"
    }
  }
}
```

**Why MCP here**: Home Assistant exposes 100+ device entities, each with different capabilities (lights, switches, sensors, climate, media). The HA team already built and maintains an MCP server. The persistent HTTP connection means the agent doesn't re-authenticate on every call. And the structured tool definitions let the agent discover available devices without the skill needing to enumerate them.

**The skill still matters**: Even with MCP providing the tools, the SKILL.md teaches the agent *how to think about* home automation — common patterns, device naming conventions, safety considerations. The MCP gives capability; the skill gives judgment.

---

## Decisions & Rationale

### Skills: Native SDK Passthrough (Not System Prompt Injection)

**Decision**: Skills use the Agent Skills SKILL.md standard and are loaded by the SDK's native progressive disclosure mechanism. The Plugin Manager deploys skills to the active provider's discovery directory.

**Rationale**: All three SDKs (Claude, Codex, OpenCode) now support the Agent Skills standard natively. Native loading provides:
- Same-turn activation (no round-trip delay)
- SDK-managed context budgeting and progressive disclosure
- Token efficiency (~100 tokens per skill for metadata, full content on-demand)
- Cross-platform compatibility (one SKILL.md works everywhere)
- Support for scripts/ and references/ directories via SDK conventions

System prompt injection was the previous approach but has critical flaws:
- Clouds the system prompt, competing for token budget with persona, memory, goals
- No progressive disclosure — all active skill content loaded upfront
- Requires Animus-specific frontmatter fields (activation, maxTokens, priority) that don't exist in the standard
- Skills can't be available for the current tick without a round-trip (the "mind self-selection" pattern required a next-tick delay)

### Skills + CLI: Complementary to MCP

**Decision**: Skills can bundle CLI tools in their `scripts/` directory. Agents run these via Bash. This is a lighter alternative to MCP for simple integrations.

**Rationale**: The agent ecosystem is converging on this pattern. Skills with scripts are ~4x more token-efficient than MCP (only script output in context, vs full JSON schemas). They're also simpler to develop — no server process, no transport configuration. MCP remains essential for credential isolation, persistent connections, and structured access control. Both can coexist in a single plugin.

### Custom Decision Types: Extending the Mind's Vocabulary

**Decision**: Plugins register custom decision types with JSON Schema payloads and command handlers. Phase 1 feature.

**Rationale**: This is what makes Animus plugins uniquely powerful. Rather than only extending what the mind knows (skills) or what tools are available (MCP), custom decision types extend what the mind can *decide to do*. A home automation plugin doesn't just give the mind information about devices — it gives it the ability to control them as a first-class decision. The EXECUTE stage handles all decisions uniformly (contact tier enforcement, hooks, logging), so custom decisions get the same safety guarantees as built-in ones.

### Custom Triggers: Extending the Heartbeat

**Decision**: Plugins can register HTTP webhook endpoints and long-running watcher processes as custom tick trigger sources. Phase 1 feature.

**Rationale**: The four built-in trigger types (interval, message, scheduled task, sub-agent completion) are insufficient for plugins that connect to external systems. A home automation plugin needs to trigger ticks when sensor values change. An email plugin needs to trigger ticks when new mail arrives. Custom triggers flow through the existing tick queue, getting the same debouncing and pipeline processing as built-in triggers.

### Store Metadata: Fully Optional

**Decision**: The `store` field in plugin.json is fully optional. Omit entirely for local and built-in plugins. Required only for future store submissions.

**Rationale**: The store is a far-future concern. Built-in plugins and local development plugins should not carry dead metadata. The schema supports it when needed, but it's not shown in examples or expected for v1 plugins.

### MCP Transport: stdio for Local, Streamable HTTP for Remote

**Decision**: Plugin MCP servers use stdio transport. Future remote/hosted servers use Streamable HTTP.

**Rationale**: stdio is universally supported by all three SDKs, recommended by the MCP spec for local tools, and requires no port management, auth, or network configuration. Streamable HTTP (which replaced deprecated SSE in the Nov 2025 spec) is now universally supported for remote servers by all three SDKs.

### Hot-Swap: No Engine Restart Required

**Decision**: Plugins can be installed, enabled, disabled, and uninstalled at runtime. The `plugin:changed` EventBus event forces session invalidation so the next tick starts cold.

**Rationale**: The heartbeat architecture naturally supports hot-swapping because each tick creates discrete agent sessions. Skills, decision types, and context sources take effect on the next tick. Hooks, triggers, and MCP servers take effect immediately. The only complication is warm sessions (message ticks reusing conversation context) — session invalidation solves this by forcing a cold start after any plugin change. OpenCode's memoized skill cache requires adapter reinitialization, which we control. Running sub-agents are not interrupted — they complete with their existing capabilities, and new sub-agents get the updated state.

### Plugin Configuration: Channels Pattern

**Decision**: Plugins declare a `configSchema` (JSON Schema) in their manifest. The Settings UI renders dynamic forms from the schema. Sensitive fields are encrypted using the Encryption Service, stored as an encrypted JSON blob in `system.db`.

**Rationale**: This is the same pattern used for channel configuration (SMS credentials, Discord bot tokens). Plugins that connect to external services (Home Assistant, email, calendar) need API keys and URLs. The channels system proved this pattern works: typed schemas for validation, encrypted storage for security, dynamic UI forms for usability.

### Plugin Updates: Manual for Now

**Decision**: Plugin updates are manual. For git-sourced plugins, users run `git pull`. For npm-sourced, `npm update`. The plugin system reads from the registered path, so updating the files IS the update. The version in the manifest is for display/tracking only.

**Rationale**: Auto-update is a Phase 5+ concern (store infrastructure). For now, the architecture naturally supports manual updates because local-path plugins point directly at the source directory. Changing the files on disk and letting the next tick pick up the changes is simple and sufficient.

### Decision Type Names: No Namespacing, Collision Rejected at Install

**Decision**: Decision type names are not namespaced. Collisions are rejected at install time. Plugin authors choose descriptive names.

**Rationale**: Unlike MCP tools (which are namespaced as `{plugin}__{tool}`), decision types appear directly in the mind's structured output. `control_device` is cleaner than `home-assistant__control_device` in LLM output. Since plugin names are unique (DB primary key), collisions only happen when two different plugins define the same decision type name — which is caught and rejected during installation.

### Skill vs Agent Boundary

**Decision**: Clear — **skills are knowledge, agents are delegation**. If it needs its own session and tools, it's an agent. If it's instructions the mind follows inline, it's a skill.

### Plugin Isolation

**Decision**: Basic process isolation via external MCP servers, shell command hooks/handlers, and managed watcher processes. No sandboxing initially. Add container isolation if/when untrusted third-party plugins are supported via the store.

---

## References

### Internal Docs
- `docs/agents/plugin-extension-systems.md` — Original research (retained for reference)
- `docs/architecture/heartbeat.md` — Pipeline integration points
- `docs/architecture/context-builder.md` — Context assembly, token budgets
- `docs/architecture/agent-orchestration.md` — Sub-agent spawning, MCP forwarding
- `docs/architecture/mcp-tools.md` — 5-layer tool architecture, registry pattern
- `docs/architecture/channel-packages.md` — Channel system architecture, config pattern (encrypted config, typed schemas, dynamic UI forms)
- `docs/agents/architecture-overview.md` — Adapter interface, session lifecycle

### External References
- [Agent Skills — agentskills.io](https://agentskills.io/home) (cross-vendor standard)
- [Agent Skills Specification](https://agentskills.io/specification)
- [MCP Specification (Jun 2025)](https://modelcontextprotocol.io/specification/2025-06-18)
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Codex Skills](https://developers.openai.com/codex/skills)
- [OpenCode Skills](https://opencode.ai/docs/skills)
- [Codex SDK](https://developers.openai.com/codex/sdk/)
- [OpenCode Plugins](https://opencode.ai/docs/plugins/)
- [Oracle Agent Spec](https://github.com/oracle/agent-spec)
- [ACI.dev — Dynamic Tool Discovery](https://github.com/aipotheosis-labs/aci)
- [Semantic Kernel Plugins](https://learn.microsoft.com/en-us/semantic-kernel/concepts/plugins/)
- [Agentic AI Foundation (AAIF)](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- [Goose Agent Framework](https://github.com/block/goose)
- [The System Skill Pattern](https://www.shruggingface.com/blog/the-system-skill-pattern)
- [Skills vs MCP — LlamaIndex](https://www.llamaindex.ai/blog/skills-vs-mcp-tools-for-agents-when-to-use-what)
- [Did Skills Kill MCP? — Goose Blog](https://block.github.io/goose/blog/2025/12/22/agent-skills-vs-mcp/)

---

*Architecture v3: 2026-02-14 — Added hot-swap lifecycle, session invalidation, plugin sources & installation, monorepo layout, dynamic configuration (channels pattern), provider switching, handler timeouts, script dependencies, decision name collisions*

*Architecture v4: 2026-02-15 — Marked as implemented. Added Skills-First Philosophy section (token efficiency, composability, self-modification principles). Replaced implementation plan with implementation status table. Added Plugin Gallery with real-world examples (weather, agent-browser, nano-banana-pro, home-assistant) demonstrating the skills-first gradient. See also: `.claude/skills/build-plugin/` for a practical plugin-building skill.*
