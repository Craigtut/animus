# Cortex Built-in Tools

> **STATUS: RESEARCH** - Not yet implemented.

Built-in tools that ship with `@animus-labs/cortex`. These are general-purpose tools any agent needs regardless of its application. Application-specific tools (Animus mind tools, cognitive tools, etc.) are registered by the consumer, not built into cortex.

## Tool Tiers

### P0: Core (ship in foundation phase)

| Tool | Description |
|------|-------------|
| [Bash](./bash.md) | Execute shell commands |
| [Read](./read.md) | Read file contents |
| [Write](./write.md) | Create or overwrite files |
| [Edit](./edit.md) | Make precise edits to existing files |
| [Glob](./glob.md) | Find files by pattern |
| [Grep](./grep.md) | Search file contents with regex (ripgrep) |
| [WebFetch](./web-fetch.md) | Fetch and parse web content |

### P1: Important (ship shortly after foundation)

| Tool | Description | Notes |
|------|-------------|-------|
| [SubAgent](./sub-agent.md) | Spawn cortex-based sub-agents | Cortex sub-agents with restricted tool sets |

### P3: Future (deferred)

| Tool | Description | Notes |
|------|-------------|-------|
| WebSearch | Search the web | Needs a search backend (Brave API, SearXNG, etc.) |
| Claude/Codex SubAgent | Spawn sub-agents via existing `@animus-labs/agents` | Bridge to subprocess-based SDKs |

### Not in cortex (consumer's responsibility)

- Animus mind tools (send_message, read_memory, lookup_contacts, etc.)
- Cognitive tools (record_thought, record_cognitive_state)
