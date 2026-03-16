# Phase 4: Sub-Agents and Skills

> **Scope:** Implement the SubAgent tool for cortex-based sub-agent delegation, and the skill system for progressive skill disclosure via SKILL.md files.

## Dependencies

- Phase 2A complete (heartbeat integration)
- Phase 3 complete (MCP client, since sub-agents may need plugin tools)

## Tasks

### 4.1: SubAgent Tool (`tools/sub-agent.ts`)

**Reference:** `tools/sub-agent.md`

Implement sub-agent spawning as a built-in tool:

- Each sub-agent is an independent `CortexAgent` instance
- Foreground (blocks parent) and background (returns task ID) modes
- SubAgent tool is ALWAYS excluded from child agent tool sets (no recursive spawning)
- Concurrency limit: `maxConcurrentSubAgents` (default 4)
- Budget guards: inherited from parent, can be tightened not loosened
- Context slots: empty (sub-agents start fresh)
- Working directory: inherited from parent
- Shared: API key, permission resolver, working tags config, MCP connections

### 4.2: Sub-Agent Manager (`sub-agent-manager.ts`)

Track active sub-agents:
- Map of task ID -> sub-agent CortexAgent instance
- Concurrency enforcement
- Lifecycle events (`onSubAgentSpawned`, `onSubAgentCompleted`, `onSubAgentFailed`)
- Cancel all on parent destroy
- Background sub-agent completion notification via `getFollowUpMessages()`

### 4.3: Integration with AgentOrchestrator

**Modify:** `packages/backend/src/heartbeat/agent-orchestrator.ts`

The orchestrator uses cortex SubAgent spawning instead of Claude SDK sessions:
- `spawnAgent()` calls cortex SubAgent tool internally
- `updateAgent()` calls `agent.steer()` on the sub-agent
- `cancelAgent()` calls `agent.abort()` on the sub-agent
- Task tracking in `agent_tasks` table continues via lifecycle hooks
- Result delivery via `agent_complete` heartbeat trigger continues unchanged

### 4.4: Skill Registry (`skill-registry.ts`)

**Reference:** `skill-system.md`

```typescript
class SkillRegistry {
  constructor(configs: SkillConfig[]);
  addSkill(config: SkillConfig): void;
  removeSkill(name: string): void;
  getAvailableSkillsSummary(): string;
  getSkillBody(name: string, args): Promise<string>;
}
```

- Parse SKILL.md frontmatter (use `gray-matter`)
- Track all registered skills with name, description, path, source
- Generate summary string for system prompt injection (name + description per skill, ~100 tokens each)

### 4.5: Skill Preprocessor (`skill-preprocessor.ts`)

**Reference:** `skill-system.md`, `cross-platform-considerations.md` (Skill Preprocessor Shell Commands)

Process SKILL.md body at load time:
- Variable substitution: `$AGENT_NAME`, `$USER_NAME`, `$PLATFORM`, etc.
- Shell command execution: `` `shell: command` `` markers. Uses the same shell selection logic as the Bash tool (PowerShell on Windows, bash/zsh on Unix).
- Script execution: `` `script: ./relative-path.js` `` markers with `CortexScriptContext`

**Cross-platform note:** Shell commands in skills are NOT portable across platforms. Document in `skill-system.md`:
- For anything beyond trivial commands (like `git log`), use `` `script: path.js` `` instead
- Pipe chains and Unix-specific commands (`cat`, `grep`, `awk`) should use the script approach
- Consider adding an optional shell specifier: `` `bash: command` `` or `` `powershell: command` ``

### 4.6: Load Skill Tool (`skill-tool.ts`)

**Reference:** `skill-system.md`

Built-in `load_skill` AgentTool:
- Parameters: `name` (required), `args` (optional)
- Loads skill body via SkillRegistry, runs preprocessor, adds to skill buffer
- Skill buffer content injected into ephemeral context via `transformContext`
- Buffer persists for the duration of the current agentic loop, cleared on next tick

### 4.7: Skill System Prompt Integration

Add to system prompt (consumer content section):
- Available skills summary from `skillRegistry.getAvailableSkillsSummary()`
- Instruction: "Before acting, check if a loaded skill applies. Use `load_skill` to load a skill's full instructions."

Wire plugin lifecycle:
- `plugin:installed` with skills -> `skillRegistry.addSkill()` for each
- `plugin:removed` -> `skillRegistry.removeSkill()` for each

## Completion Criteria

- SubAgent tool spawns independent cortex agents
- Foreground and background modes work
- Concurrency limit enforced
- Sub-agent lifecycle hooks fire correctly
- AgentOrchestrator uses cortex for sub-agent spawning
- Skill registry loads and tracks SKILL.md files
- Preprocessor handles variables, shell commands, scripts
- load_skill tool injects skill content into ephemeral context
- Plugin skill lifecycle (add/remove) works

## Files Created

| File | Purpose |
|------|---------|
| `src/tools/sub-agent.ts` | SubAgent tool |
| `src/sub-agent-manager.ts` | Concurrency + lifecycle tracking |
| `src/skill-registry.ts` | Skill discovery and management |
| `src/skill-preprocessor.ts` | SKILL.md body preprocessing |
| `src/skill-tool.ts` | load_skill AgentTool |

## New External Dependencies

| Package | Used By |
|---------|--------|
| `gray-matter` | Skill registry (SKILL.md frontmatter) |
