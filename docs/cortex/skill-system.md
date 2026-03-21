# Skill System

> **STATUS: RESEARCH** - Not yet implemented.

How Cortex discovers, loads, and injects skill content into the agent's context. Skills are SKILL.md files that teach the agent how to perform specific tasks or follow specific guidelines. They are loaded on demand (not all at once) and injected into ephemeral context to keep conversation history clean.

## Overview

Pi-agent-core has no concept of skills. Cortex implements a full skill system with three core capabilities:

1. **Progressive disclosure**: Only skill names and descriptions are in context at startup (~100 tokens per skill). Full skill content loads on demand.
2. **Ephemeral injection**: Loaded skill content lives in the ephemeral context region, not in conversation history. It persists for the duration of the current agentic loop, then disappears on the next tick.
3. **Dynamic context injection**: Skills can contain preprocessor markers that execute shell commands or JavaScript scripts at load time, replacing markers with live runtime data before the agent sees the content.

## Architecture

```
SkillRegistry
├── Skill index (name, description, path, source, frontmatter)
├── addSkill() / removeSkill() for dynamic lifecycle
└── getAvailableSkillsSummary() for tool description

load_skill AgentTool
├── Registered on pi-agent-core Agent
├── Description contains available skills list from registry
├── execute(): reads body, runs preprocessor, pushes to skillBuffer
└── Returns short confirmation pointing agent to ephemeral section

SkillPreprocessor
├── Shell command execution: !`command`
├── Script execution: !{script: path.js}
└── Variable substitution: ${VARIABLE}

Ephemeral Injection (via transformContext)
├── skillBuffer[] contents appended to ephemeral region
├── Rebuilt every transformContext call within a loop
└── Cleared at the start of each new tick
```

## SKILL.md Format

Cortex follows the open [Agent Skills specification](https://agentskills.io/specification) with Cortex-specific extensions in the frontmatter.

### Open Standard Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Max 64 chars, kebab-case (lowercase, hyphens, numbers) |
| `description` | Yes | Max 1024 chars (200 recommended for reliable activation). This is what the agent reads to decide whether to load a skill. |
| `allowed-tools` | No | Space-delimited tool names or glob patterns. Experimental. See note below. |
| `license` | No | License name or file reference |
| `compatibility` | No | Max 500 chars, environment requirements |
| `metadata` | No | Arbitrary key-value map (author, version, etc.) |

**Note on `allowed-tools`:** In Claude Code, this field hard-restricts which tools are sent to the API when a skill is active (reducing context size). In Cortex, skills inject into an existing agentic loop where all tools are already registered. Restricting tools mid-loop after a skill loads would be complex and behaviorally surprising. This field is **stored in frontmatter but not enforced in v1**. It becomes meaningful with sub-agent skill execution (`context: fork`), where tool restriction is natural: the sub-agent is created with only the allowed tools. Until then, `allowed-tools` serves as documentation for skill authors about which tools the skill expects to use.

### Cortex Extension Fields

These are Cortex-specific frontmatter fields, not part of the open standard:

| Field | Description |
|-------|-------------|
| `disable-model-invocation` | `true` prevents the agent from auto-loading this skill. Only the consumer or user can trigger it. Use for skills with side effects or high token cost. |
| `user-invocable` | `false` hides from any user-facing skill menu. Only the agent can load it. Use for background reference skills. |
| `model-tier` | `high`, `medium`, or `low`. Only applies to future sub-agent skill execution. See Future: Sub-Agent Skills. |
| `context` | `fork` to run in an isolated sub-agent context. See Future: Sub-Agent Skills. |

### File Structure

A skill is a directory containing a SKILL.md file and optional supporting resources:

```
skills/<skill-name>/
  SKILL.md            # Required. Frontmatter + instructions.
  scripts/            # Optional. JS or shell scripts for dynamic context injection.
  references/         # Optional. Supplementary docs the agent can Read on demand.
  assets/             # Optional. Templates, examples, binary files.
```

### Example

```yaml
---
name: discord-channel
description: >
  Guidelines and context for interacting in Discord channels. Load when
  replying to messages from Discord, managing Discord-specific formatting,
  or handling Discord features like reactions, threads, and embeds.
allowed-tools: send_message search_memories
metadata:
  author: animus-labs
  version: 1.0.0
---

## Discord Server Configuration
!{script: scripts/get-server-config.js}

## Reply Guidelines
- Use Discord markdown (bold, italic, code blocks, spoilers)
- Keep messages under 2000 characters
- Use thread replies for extended conversations
- React with emoji for simple acknowledgments instead of text replies

## Available Features
- Reactions: respond with emoji via the `react` decision type
- Threads: create or reply in threads for focused discussion
- Embeds: format rich responses when sharing structured data
```

## Skill Registry

The `SkillRegistry` manages all known skills. It does not scan directories; it receives skill configurations from the consumer.

### SkillConfig

The consumer provides skill configurations at startup and dynamically as plugins install/uninstall:

```typescript
interface SkillConfig {
  /** Absolute path to the SKILL.md file */
  path: string;
  /** Where this skill came from. Used for display and debugging. */
  source: string;  // e.g., 'plugin:weather', 'plugin:discord', 'user', 'builtin'
}
```

### SkillEntry

The registry reads each SKILL.md and builds an internal index entry:

```typescript
interface SkillEntry {
  name: string;
  description: string;
  path: string;                          // Absolute path to SKILL.md
  dir: string;                           // Absolute path to skill directory
  source: string;                        // From SkillConfig
  frontmatter: Record<string, unknown>;  // Full parsed YAML frontmatter (preserved for future use)
  modelInvocable: boolean;               // Derived from frontmatter, default true
}
```

Storing the full frontmatter ensures forward compatibility. When Cortex later supports `context: fork`, `model-tier`, or other extensions, the data is already available without re-reading files.

### API

```typescript
class SkillRegistry {
  constructor(configs: SkillConfig[]);

  /** Add a skill dynamically (e.g., on plugin install). */
  addSkill(config: SkillConfig): void;

  /** Remove a skill dynamically (e.g., on plugin uninstall). */
  removeSkill(name: string): void;

  /** Get the formatted available skills summary for the load_skill tool description. */
  getAvailableSkillsSummary(): string;

  /** Read and preprocess a skill's full body. Args are merged with consumer-provided context. */
  async getSkillBody(name: string, callArgs: { args: string[]; rawArgs: string }): Promise<string>;

  /** Get a skill entry by name. */
  getEntry(name: string): SkillEntry | null;

  /** All registered skill entries. */
  getAll(): SkillEntry[];
}
```

### Discovery

The consumer (Animus backend) resolves skill paths from all sources and provides them as a flat `SkillConfig[]`:

| Source | How Paths Are Resolved |
|--------|----------------------|
| Plugin skills | Plugin manager provides `{ name, absolutePath }` for each plugin's skills. Already exists in `LoadedPlugin.skills`. |
| User skills | Future: user-defined skill directories configured in settings. Paths resolved from settings. |
| Built-in skills | Hardcoded paths to skills bundled with the engine (e.g., `.skills/doc-explorer/`). |

The registry does not know or care where skills come from. It reads the SKILL.md at each path and builds the index. The consumer handles the resolution.

### Dynamic Lifecycle

When plugins install or uninstall, the consumer calls `addSkill()` or `removeSkill()` on the registry. This triggers:

1. The registry index updates
2. The `load_skill` tool description is rebuilt (new available skills list)
3. A system prompt rebuild is triggered (the agent needs to see the updated tool description)

This mirrors the pattern used for MCP tool lifecycle in `mcp-integration.md`: dynamic registration without session teardown.

## Skill Advertisement

The available skills list is embedded in the `load_skill` tool's description parameter, not directly in the system prompt body. This follows the Claude Code pattern where the Skill tool's description contains the available skills index.

### Format

The `getAvailableSkillsSummary()` method produces a compact listing:

```xml
<available-skills>
<skill name="discord-channel" source="plugin:discord">
Guidelines and context for interacting in Discord channels. Load when
replying to messages from Discord, managing Discord-specific formatting,
or handling Discord features like reactions, threads, and embeds.
</skill>
<skill name="doc-explorer" source="builtin">
Explore Animus project documentation. Use when you need context about
how the system works, its architecture, or design principles.
</skill>
<skill name="build-plugin" source="builtin">
Step-by-step guide for building Animus plugins. Load when creating
a new plugin or modifying plugin architecture.
</skill>
</available-skills>
```

### Token Budget

Each skill in the advertisement consumes approximately 100 tokens (name + description). The total budget for the available skills list should not exceed 2% of the model's context window (following Claude Code's approach). With a 200K context window, this allows approximately 40 skills before hitting the budget. With a 1M context window, approximately 200 skills.

**Filtering:**
- Skills with `disable-model-invocation: true` (`modelInvocable: false`) are **excluded** from the summary. The agent cannot see or auto-load them. They remain loadable via consumer pre-loading (`cortexAgent.loadSkill()`).
- If the agent somehow calls `load_skill` with a non-model-invocable skill name, the tool returns an error: `"Skill '<name>' is not available for direct loading."`

If the total exceeds the budget, skills are prioritized by source: `builtin` > `user` > `plugin`. Within each source, skills are ordered alphabetically. Skills that exceed the budget are excluded from the advertisement but remain loadable if the agent knows the name.

### Why the Tool Description, Not the System Prompt

Placing the skills list in the `load_skill` tool description rather than the system prompt has two benefits:

1. **Colocation**: The agent sees the available skills at the same place it would invoke them. This improves activation accuracy.
2. **Cache efficiency**: The system prompt remains stable. Tool descriptions change only when skills are added or removed, which also triggers a system prompt rebuild anyway (for the "Installed Plugins & Tools" section). Both change at the same time, so there is no additional cache invalidation cost.

## Skill Loading

### The load_skill Tool

A native `AgentTool` registered on the pi-agent-core Agent. This is the primary mechanism for getting skill content into context.

```typescript
const loadSkillTool: AgentTool = {
  name: 'load_skill',
  description: `Load a skill's full instructions into your active context.
Call this tool when you need detailed guidance for a specific task.
The skill's instructions will be available in your context for the
remainder of this loop.

${registry.getAvailableSkillsSummary()}`,

  parameters: Type.Object({
    name: Type.String({ description: 'The skill name to load' }),
    arguments: Type.Optional(Type.String({
      description: 'Optional arguments to pass to the skill'
    })),
  }),

  execute: async (args) => {
    const entry = registry.getEntry(args.name);
    if (!entry) {
      return { content: `Unknown skill: "${args.name}". Check available skills in the tool description.` };
    }

    // Cortex merges its built-in context with consumer-provided context
    // (see Separation of Concerns section)
    const body = await registry.getSkillBody(args.name, {
      args: args.arguments ? args.arguments.split(/\s+/) : [],
      rawArgs: args.arguments ?? '',
    });
    skillBuffer.push({ name: args.name, content: body });

    return {
      content: `Skill "${args.name}" loaded. Full instructions are now active in your context (see the skill instructions section below the conversation history). Review them before proceeding.`,
    };
  },
};
```

### The Skill Buffer

The `skillBuffer` is an array of loaded skill content maintained by the CortexAgent:

```typescript
interface LoadedSkill {
  name: string;
  content: string;  // Preprocessed SKILL.md body
}

// Maintained on CortexAgent
private skillBuffer: LoadedSkill[] = [];
```

**Lifecycle:**
- Cleared by the consumer at the start of each tick, before pre-loading skills for the new loop. Cortex cannot auto-clear because it has no concept of tick boundaries, and clearing at `prompt()` start would wipe consumer pre-loaded skills.
- Populated during the loop via `load_skill` tool calls or consumer pre-loading
- Read by `transformContext` on every LLM call within the loop
- Not persisted to conversation history or disk

**Deduplication:** If the same skill is loaded twice in one loop (by name), the second load replaces the first. The preprocessor re-runs, producing fresh dynamic content. The skillBuffer never contains two entries with the same name.

### Ephemeral Injection

Skill content is injected via a dedicated step in the `transformContext` composition chain, separate from the ContextManager's `setEphemeral()` content. This separation is necessary because:

- `setEphemeral()` is set once during GATHER and is static for the loop. The skillBuffer mutates mid-loop as the agent loads skills.
- If skills went through `setEphemeral()`, Cortex would need to rebuild the consumer's ephemeral content every time a skill loads, violating separation of concerns.

**Composition order** (Cortex composes these internally via `CortexAgent.getTransformContextHook()`):

```
transformContext fires:
  0. Tier 1 insertion cap      →  cap oversized tool results in source messages
  1. ContextManager ephemeral  →  consumer's tick context (emotions, energy, etc.)
  2. Skill buffer injection    →  loaded skill instructions
  3. Compaction                →  microcompaction + mid-loop safety valve
```

The consumer does not wire skill injection manually. They use Cortex's single composed hook:

```typescript
const agent = new Agent({
  transformContext: cortexAgent.getTransformContextHook(),
});
```

**Skill injection implementation** (internal to Cortex):

```typescript
// Step 2 of the composed transformContext
const skillContent = cortexAgent.getSkillBuffer();
if (skillContent.length > 0) {
  const formatted = skillContent.map(s =>
    `<skill-instructions name="${s.name}">\n${s.content}\n</skill-instructions>`
  ).join('\n\n');

  context.messages.push({
    role: 'user',
    content: formatted,
  });
}
```

Because `transformContext` fires before every LLM call within a loop, the skill content is available for all remaining turns after loading. When the loop ends and a new tick begins, the skillBuffer is cleared, and the skill is gone unless re-loaded.

### Skills and Pipeline Phases

The `load_skill` tool is only available during the **AGENTIC LOOP** phase (Phase 3 of the 5-phase pipeline). THOUGHT and REFLECT are direct pi-ai calls (`complete()`/`stream()`), not `agent.prompt()` calls, so they have no access to tools and no skill injection. This is by design: THOUGHT and REFLECT are structured cognitive calls that don't need task-specific skill instructions.

Consumer pre-loading (`cortexAgent.loadSkill()`) happens during GATHER (Phase 1), before any phase runs. Pre-loaded skills are in the skillBuffer when the AGENTIC LOOP starts.

### Consumer Pre-Loading

The consumer can pre-load skills during the GATHER phase, before the agentic loop starts:

```typescript
// CortexAgent API
loadSkill(name: string, args?: string): Promise<void>;
```

This calls the same path as the `load_skill` tool: reads the body, runs the preprocessor, pushes to the skillBuffer. The difference is that it's triggered by the consumer, not the agent, so no LLM turn is wasted.

**Use cases:**
- Pre-load channel-specific skills based on the message trigger's channel type
- Pre-load plugin skills when a plugin's trigger fires
- Pre-load workflow skills for scheduled tasks

The consumer decides when pre-loading is appropriate. This is an optimization path, not required. The agent can always load skills on demand via the tool.

## Dynamic Context Injection (Preprocessor)

Skills can contain preprocessor markers that execute at load time, replacing markers with live runtime data. The agent receives fully-rendered content; it never sees the markers or commands.

### Why This Matters

Without dynamic injection, skills are static instructions. The agent must spend tool calls and LLM turns gathering context that the skill author already knows is needed. Dynamic injection eliminates this overhead: the skill loads with its context already baked in.

**Example without dynamic injection:**
```
Turn 1: Agent loads "discord-channel" skill → gets static instructions
Turn 2: Agent calls bash to get server config
Turn 3: Agent calls bash to get recent messages
Turn 4: Agent starts actual work
```

**Example with dynamic injection:**
```
Turn 1: Agent loads "discord-channel" skill → gets instructions + server config + recent messages
Turn 2: Agent starts actual work
```

Two turns saved, zero reasoning tokens spent deciding what commands to run.

### Three Preprocessor Types

#### 1. Shell Commands: `` !`command` ``

Execute a shell command and replace the marker with stdout.

```markdown
## Current Git Status
!`git status --short`

## Recent Commits
!`git log --oneline -10`
```

The preprocessor identifies all `` !`...` `` patterns, executes each command, and replaces each marker with the command's stdout. Commands run with the skill's directory as the working directory.

**Error handling:** If a command fails (non-zero exit), the marker is replaced with `[Error: command failed with exit code N]`. The skill continues loading; one failed command does not block the rest.

**Timeout:** Each command has a 10-second timeout. On timeout, the marker is replaced with `[Error: command timed out]`.

**Security:** Shell commands run with the same permissions as the backend process. Plugin-authored skills that use shell commands should be reviewed during plugin installation. The consumer can optionally disable shell execution for untrusted skill sources.

#### 2. Script Execution: `!{script: path}`

Execute a JavaScript module bundled with the skill. The script runs in-process (not shelled out) and receives a structured context object.

```markdown
## Server Configuration
!{script: scripts/get-server-config.js}

## Active Channels
!{script: scripts/list-channels.js, limit: 5}
```

**Script format:**

```typescript
// skills/discord-channel/scripts/get-server-config.js
export default async function(ctx) {
  // ctx.skillDir, ctx.args, ctx.scriptArgs are from Cortex
  // Everything else is consumer-provided (see Separation of Concerns below)
  const config = ctx.pluginConfig;
  return `Server: ${config?.serverName ?? 'Unknown'}
Members: ${config?.memberCount ?? 'Unknown'}`;
}
```

**The script context object** is a merge of Cortex-owned fields and consumer-provided fields. See the Separation of Concerns section for the full breakdown.

**Script execution model:** Scripts are loaded via dynamic `import()` and must export a default async function. They run in the same Node.js process as the backend. This is intentional: plugin scripts are already trusted code (installed by the user), and in-process execution gives them access to structured context without needing IPC or serialization.

**Error handling:** If a script throws, the marker is replaced with `[Error: script failed: <message>]`. Script errors are logged but do not block skill loading.

**Timeout:** Scripts have a 10-second timeout. On timeout, the marker is replaced with `[Error: script timed out]`.

#### 3. Variable Substitution: `${VARIABLE}`

Simple string replacement for common runtime values. Variables come from two sources: Cortex built-ins and consumer-provided variables.

**Cortex built-in variables** (always available, resolved by Cortex):

| Variable | Description |
|----------|-------------|
| `${SKILL_DIR}` | Absolute path to the skill's directory |
| `$ARGUMENTS` | All arguments as a single string |
| `$1`, `$2`, ... `$9` | Individual arguments by position (empty string if not provided) |

**Consumer-provided variables** (domain-specific, registered via `setPreprocessorVariables()`):

The consumer provides a `Record<string, string>` of additional variables. Cortex performs `${KEY}` substitution for each entry without understanding what they mean. See the Separation of Concerns section for details and examples.

Variable substitution runs first, before shell commands and scripts. This means variables are available inside shell commands and script arguments:

```markdown
## Channel-Specific Config
!`cat ${PLUGIN_ROOT}/config/${CHANNEL_TYPE}.json`
```

In this example, `PLUGIN_ROOT` and `CHANNEL_TYPE` are consumer-provided variables. Cortex substitutes them before executing the shell command.

### Scope

The preprocessor runs **only on the SKILL.md body** (the markdown content below the YAML frontmatter). Frontmatter is parsed as static YAML at registration time and is never preprocessed. This is critical: frontmatter fields (`name`, `description`) flow into the `load_skill` tool description, which is part of the system prompt. Dynamic content there would invalidate the prefix cache on every tick.

### Preprocessor Execution Order

1. **Variable substitution** (`${VAR}`, `$ARGUMENTS`, `$N`)
2. **Shell commands** (`` !`command` ``) and **scripts** (`!{script: path}`) execute in parallel
3. Results replace their respective markers
4. Final content is pushed to the skillBuffer

Shell commands and scripts run in parallel for performance. A skill with three dynamic markers has all three execute concurrently, with results assembled once all complete (or timeout).

### When Preprocessing Runs

Preprocessing runs once, at the moment the skill is loaded (either via the `load_skill` tool or via consumer pre-loading). The preprocessed content is what gets pushed to the skillBuffer. If the skill is loaded again in a subsequent tick, preprocessing runs again with fresh runtime data.

This means dynamic content is always fresh for the current tick but does not update mid-loop. If a skill needs truly live data that changes between turns within a single loop, the agent should use tools directly rather than relying on preprocessed skill content.

## Separation of Concerns: Cortex vs Consumer

Cortex is a general-purpose agent package. It must not contain application-specific concepts (contacts, channels, plugins, energy levels). The skill system enforces this boundary through extension points: Cortex provides the engine, the consumer provides all domain-specific data.

### What Cortex Owns

- The **preprocessor engine**: parsing markers, executing shell commands and scripts, performing variable substitution
- The **SkillRegistry**: indexing, add/remove lifecycle, available skills summary
- The **load_skill tool**: tool definition, skillBuffer management, ephemeral injection
- **Built-in variables**: `SKILL_DIR`, `$ARGUMENTS`, `$1`..`$9` (these are intrinsic to the skill system, not domain-specific)
- **Built-in script context fields**: `skillDir`, `args`, `rawArgs`, `scriptArgs` (same rationale)

### What the Consumer Provides

- **Variables** (`Record<string, string>`): All domain-specific `${VAR}` substitutions. Cortex performs the substitution without understanding what the variables mean.
- **Script context** (`Record<string, unknown>`): All domain-specific data passed to `!{script:}` executions. Cortex merges this with its own built-in fields and passes the combined object to the script. Cortex does not inspect or validate these fields.

### Extension Point API

```typescript
// Cortex types (in cortex/types.ts)

/** The context object that Cortex passes to skill scripts. */
interface CortexScriptContext {
  /** Absolute path to the skill's directory */
  skillDir: string;
  /** Arguments passed to the skill (split by whitespace) */
  args: string[];
  /** Raw arguments string */
  rawArgs: string;
  /** Additional key-value pairs from !{script: path, key: value} syntax */
  scriptArgs: Record<string, string>;
  /** Consumer-provided context fields (Cortex does not inspect these) */
  [key: string]: unknown;
}
```

```typescript
// CortexAgent API
class CortexAgent {
  /** Access the skill registry for add/remove/query operations. */
  getSkillRegistry(): SkillRegistry;

  /**
   * Pre-load a skill into the ephemeral context for the current loop.
   * Same path as the load_skill tool, but triggered by the consumer.
   * No LLM turn is consumed.
   */
  async loadSkill(name: string, args?: string): Promise<void>;

  /**
   * Clear the skill buffer. The consumer calls this at the start of each
   * tick, before pre-loading skills for the new loop. Cortex cannot
   * auto-clear because it has no concept of tick boundaries.
   */
  clearSkillBuffer(): void;

  /**
   * Get the current skill buffer contents (for transformContext injection).
   */
  getSkillBuffer(): LoadedSkill[];

  /**
   * Set consumer-provided variables for ${VAR} substitution in skills.
   * Merged with Cortex built-ins (SKILL_DIR, ARGUMENTS).
   * Consumer variables take precedence on collision.
   * Call this each tick during GATHER to update runtime values.
   */
  setPreprocessorVariables(variables: Record<string, string>): void;

  /**
   * Set consumer-provided context that will be passed to skill scripts.
   * Merged with Cortex built-in fields (skillDir, args, scriptArgs).
   * Consumer fields take precedence on collision.
   * Call this each tick during GATHER to update runtime values.
   */
  setScriptContext(context: Record<string, unknown>): void;
}
```

### Consumer Integration Example (Animus Backend)

This shows how the Animus backend uses the extension points. Another project using Cortex would provide entirely different variables and script context. Cortex does not know or care about any of these field names.

```typescript
// In the mind orchestrator, during GATHER

// Variables for ${VAR} substitution in SKILL.md files
cortexAgent.setPreprocessorVariables({
  AGENT_NAME: persona.name,
  USER_NAME: primaryContact.displayName,
  USER_ID: primaryContact.id,
  CONTACT_NAME: activeContact?.displayName ?? '',
  CHANNEL_TYPE: trigger.channelType ?? '',
  DATA_DIR: env.ANIMUS_DATA_DIR,
  PLUGIN_ROOT: '',  // Overridden per-skill if needed
  PLATFORM: process.platform,
  ENGINE_VERSION: packageJson.version,
});

// Rich context object for !{script:} executions
cortexAgent.setScriptContext({
  contact: activeContact
    ? { id: activeContact.id, name: activeContact.displayName, tier: activeContact.tier }
    : null,
  channelType: trigger.channelType ?? null,
  dataDir: env.ANIMUS_DATA_DIR,
  persona: { name: persona.name },
});
```

**How merging works at skill load time:**

```
Variable substitution:
  Cortex built-ins:      { SKILL_DIR: '/path/to/skill', ... }
  Consumer variables:    { AGENT_NAME: 'Animus', DATA_DIR: '/data', ... }
  Merged (consumer wins): { SKILL_DIR: '/path/to/skill', AGENT_NAME: 'Animus', DATA_DIR: '/data', ... }

Script context:
  Cortex built-ins:      { skillDir: '/path/to/skill', args: ['topic'], scriptArgs: { limit: '5' } }
  Consumer context:      { contact: { id: '...', name: 'Craig' }, channelType: 'discord', ... }
  Merged (consumer wins): { skillDir: '/path/to/skill', args: ['topic'], contact: { ... }, channelType: 'discord', ... }
```

## Consumer API

### Integration with the Mind Pipeline

```
GATHER phase:
  1. Consumer clears the skill buffer from the previous tick
     → cortexAgent.clearSkillBuffer()
  2. Consumer updates preprocessor variables and script context
     → cortexAgent.setPreprocessorVariables({ AGENT_NAME, CONTACT_NAME, ... })
     → cortexAgent.setScriptContext({ contact, channelType, ... })
  3. Consumer optionally pre-loads skills it knows are needed
     → cortexAgent.loadSkill('discord-channel')
  4. Skill buffer now has pre-loaded content

AGENTIC LOOP phase:
  5. transformContext fires → injects skillBuffer into ephemeral region
  6. Agent sees pre-loaded skill instructions
  7. Agent may call load_skill to load additional skills on demand
  8. load_skill pushes to skillBuffer → next transformContext includes it
  9. Loop continues with all loaded skills in ephemeral

Next tick:
  10. Back to step 1 (consumer clears buffer)
```

## Integration with Existing Systems

### Plugin Manager

The plugin manager already tracks skill paths for each loaded plugin (`LoadedPlugin.skills: Array<{ name, absolutePath }>`). On the Cortex migration, instead of deploying skills to provider-specific directories (the current `syncSkillBridge` approach), the plugin manager provides skill configs directly to the Cortex skill registry:

```typescript
// On plugin install
for (const skill of loadedPlugin.skills) {
  cortexAgent.getSkillRegistry().addSkill({
    path: path.join(skill.absolutePath, 'SKILL.md'),
    source: `plugin:${loadedPlugin.manifest.name}`,
  });
}

// On plugin uninstall
for (const skill of loadedPlugin.skills) {
  cortexAgent.getSkillRegistry().removeSkill(skill.name);
}
```

The existing `substitutePluginRoot()` mechanism in the plugin manager is superseded by the consumer-provided `PLUGIN_ROOT` variable, which is substituted at load time rather than at deploy time. The consumer can set `PLUGIN_ROOT` per-tick via `setPreprocessorVariables()`, or plugin skills can use `${SKILL_DIR}` (which Cortex resolves directly) to reference files relative to the skill directory.

### Plugin Context Sources

Plugins currently provide context via two mechanisms: **static context sources** (file content cached at install) and **retrieval context sources** (shell commands run each tick). Dynamic context injection in skills overlaps with retrieval context sources but serves a different purpose:

- **Context sources** inject content every tick, unconditionally. They appear in the ephemeral context whether or not the agent needs them.
- **Skill preprocessing** injects content only when the skill is loaded. It is demand-driven.

Both mechanisms continue to coexist. Context sources are for "always-relevant" plugin context; skill preprocessing is for "task-relevant" dynamic data.

### System Prompt Rebuild

When skills are added or removed (via `addSkill()` / `removeSkill()`), the `load_skill` tool description changes. This is part of the tool set, which is included in the system prompt. The consumer should trigger a system prompt rebuild when the skill registry changes, following the same pattern used for plugin tool changes.

## Package Structure Addition

The skill system adds these files to the `@animus-labs/cortex` package:

```
packages/cortex/
  src/
    skill-registry.ts       # SkillRegistry class, SkillEntry type
    skill-preprocessor.ts   # Preprocessor (shell, script, variable substitution)
    skill-tool.ts           # load_skill AgentTool definition
    types.ts                # Add SkillConfig, PreprocessorContext, LoadedSkill
```

## Future: Sub-Agent Skills

> Not implemented in the initial skill system. Documented here to ensure the architecture does not prevent this migration.

Skills with `context: fork` in their frontmatter would run in an isolated sub-agent with its own context window, rather than injecting into the current loop's ephemeral context. This maps to Cortex's planned sub-agent capability (Phase 4 of the migration).

**How it would work:**

1. Agent calls `load_skill("batch-refactor")`.
2. Cortex reads the frontmatter, sees `context: fork`.
3. Instead of pushing to skillBuffer, Cortex spawns a sub-agent with:
   - The skill's SKILL.md body as the system prompt
   - A restricted tool set (from `allowed-tools` frontmatter). This is when `allowed-tools` becomes enforced: the sub-agent is created with only those tools registered, rather than the full tool set.
   - An optional model tier (from `model-tier` frontmatter)
4. The sub-agent runs independently and delivers its result via the existing sub-agent completion mechanism.
5. The `load_skill` tool returns immediately with a confirmation that a sub-agent was spawned.

**Model tier mapping:**

The `model-tier` field maps to concrete models based on the consumer's configured provider:

| Tier | Purpose | Example Models |
|------|---------|----------------|
| `high` | Complex reasoning, large context tasks | Claude Opus, GPT o3, Gemini 2.5 Pro |
| `medium` | General purpose (default) | Claude Sonnet, GPT 4.1, Gemini 2.5 Flash |
| `low` | Simple classification, formatting | Claude Haiku, GPT 4.1 mini, Gemini Flash Lite |

The consumer provides the tier-to-model mapping based on the active pi-ai provider configuration. Cortex does not hardcode model names.

**What the current architecture preserves:**

- `SkillEntry.frontmatter` stores all frontmatter fields, including `context` and `model-tier`, without needing to understand them now.
- The `load_skill` tool's `execute()` function can check `entry.frontmatter.context === 'fork'` and branch to sub-agent spawning when that capability exists.
- The `SkillRegistry` and preprocessor work identically for both injection and sub-agent skills; only the delivery mechanism differs.

## Open Questions

1. **Shell command security policy**: Should the consumer be able to disable shell command execution for specific skill sources (e.g., allow for `builtin` and `user`, disallow for `plugin`)? Or is the plugin installation trust model sufficient?

2. **Skill deduplication**: If two plugins provide a skill with the same name, which takes precedence? Current thinking: last-installed wins, with a warning logged.

3. **Skill versioning**: Should the registry track skill versions and handle upgrades? Or is this a concern for the package installation system?

4. **Argument validation**: Should skills be able to declare expected arguments in frontmatter (with types, defaults, required flags)? Or is free-form `$ARGUMENTS` sufficient?

5. **Skill composition**: Should one skill be able to reference or invoke another skill? Or should composition happen at the agent level (the agent loads multiple skills independently)?
