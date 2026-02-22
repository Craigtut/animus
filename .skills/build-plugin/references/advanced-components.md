# Advanced Plugin Components

These components are for Level 5 plugins that need to extend the heartbeat pipeline itself. Most plugins only need skills and optionally MCP tools. Read this when you need decision types, hooks, triggers, agents, or context sources.

## Decision Types — Extending What the Mind Can Do

Decision types extend the mind's vocabulary of actions. When the mind outputs decisions during a tick, it can include your custom types alongside built-in ones like `send_message` and `spawn_agent`.

### Definition

Create `decisions/decisions.json`:

```json
{
  "types": [
    {
      "name": "create_github_issue",
      "description": "Create an issue on a GitHub repository",
      "payloadSchema": {
        "type": "object",
        "properties": {
          "owner": { "type": "string", "description": "Repository owner" },
          "repo": { "type": "string", "description": "Repository name" },
          "title": { "type": "string", "description": "Issue title" },
          "body": { "type": "string", "description": "Issue body (markdown)" },
          "labels": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["owner", "repo", "title"]
      },
      "handler": {
        "type": "command",
        "command": "${PLUGIN_ROOT}/handlers/create-issue.sh"
      },
      "contactTier": "primary"
    }
  ]
}
```

Add to `plugin.json`: `"decisions": "./decisions/decisions.json"` in `components`.

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique across all plugins. Lowercase + underscores (`^[a-z0-9_]+$`). |
| `description` | Yes | Shown to the mind in operational instructions (max 500 chars). |
| `payloadSchema` | Yes | JSON Schema for the decision's payload. |
| `handler.type` | Yes | Always `"command"`. |
| `handler.command` | Yes | Shell command. `${PLUGIN_ROOT}` substituted at runtime. |
| `contactTier` | No | Minimum tier: `"primary"` (default) or `"standard"`. |

### Handler Protocol

Handler receives JSON on stdin:
```json
{
  "event": { "owner": "...", "repo": "...", "title": "..." },
  "config": { "GITHUB_TOKEN": "decrypted-value" }
}
```

Handler returns JSON on stdout:
```json
{ "success": true, "result": { "issueUrl": "..." } }
```

Or on failure:
```json
{ "success": false, "error": "Human-readable error" }
```

Non-zero exit code = failure regardless of stdout. Timeout: 30 seconds.

### How It Works

1. Context Builder injects decision descriptions into the mind's operational instructions
2. Mind outputs a decision with your type name and payload
3. EXECUTE stage validates contact tier, validates payload against schema
4. `preDecision` hooks fire (can block)
5. Handler subprocess runs with payload + decrypted config via stdin
6. Result logged in `tick_decisions` table
7. `postDecision` hooks fire

Decision names are NOT namespaced (unlike MCP tools) because they appear directly in LLM output. Collisions are rejected at install time.

---

## Hooks — Lifecycle Interceptors

Hooks intercept events in the heartbeat pipeline. They run as shell commands in separate processes.

### Definition

Create `hooks/hooks.json`:

```json
{
  "hooks": [
    {
      "event": "preMessage",
      "handler": {
        "type": "command",
        "command": "${PLUGIN_ROOT}/hooks/check-message.sh"
      }
    },
    {
      "event": "postTick",
      "handler": {
        "type": "command",
        "command": "${PLUGIN_ROOT}/hooks/log-tick.sh"
      }
    }
  ]
}
```

Add to `plugin.json`: `"hooks": "./hooks/hooks.json"` in `components`.

### Available Events

| Event | Blocking | Timeout | Receives |
|-------|----------|---------|----------|
| `preTick` | Yes | 10s | Trigger context, contact info |
| `postTick` | No | 30s | Tick result summary |
| `preDecision` | Yes | 10s | Decision object |
| `postDecision` | No | 30s | Decision + outcome |
| `preSubAgent` | Yes | 10s | Agent config, task description |
| `postSubAgent` | No | 30s | Agent result |
| `preMessage` | Yes | 10s | Message content, channel, contact |
| `postMessage` | No | 30s | Delivery confirmation |
| `onPluginInstall` | No | 30s | Plugin manifest |
| `onPluginRemove` | No | 30s | Plugin name |

### Handler Protocol

Same stdin/stdout JSON protocol as decision handlers.

**Blocking hooks** (`pre*`): Run sequentially. Return `{ "success": false }` to veto the operation. Timeout = treat as "allow".

**Non-blocking hooks** (`post*`): Run in parallel. Fire-and-forget. Failures are logged but don't affect the pipeline.

### Matcher (Optional)

Hooks can filter which events they handle:

```json
{
  "event": "preDecision",
  "matcher": { "type": "send_message" },
  "handler": { "type": "command", "command": "..." }
}
```

This hook only fires for `send_message` decisions, ignoring others.

---

## Triggers — Custom Tick Sources

Triggers give the heartbeat new reasons to tick beyond the built-in four (interval timer, message received, scheduled task, sub-agent completion).

### Definition

Create `triggers/triggers.json`:

```json
{
  "triggers": [
    {
      "name": "webhook",
      "description": "Fires when an HTTP webhook is received",
      "type": "http",
      "config": {
        "path": "/webhooks/my-plugin",
        "methods": ["POST"]
      }
    },
    {
      "name": "file-watcher",
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

Add to `plugin.json`: `"triggers": "./triggers/triggers.json"` in `components`.

### Trigger Types

**HTTP** (`type: "http"`): Registers a Fastify route at the specified path. External services POST events to it. The path is auto-namespaced under `/webhooks/`.

**Watcher** (`type: "watcher"`): Spawns a long-running subprocess. Events are emitted as JSON lines on stdout. On crash, auto-restarts with exponential backoff (1s, 2s, 4s... up to 60s max). After 5 consecutive failures, marked as failed.

### How Triggers Flow

1. External event arrives (HTTP POST or watcher stdout)
2. Plugin Manager creates a trigger context object
3. Heartbeat tick enqueued with plugin trigger context
4. Tick processes through normal pipeline: GATHER -> MIND -> EXECUTE
5. Mind sees the trigger context and responds

---

## Context Sources — Dynamic Data Providers

Context sources inject dynamic data into the mind's system prompt each tick. Unlike skills (instructions loaded by the SDK on demand), context sources are Animus-managed information evaluated fresh per tick.

### Definition

Create `context/context.json`:

```json
{
  "sources": [
    {
      "name": "team-conventions",
      "description": "Team coding conventions and style guide",
      "type": "static",
      "maxTokens": 1500,
      "priority": 6,
      "content": "${PLUGIN_ROOT}/data/conventions.md"
    },
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
    }
  ]
}
```

Add to `plugin.json`: `"context": "./context/context.json"` in `components`.

### Source Types

**Static** (`type: "static"`): Content loaded from file at startup and cached. Good for reference data that doesn't change.

**Retrieval** (`type: "retrieval"`): Provider process runs per tick. Receives tick context via stdin, returns relevant content via stdout. Good for data that changes or depends on what the mind is currently doing.

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Source identifier |
| `description` | Yes | What this source provides (max 200 chars) |
| `type` | Yes | `"static"` or `"retrieval"` |
| `maxTokens` | Yes | Token budget cap for this source |
| `priority` | No | 1-10 (default 5). Higher priority sources kept when budget is tight. |
| `content` | For static | Path to content file |
| `provider.command` | For retrieval | Command to run |
| `provider.args` | For retrieval | Command arguments |

Context sources compete for an overall plugin context budget (~15% of context window). Lower-priority sources are dropped first when over budget.

---

## Agents — Sub-Agent Templates

Agent definitions provide prompt templates for specialized sub-agents that the mind can delegate work to.

### Definition

Create `agents/my-agent.md`:

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

## Review Process

1. Identify all entry points (API endpoints, user inputs)
2. Trace data flow from input to output
3. Check for missing validation or encoding
4. Review auth logic
5. Check for hardcoded secrets
```

Add to `plugin.json`: `"agents": "./agents/"` in `components`.

### Frontmatter

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Agent name, used by mind for delegation |
| `description` | Yes | Shown in agent catalog (max 200 chars) |
| `tools` | No | SDK-native tools needed (read, write, bash, etc.) |
| `maxTurns` | No | Maximum turns for this agent type |

The orchestrator merges the Animus personality prompt with the agent's instructions when creating a session.

---

## Plugin Lifecycle Timing

Understanding when components take effect after install/enable:

| Component | When Active | Mechanism |
|-----------|-------------|-----------|
| **Skills** | Next tick (cold session) | Symlinks deployed to SDK discovery path |
| **MCP Tools** | Immediate start, mind access next tick | MCP server process starts immediately |
| **Context Sources** | Next tick | Context Builder evaluates fresh each tick |
| **Hooks** | Immediately | Event listeners registered on EventBus |
| **Decision Types** | Next tick (cold session) | Registered in Plugin Manager, included by Context Builder |
| **Triggers** | Immediately | HTTP routes registered, watcher processes started |
| **Agents** | Next tick | Agent catalog refreshed |

All plugin changes emit `plugin:changed` on the EventBus, forcing the next tick to start a cold session (no warm session reuse).

---

For complete architecture details, see `docs/architecture/plugin-system.md`.
