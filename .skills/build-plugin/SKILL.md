---
name: build-plugin
description: Build Animus plugins. Use when asked to create a new plugin, add a skill, integrate an external service, add MCP tools, or extend Animus capabilities. Covers plugin structure, SKILL.md authoring, credentials, MCP servers, and the skills-first philosophy.
allowed-tools: Read Write Edit Bash Glob Grep
---

# Building Animus Plugins

## Philosophy: Skills First, MCP When Needed

Animus plugins take an opinionated stance: **teach agents to use tools, don't wrap tools for agents.**

Agents already know Bash, CLI tools, stdout, pipes, and exit codes. The most natural way to give an agent a new capability is: write a script, document it in a SKILL.md, let the agent run it.

- **Token efficiency**: A SKILL.md uses ~500 tokens of instructions. An equivalent MCP server consumes 13,000-18,000 tokens in tool schemas.
- **Composability**: CLI scripts pipe, chain, and redirect naturally. MCP results pass through context one at a time.
- **Self-modification**: An agent that uses scripts can create new tools. An agent dependent on MCP servers cannot extend itself.

**Use MCP only when**: credential isolation via transport is needed, persistent connections are required (WebSocket, DB pools), you need structured access control, or a third-party already publishes an MCP server.

## The Plugin Gradient

| Level | Pattern | When to Use | Example |
|-------|---------|-------------|---------|
| **1. Pure Skill** | SKILL.md documenting existing CLI tools or APIs | Teaching the agent to use something that already exists | Weather (curl + free APIs) |
| **2. Skill + Scripts** | SKILL.md + bundled scripts in `scripts/` | Agent needs a custom CLI tool that doesn't exist yet | Agent Browser |
| **3. Skill + Script + Credentials** | Level 2 + `run_with_credentials` for secret injection | Script needs API keys the agent shouldn't see | Nano Banana Pro (Gemini API) |
| **4. Skill + MCP** | SKILL.md for knowledge + MCP server for structured tools | Persistent connections, hundreds of entities, or third-party MCP server | Home Assistant |
| **5. Full Plugin** | All component types (skills, MCP, hooks, decisions, triggers, agents) | Complex integrations with custom actions and external events | See [references/advanced-components.md](references/advanced-components.md) |

**Start at Level 1. Move up only when a lower level can't solve the problem.**

```
Does the agent need to interact with an external system?
+-- No --> Level 1: Pure skill with instructions
+-- Yes
    +-- Can it be done with existing CLI tools (curl, git, docker, etc.)?
    |   +-- Yes --> Level 1: Skill documenting CLI usage
    |   +-- No --> Does it need a custom script?
    |       +-- Yes --> Does the script need credentials?
    |       |   +-- No --> Level 2: Skill + scripts
    |       |   +-- Yes --> Level 3: Skill + scripts + run_with_credentials
    |       +-- No --> Does it need persistent connections or hundreds of tools?
    |           +-- Yes --> Level 4: Skill + MCP
    |           +-- No --> Level 2: Skill + scripts
```

## Plugin File Structure

```
my-plugin/
+-- plugin.json                    # Required: manifest
+-- config.schema.json             # Optional: config form definition
+-- icon.svg                       # Optional: plugin icon (256x256)
+-- skills/                        # Optional: knowledge injection
|   +-- my-skill/
|       +-- SKILL.md               # Agent Skills standard format
|       +-- scripts/               # Optional: bundled CLI tools
|       |   +-- my-script.js
|       +-- references/            # Optional: deep-dive docs (loaded on demand)
|           +-- advanced.md
+-- tools/                         # Optional: MCP servers
|   +-- mcp.json                   # MCP server definitions
|   +-- servers/                   # Bundled server code
+-- context/                       # Optional: dynamic context providers
|   +-- context.json
+-- hooks/                         # Optional: lifecycle interceptors
|   +-- hooks.json
+-- decisions/                     # Optional: custom decision types
|   +-- decisions.json
+-- triggers/                      # Optional: custom tick triggers
|   +-- triggers.json
+-- agents/                        # Optional: sub-agent templates
    +-- my-agent.md
```

## Step-by-Step: Building a Plugin

### 1. Create the Directory

```bash
mkdir -p plugins/my-plugin/skills/my-plugin
```

### 2. Write the Manifest (`plugin.json`)

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "version": "1.0.0",
  "description": "What this plugin does (max 200 chars)",
  "author": { "name": "author-name" },
  "license": "MIT",
  "components": {
    "skills": "./skills/"
  },
  "permissions": {
    "network": true
  }
}
```

**Manifest rules:**
- `name`: Lowercase alphanumeric + hyphens only (`^[a-z0-9-]+$`). Used as unique ID and namespace.
- `description`: Max 200 chars. Shown in store listings and plugin catalog.
- `components`: Only include the component types your plugin uses. Omit the rest.
- `permissions`: Declare what the plugin needs. Shown to user before installation.
- Omit `configSchema` if no config is needed. Omit `permissions` if none required.

### 3. Write the Skill (`skills/my-plugin/SKILL.md`)

```markdown
---
name: my-plugin
description: >
  What this skill does and when to use it. Include trigger phrases the user
  might say. Max 1024 chars. This is used by the SDK to decide when to load
  the full skill content.
allowed-tools: Bash
---

# My Plugin

## When to Use

Use this skill when the user asks about [topic].

## Core Commands

[Document complete, copy-pasteable commands with example output]
```

**SKILL.md rules:**
- Frontmatter `name` MUST match parent directory name exactly
- `description` is critical: the SDK uses it for task-matching to decide when to load the skill
- Include trigger words/phrases in the description
- `allowed-tools`: Space-delimited list of tools the skill needs (e.g., `Bash Read Write`)
- Body: Write as if teaching a colleague. Include complete commands with expected output.
- Use `references/` for deep-dive docs. The SDK loads the main SKILL.md first, references on demand.

### 4. Install and Test

Install via Settings > Plugins > Add Plugin > Local Path, entering the absolute path.

Or if building within the Animus monorepo, plugins in the `/plugins/` directory are auto-discovered at startup.

## Adding Credentials (Level 3)

### Config Schema

Create `config.schema.json`:

```json
{
  "fields": [
    {
      "key": "API_KEY",
      "label": "Service API Key",
      "type": "secret",
      "required": true,
      "helpText": "Where to get this key (e.g., https://example.com/settings/api)"
    },
    {
      "key": "BASE_URL",
      "label": "API Base URL",
      "type": "text",
      "required": false,
      "placeholder": "https://api.example.com",
      "helpText": "Override the default API endpoint"
    }
  ]
}
```

Reference it in `plugin.json`: `"configSchema": "./config.schema.json"`

**Field types:**

| Type | Renders As | Notes |
|------|-----------|-------|
| `text` | Text input | General string |
| `secret` | Password input (masked) | Encrypted at rest (AES-256-GCM), masked in UI |
| `url` | URL input | Validates URL format |
| `number` | Numeric input | Optional `min`/`max` |
| `select` | Dropdown | Requires `options`: `[{ "value": "...", "label": "..." }]` |
| `text-list` | Multi-value input | Comma-separated or tags |
| `toggle` | Toggle switch | Boolean |

**Field properties:** `key` (env var name), `label`, `type`, `required`, `placeholder`, `helpText`, `validation` (regex), `options` (for select), `default`, `min`/`max` (for number).

Plugins with required config fields are installed as "unconfigured" and cannot be enabled until the user fills them in via Settings.

### Using Credentials: `run_with_credentials`

In your SKILL.md, teach the agent to use `run_with_credentials`:

```
run_with_credentials({
  command: "node plugins/my-plugin/scripts/my-script.js --query \"...\""
  credentialRef: "my-plugin.API_KEY",
  envVar: "API_KEY"
})
```

This tool:
1. Looks up `my-plugin.API_KEY` from the plugin's encrypted config
2. Injects it as `$API_KEY` in the subprocess environment
3. Strips agent provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) from the child env
4. Runs the command and returns stdout/stderr
5. The agent never sees the raw credential value

### Using Credentials: MCP `${config.*}` Resolution

For MCP server configs, credentials are injected via placeholder resolution at runtime:

```json
{
  "my-api": {
    "type": "http",
    "url": "${config.BASE_URL}/api/mcp",
    "headers": {
      "Authorization": "Bearer ${config.API_KEY}"
    }
  }
}
```

The Plugin Manager replaces `${config.*}` with decrypted values when the MCP server is started.

### Credential Manifest

The Plugin Manager automatically builds a credential manifest listing all secret fields across enabled plugins. This is injected into the mind's context so the agent knows what credentials are available:

```
Available credentials:
- my-plugin.API_KEY (Service API Key) -- ...x4f2
- nano-banana-pro.GEMINI_API_KEY (Gemini API Key) -- ...a1b2
```

The agent uses this to construct the `credentialRef` for `run_with_credentials`.

## Adding MCP Tools (Level 4)

### Bundled MCP Server (stdio)

Create `tools/mcp.json`:

```json
{
  "my-server": {
    "command": "node",
    "args": ["${PLUGIN_ROOT}/tools/servers/my-server.js"],
    "env": {
      "API_KEY": "${config.API_KEY}"
    },
    "description": "Description of what these tools do"
  }
}
```

Update `plugin.json`: add `"tools": "./tools/mcp.json"` to `components`.

- `${PLUGIN_ROOT}` is substituted with the plugin's absolute path at load time.
- `${config.*}` is substituted with decrypted config values at runtime.
- MCP servers are namespaced: tools appear as `my-plugin__my-server__tool_name`.

### Remote MCP Server (HTTP)

For third-party MCP servers:

```json
{
  "external": {
    "type": "http",
    "url": "${config.SERVICE_URL}/api/mcp",
    "headers": {
      "Authorization": "Bearer ${config.ACCESS_TOKEN}"
    },
    "description": "External service MCP server"
  }
}
```

### When NOT to Use MCP

- A `curl` command would suffice (use a skill)
- You're wrapping a CLI tool (teach the agent to use it directly)
- The integration is a single API call (use a script with `run_with_credentials`)
- You'd be creating an MCP server with 1-2 tools (schema overhead isn't worth it)

## Writing Good Skills

1. **Description is everything.** The SDK matches the `description` to decide when to load. Include trigger phrases: "Use when the user asks about weather, forecasts, temperature, or climate" > "Weather data."

2. **Show, don't tell.** Include complete, copy-pasteable commands with example output. The agent should never need to guess.

3. **Document output formats.** Tell the agent what shape data comes back in so it can parse results.

4. **Use `references/` for depth.** Keep the main SKILL.md focused on the 80% case. Edge cases, advanced usage, and API details go in `references/` files loaded on demand by the SDK.

5. **Include error handling.** Document what happens when commands fail and how to recover.

6. **Document for agents.** SKILL.md is read by AI agents, not just humans. Be explicit, unambiguous, include complete examples.

## Writing Good Scripts

1. **Self-contained.** No external `node_modules`. Use Node.js built-ins, or bundle dependencies with esbuild. Or use `npx`/`bunx` for runtime auto-install.
2. **CLI interface.** Clear `--flag value` arguments. The agent constructs the command string.
3. **Stdout for output, stderr for errors.** The agent reads stdout.
4. **Exit codes matter.** Zero for success, non-zero for failure.
5. **No interactive prompts.** The agent can't respond to stdin.

## Testing Your Plugin

1. Install via Settings > Plugins > Add Plugin > Local Path
2. Check status: "Active" means ready; "Needs Configuration" means fill in config first
3. Verify skills deployed: `ls -la .claude/skills/` (for Claude provider)
4. Send a message that should trigger your skill
5. Check the Mind page to see if the skill was invoked

**Common issues:**

| Problem | Cause | Fix |
|---------|-------|-----|
| "Needs Configuration" | Required config fields not filled | Settings > Plugins > Configure |
| Skill not loading | Name mismatch | SKILL.md frontmatter `name` must match parent directory name |
| MCP server not starting | Bad command path | Check `${PLUGIN_ROOT}` resolution |
| Credentials not injecting | Wrong `credentialRef` format | Must be `plugin-name.CONFIG_KEY` (dot-separated) |
| Plugin not appearing | Invalid `plugin.json` | Name must be `^[a-z0-9-]+$`, description max 200 chars |

## Real-World Examples

Study these in the `/plugins/` directory:

- **`plugins/weather/`** -- Level 1: Pure skill. SKILL.md teaches `curl` against free APIs. Zero config.
- **`plugins/agent-browser/`** -- Level 2: Pure skill. Documents the `agent-browser` CLI with references/ for deep dives.
- **`plugins/nano-banana-pro/`** -- Level 3: Skill + script + credentials. Uses `run_with_credentials` for Gemini API key.
- **`plugins/home-assistant/`** -- Level 4: Skill + MCP. Uses HA's own HTTP MCP server with `${config.*}` credential resolution.

## Quick Reference: plugin.json

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "version": "1.0.0",
  "description": "What this plugin does (max 200 chars)",
  "author": { "name": "author-name" },
  "license": "MIT",
  "components": {
    "skills": "./skills/",
    "tools": "./tools/mcp.json",
    "context": "./context/context.json",
    "hooks": "./hooks/hooks.json",
    "decisions": "./decisions/decisions.json",
    "triggers": "./triggers/triggers.json",
    "agents": "./agents/"
  },
  "permissions": {
    "tools": ["Bash", "Read"],
    "network": true,
    "filesystem": "read-only"
  },
  "configSchema": "./config.schema.json"
}
```

Omit any `components` field your plugin doesn't use.

For advanced components (decision types, hooks, triggers, agents, context sources), see [references/advanced-components.md](references/advanced-components.md).

For full architecture details, see `docs/architecture/plugin-system.md`.
