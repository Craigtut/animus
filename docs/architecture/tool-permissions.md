# Tool Permissions & Approval System

How Animus gives users granular control over which tools can run, which require explicit approval, and how the approval flow preserves context across delays of minutes or hours.

## Concept

Animus tools span a wide range — from harmless read-only queries to shell commands that modify the filesystem. Users need control over what their Animus instance can do autonomously versus what requires a human check. The tool permission system provides three states per tool, a two-tick approval pattern for gated tools, and a trust ramp that suggests graduating tools to autonomous mode after repeated approvals.

This system complements the existing contact-based permission tiers (see `docs/architecture/contacts.md`) and the MCP tool architecture (see `docs/architecture/mcp-tools.md`). Contact tiers control *which tools exist* in a session; tool permissions control *whether those tools can execute freely*.

---

## The Three Permission States

Every tool in the system has exactly one permission mode:

| Mode | Behavior | Visual Color |
|------|----------|-------------|
| **Off** | Tool is excluded from agent sessions entirely. Cannot be called. | Red / muted |
| **Ask First** | Tool is available but gated. First call creates an approval request; execution is blocked until the user decides. | Amber |
| **Always Allow** | Tool runs freely with no approval needed. | Green |

### Risk Tiers & Default Modes

Tools are assigned a risk tier that determines their default permission mode. Users can override any default.

| Risk Tier | Default Mode | Color | Examples |
|-----------|-------------|-------|----------|
| **Safe** (read-only) | Always Allow | Green | `read_memory`, `lookup_contacts`, `glob`, `grep`, `read` |
| **Communicates** (sends messages) | Always Allow | Blue | `send_message`, `send_proactive_message`, `send_media` |
| **Acts** (side effects) | Ask First | Amber | `write`, `edit`, `webfetch`, `websearch`, plugin MCP tools |
| **Sensitive** (dangerous) | Ask First | Red | `bash`, `run_with_credentials` |

---

## Three Tool Categories

The permission system spans three categories of tools with different enforcement mechanisms:

```
┌─────────────────────────────────────────────────────────────┐
│                   canUseTool Callback                        │
│        (fires for EVERY tool, including external MCP)        │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ SDK Built-In │  │ Plugin MCP   │  │  Core Animus MCP │  │
│  │              │  │              │  │                  │  │
│  │ bash, read,  │  │ home-assist, │  │ send_message,    │  │
│  │ write, edit, │  │ giphy, etc.  │  │ read_memory,     │  │
│  │ glob, grep   │  │              │  │ lookup_contacts  │  │
│  │              │  │ Enforced by  │  │                  │  │
│  │ Enforced by  │  │ canUseTool   │  │ Enforced by      │  │
│  │ canUseTool   │  │ (server key) │  │ registry.ts gate │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                             │
│  Cognitive tools (record_thought, record_cognitive_state)    │
│  are always exempt — internal pipeline, never gated.        │
└─────────────────────────────────────────────────────────────┘
```

### 1. Core Animus MCP Tools (In-Process)

Tools defined in `@animus/shared` and handled in `packages/backend/src/tools/`. These run in-process via `createSdkMcpServer()`. Permission checking happens in `registry.ts:executeTool()` via `checkToolPermission()`.

**Exempt tools:** `resolve_tool_approval` and `send_message` bypass the permission gate entirely — the approval tool must always work (otherwise the user can't respond to requests), and `send_message` is the primary communication channel.

### 2. SDK Built-In Tools

Tools provided by the agent SDK itself (`bash`, `read`, `write`, `edit`, `glob`, `grep`, `webfetch`, `websearch`). These are not routed through the Animus tool registry. Permission enforcement uses the SDK's `canUseTool` callback, which fires for every tool call regardless of type.

**Off mode** for SDK tools uses `disallowedTools` — the tool is removed from the SDK's available set entirely.

### 3. Plugin MCP Tools (External Servers)

Tools from installed plugins running as external MCP servers. Each plugin server is registered under a namespaced key (e.g., `home-assistant__main`). Permissions are enforced at the **server level**, not per-function.

**Permission key format:** `mcp__<pluginName>__<serverName>` — e.g., `mcp__home-assistant__main`. When a tool call like `mcp__home-assistant__main__turn_on_light` fires, the system extracts the server key and checks permission against that.

**Off mode** for plugin MCP tools excludes the entire server from the agent session — it's never started.

---

## The Two-Tick Approval Pattern

When a tool with `ask` mode is called, execution follows a two-tick dance:

```
Tick 1 — Gate fires
═══════════════════
  Agent calls gated tool (e.g., "write")
       │
       ▼
  canUseTool / checkToolPermission fires
       │
       ├── Check tool_permissions table → mode is 'ask'
       ├── Check tool_approval_requests → no active approval
       │
       ▼
  Create approval request in heartbeat.db
  Emit 'tool:approval_requested' event
  Return deny: "Tool requires user approval..."
       │
       ▼
  Agent explains to user what it wants to do
  Approval notifier sends structured approval prompt
  Channel adapter renders approval UI:
    • Web: inline card with Allow Once / Always Allow / Deny
    • Discord: embed with button components
    • SMS: natural language prompt
    • API: structured JSON

Between Ticks — User Decides (seconds to hours)
════════════════════════════════════════════════
  User clicks button or replies naturally
       │
       ├── Web button click → tools.resolveApproval mutation
       ├── Discord button → adapter sends tool_approval_response
       ├── SMS text reply → mind interprets via resolve_tool_approval
       │
       ▼
  Approval recorded in heartbeat.db
  'tool:approval_resolved' event emitted
  New tick triggered (message-type with approval context)

Tick 2 — Execute
════════════════
  New tick fires (triggered by approval)
       │
       ▼
  Context includes pending approval info
  Agent retries the tool call
       │
       ▼
  canUseTool / checkToolPermission fires
       ├── Check tool_approval_requests → found approved record
       ├── Consume one-time approval (mark as consumed)
       │
       ▼
  Tool executes normally
```

### Context Preservation

The `tool_approval_requests` table stores rich context so the mind can resume coherently even after long delays:

```sql
agent_context JSON:
  task_description   — "Tool 'write' invoked during tick 42"
  conversation_summary — "Conversation abc-123"
  pending_action     — "Execute tool 'write'"

tool_input JSON:      — The exact parameters passed to the tool
trigger_summary TEXT: — "Agent wants to use 'Write File'"
```

On approval, the context builder injects pending approvals into the mind's context (see [Context Builder Integration](#context-builder-integration)).

### Approval Resolution Options

| Option | Behavior |
|--------|----------|
| **Allow Once** | Approves this single invocation. Consumed on next use. |
| **Always Allow** | Approves and updates `tool_permissions.mode` to `always_allow`. No future prompts. |
| **Deny** | Denies the request. Agent informed via deny message. |

"Always Allow" is **button-only** (web, Discord). Natural language approvals are always treated as one-time to prevent misinterpretation. The `resolve_tool_approval` core tool only supports `approved: boolean` without a scope parameter.

### Approval Expiration

Approvals expire after 24 hours by default. Expired records are cleaned up during the EXECUTE stage's cleanup phase. If a user replies to an expired request, the mind explains it has expired and can re-request if needed.

---

## Sub-Agent Tool Filtering

Sub-agents have a **stricter** policy than the mind. They cannot interact with users for approval, so `ask` mode tools are excluded entirely:

| Mode | Mind Session | Sub-Agent Session |
|------|-------------|-------------------|
| **Off** | Tool excluded | Tool excluded |
| **Ask** | Tool available (gated) | Tool excluded |
| **Always Allow** | Tool available (free) | Tool available (free) |

If a sub-agent needs a gated tool, the pattern is:

1. Sub-agent reports in its results: "Need approval for [tool] to complete [task]"
2. Sub-agent completes with partial results
3. Mind reads results on `agent_complete` tick, sees the need
4. Mind calls the gated tool itself (mind has user's attention on the active channel)
5. Approval flow fires, user decides
6. Mind handles the tool use directly or re-spawns the sub-agent

Implementation in `agent-orchestrator.ts`:
```typescript
for (const [key, config] of Object.entries(pluginMcp.mcpServers)) {
  const perm = getToolPermission(sysDb, `mcp__${key}`);
  if (perm && (perm.mode === 'off' || perm.mode === 'ask')) {
    continue; // Sub-agents skip both off AND ask
  }
  filteredServers[key] = config;
}
```

---

## Database Schema

### `tool_permissions` (system.db)

Per-tool permission settings. Seeded on startup, user-customizable.

```sql
CREATE TABLE tool_permissions (
  tool_name TEXT PRIMARY KEY,
  tool_source TEXT NOT NULL,          -- 'animus:core' | 'sdk:claude' | 'plugin:<name>'
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  risk_tier TEXT NOT NULL DEFAULT 'acts',
  mode TEXT NOT NULL DEFAULT 'ask',   -- 'off' | 'ask' | 'always_allow'
  is_default INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  trust_ramp_dismissed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

The `is_default` flag distinguishes seeder-managed rows (1) from user-customized rows (0). The seeder can update default rows on restart without overwriting user choices.

### `tool_approval_requests` (heartbeat.db)

Approval request lifecycle tracking. Created when a gated tool is called, resolved when the user responds.

```sql
CREATE TABLE tool_approval_requests (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  tool_source TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  tick_number INTEGER NOT NULL,

  agent_context TEXT NOT NULL,        -- JSON: context preservation
  tool_input TEXT,                    -- JSON: exact parameters
  trigger_summary TEXT NOT NULL,
  conversation_id TEXT,
  originating_agent TEXT NOT NULL,    -- 'mind' or agent_task_id

  status TEXT NOT NULL DEFAULT 'pending',
  scope TEXT,                         -- 'once' on approval
  batch_id TEXT,                      -- groups same-tick requests

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  expires_at TEXT NOT NULL
);
```

---

## Permission Seeding

On startup (and whenever plugins change at runtime), the permission seeder populates `tool_permissions` with defaults for all known tools. Runs idempotently — only inserts rows for tools without existing records. User-customized rows are preserved.

**File:** `packages/backend/src/tools/permission-seeder.ts`

Three phases:

1. **Core Animus tools** — Iterates `ANIMUS_TOOL_DEFS`, assigns risk tiers from a hardcoded map
2. **Active SDK tools** — Seeds tools for the active provider only (e.g., `sdk:claude`). Tool set: `read`, `glob`, `grep`, `write`, `edit`, `bash`, `webfetch`, `websearch`
3. **Plugin MCP tools** — Iterates installed plugins' MCP configs, assigns `acts` tier by default

```typescript
// Risk tier → default mode mapping
function defaultModeForTier(tier: RiskTier): ToolPermissionMode {
  switch (tier) {
    case 'safe':
    case 'communicates': return 'always_allow';
    case 'acts':
    case 'sensitive':   return 'ask';
  }
}
```

### Runtime Re-Seeding

When a plugin is installed, uninstalled, or toggled at runtime, the `plugin:changed` event fires and the seeder runs again. This ensures new plugin tools appear in the permissions table immediately.

```typescript
// In packages/backend/src/index.ts
getEventBus().on('plugin:changed', () => {
  seedToolPermissions(getSystemDb(), currentSettings.defaultAgentProvider ?? 'claude',
    collectPluginTools());
});
```

---

## The `canUseTool` Callback

The primary permission enforcement point for SDK-level tools (built-in + plugin MCP). This is a callback passed to the agent SDK session that fires for **every tool call**, including external MCP servers.

**File:** `packages/backend/src/heartbeat/mind-session.ts`

### Why canUseTool, Not Hooks

The Claude Agent SDK provides two permission mechanisms:

1. **`PreToolUse` hooks** — Only fire for SDK built-in tools. In `bypassPermissions` mode (our previous approach), hooks don't fire at all for external MCP tools.
2. **`canUseTool` callback** — Fires for **all** tool calls regardless of type, including external MCP servers. Works with `default` permission mode.

We use `canUseTool` with `approvalLevel: 'normal'` (which maps to `default` permission mode in the SDK). This ensures the callback fires for every tool type.

### Resolution Logic

```typescript
function resolveToolPermission(toolName: string) {
  // Core Animus MCP tools → skip (have own in-process gate)
  if (toolName.startsWith('mcp__tools__')) return null;
  // Cognitive tools → skip (always allowed)
  if (toolName.startsWith('mcp__cognitive__')) return null;
  // Plugin MCP tools → use server-level key
  if (toolName.startsWith('mcp__')) {
    const permKey = getPluginMcpPermissionKey(toolName);
    return { permKey, permission: getToolPermission(sysDb, permKey) };
  }
  // SDK built-in tools → exact name lookup
  return { permKey: toolName, permission: getToolPermission(sysDb, toolName) };
}
```

The callback checks permission mode, looks for active approvals, creates approval requests when none exist, and returns `{ behavior: 'allow' }` or `{ behavior: 'deny', message: '...' }`.

---

## Context Builder Integration

The context builder injects two types of permission-related context into the mind's prompt.

**File:** `packages/backend/src/heartbeat/context-builder.ts`

### Pending Approvals Section

When pending approval requests exist for the current contact, they're included in the user message context:

```
── PENDING TOOL APPROVALS ──
The following tool approval requests are waiting for user response.
If the user's message indicates approval or denial, use resolve_tool_approval
to record their decision, then retry the tool if approved.

1. [abc-123] write (sdk:claude) — PENDING since 2h ago
   Original context: Tool "write" invoked during tick 42
   You wanted to: Execute tool "write"
   Tool parameters: { "file_path": "/tmp/test.txt", "content": "hello" }
```

This allows the mind to pick up where it left off, even hours later.

### Trust Ramp Observations

On interval ticks, the context builder queries for tools eligible for trust ramp upgrade and injects a subtle suggestion:

```
── TRUST OBSERVATION ──
You've noticed that the user has approved "Write File" 5 times
in the past week without ever denying it. If it feels natural in
conversation, you might casually suggest they set it to "Always Allow"
in Settings > Tools to save time. This is not urgent.
```

The mind decides when (or if) to mention it naturally in conversation.

### Tool Reference

The `resolve_tool_approval` tool is documented in the mind's system prompt:

```
resolve_tool_approval — Approve or deny a pending tool approval request.
  When the user indicates they approve or deny a tool that was previously
  blocked by the permission system, use this tool to record their decision.
  If approved, the tool will be retried automatically.

  Input: { requestId: string, approved: boolean }
```

---

## Trust Ramp

Tracks consecutive approvals per tool. After 5 approvals within 7 days with no denials, the system suggests upgrading to `always_allow`.

### Eligibility Query

```sql
SELECT tp.tool_name, tp.display_name
FROM tool_permissions tp
WHERE tp.mode = 'ask'
  AND (tp.trust_ramp_dismissed_at IS NULL
       OR tp.trust_ramp_dismissed_at < datetime('now', '-30 days'))
  AND (SELECT COUNT(*) FROM tool_approval_requests tar
       WHERE tar.tool_name = tp.tool_name
         AND tar.status = 'approved'
         AND tar.created_at > datetime('now', '-7 days')) >= 5
  AND (SELECT COUNT(*) FROM tool_approval_requests tar2
       WHERE tar2.tool_name = tp.tool_name
         AND tar2.status = 'denied'
         AND tar2.created_at > datetime('now', '-7 days')) = 0
```

### Anti-Nag Mechanism

If the user declines the suggestion, `trust_ramp_dismissed_at` is set. The system suppresses the suggestion for 30 days. After 30 days, if the pattern continues, it suggests once more.

---

## Approval Notifier

Delivers approval requests to users through the channel router. Each channel adapter renders the approval according to its capabilities.

**File:** `packages/backend/src/tools/approval-notifier.ts`

The notifier listens for three events:

| Event | Action |
|-------|--------|
| `tool:approval_requested` | Sends approval prompt via channel router with structured metadata |
| `tool:approval_resolved` | Logs resolution (web frontend updates via tRPC subscription) |
| `tool:approval_expired` | Logs expiration warning |

### Channel-Specific Rendering

Approval prompts include structured metadata (`message_type: 'tool_approval_request'`) that channel adapters detect and render:

| Channel | Rendering |
|---------|-----------|
| **Web** | Inline card with buttons (Allow Once / Always Allow / Deny) via tRPC subscription |
| **Discord** | Embed with ActionRow button components |
| **SMS** | Natural language text: "I'd like to use the [tool]. Please approve or deny." |
| **API** | Structured JSON appended to response |

All channels accept natural language responses. Buttons are a convenience layer. The mind interprets replies naturally via the `resolve_tool_approval` tool.

---

## Event Bus Events

Four tool permission events on the event bus (`packages/shared/src/event-bus.ts`):

```typescript
'tool:approval_requested': ToolApprovalRequest;
'tool:approval_resolved':  { id: string; toolName: string;
                             status: 'approved' | 'denied';
                             scope: 'once' | null };
'tool:approval_expired':   { id: string; toolName: string };
'tool:permission_changed': { toolName: string; mode: ToolPermissionMode };
```

---

## tRPC API

**File:** `packages/backend/src/api/routers/tools.ts`

| Procedure | Type | Description |
|-----------|------|-------------|
| `listTools` | query | List all tools with their permission settings |
| `updatePermission` | mutation | Update mode for a single tool |
| `updateGroupPermission` | mutation | Set all tools from a source to the same mode |
| `listApprovals` | query | List pending or all approval requests |
| `resolveApproval` | mutation | Approve/deny a request (triggers new tick if approved) |
| `dismissTrustRamp` | mutation | Suppress trust ramp suggestion for a tool |
| `onApprovalRequest` | subscription | Real-time new approval requests |
| `onApprovalResolved` | subscription | Real-time approval resolutions |

### Approval → Tick Trigger

When an approval is granted via `resolveApproval`, a new tick is triggered so the mind can retry the tool:

```typescript
if (input.approved) {
  triggerTick({
    type: 'message',
    contactId: request.contactId,
    channel: request.channel,
    messageContent: `[Tool "${request.toolName}" approved — you may retry]`,
    messageId: `approval-${input.requestId}`,
  });
}
```

If "Always Allow" scope is selected, the tool's permission mode is also updated to `always_allow` in `tool_permissions`.

---

## Frontend Integration

### Settings > Tools Page

The tools section in Settings displays all tools grouped by source, with a segmented control for each tool's permission mode (Off / Ask / Always Allow). Group headers include a "Set all to..." dropdown for bulk operations.

**Visibility rules:**
- Only SDK tools for the **active provider** are shown
- Core Animus tools are always shown
- Plugin tools are grouped by plugin name, only if plugin is enabled
- Cognitive tools are never shown (internal pipeline)

### Approval Card in Chat

When an approval request arrives, the web frontend renders an inline card in the message stream with the tool name, context summary, and three action buttons. The card updates in real-time via the `onApprovalResolved` subscription (collapsed to show outcome).

---

## Shared Types

**File:** `packages/shared/src/types/index.ts`

```typescript
type RiskTier = 'safe' | 'communicates' | 'acts' | 'sensitive';
type ToolPermissionMode = 'off' | 'ask' | 'always_allow';
type ToolApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

interface ToolPermission {
  toolName: string;
  toolSource: string;        // 'animus:core' | 'sdk:claude' | 'plugin:<name>'
  displayName: string;
  description: string;
  riskTier: RiskTier;
  mode: ToolPermissionMode;
  isDefault: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  trustRampDismissedAt: string | null;
  updatedAt: string;
}

interface ToolApprovalRequest {
  id: string;
  toolName: string;
  toolSource: string;
  contactId: string;
  channel: string;
  tickNumber: number;
  agentContext: ToolApprovalAgentContext;
  toolInput: Record<string, unknown> | null;
  triggerSummary: string;
  conversationId: string | null;
  originatingAgent: string;         // 'mind' or agent_task_id
  status: ToolApprovalStatus;
  scope: 'once' | null;
  batchId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  expiresAt: string;
}
```

---

## Implementation Status

### Complete
- Database schema: `tool_permissions` (system.db) + `tool_approval_requests` (heartbeat.db)
- Store layer: CRUD for both tables in `system-store.ts` and `heartbeat-store.ts`
- Shared types: `ToolPermission`, `ToolApprovalRequest`, `RiskTier`, `ToolPermissionMode`
- Event bus: Four tool permission events
- Permission gate: `checkToolPermission()` in `registry.ts` for core MCP tools
- `canUseTool` callback: Gates SDK built-in + plugin MCP tools in `mind-session.ts`
- `resolve_tool_approval` core tool for natural language approval responses
- Permission seeder: Seeds defaults on startup + runtime re-seeding on `plugin:changed`
- Approval notifier: Delivers prompts via channel router with structured metadata
- Context builder: Pending approvals section + trust ramp observations
- tRPC router: Full CRUD + real-time subscriptions
- SDK adapter: `canUseTool` support in `@animus/agents` Claude adapter
- Sub-agent filtering: Excludes both `off` and `ask` tools from sub-agent sessions
- Channel adapters: Discord (embed + buttons), SMS (text), API (JSON) support
- Frontend: Settings > Tools page + inline approval card in chat
- Trust ramp: Eligibility query + context injection + anti-nag mechanism

### Not Yet Implemented
- Approval batching UI: Multiple same-tick approvals grouped into a single card
- Codex/OpenCode adapter integration (pending adapter implementations)
- Approval expiration cleanup in heartbeat EXECUTE stage (schema supports it)

---

## File Map

| File | Purpose |
|------|---------|
| `packages/shared/src/types/index.ts` | `ToolPermission`, `ToolApprovalRequest`, `RiskTier`, `ToolPermissionMode` types |
| `packages/shared/src/event-bus.ts` | Tool permission events |
| `packages/shared/src/tools/definitions.ts` | `resolve_tool_approval` tool definition |
| `packages/backend/src/db/migrations/system/010_tool_permissions.sql` | `tool_permissions` table |
| `packages/backend/src/db/migrations/heartbeat/003_tool_approvals.sql` | `tool_approval_requests` table |
| `packages/backend/src/db/stores/system-store.ts` | `tool_permissions` CRUD functions |
| `packages/backend/src/db/stores/heartbeat-store.ts` | `tool_approval_requests` CRUD functions |
| `packages/backend/src/tools/permission-seeder.ts` | Seeds default permissions on startup |
| `packages/backend/src/tools/approval-notifier.ts` | Routes approval requests to channels |
| `packages/backend/src/tools/registry.ts` | Permission gate for core Animus MCP tools |
| `packages/backend/src/tools/handlers/resolve-tool-approval.ts` | `resolve_tool_approval` handler |
| `packages/backend/src/heartbeat/mind-session.ts` | `canUseTool` callback, plugin MCP filtering |
| `packages/backend/src/heartbeat/agent-orchestrator.ts` | Sub-agent tool filtering (off + ask) |
| `packages/backend/src/heartbeat/context-builder.ts` | Pending approvals + trust ramp in context |
| `packages/backend/src/api/routers/tools.ts` | tRPC router for permissions + approvals |
| `packages/agents/src/types.ts` | `canUseTool` in `AgentSessionConfig` |
| `packages/agents/src/adapters/claude.ts` | `canUseTool` wired through to SDK |

---

## References

- Internal: `docs/architecture/mcp-tools.md` (tool definitions, registry, MCP server architecture)
- Internal: `docs/architecture/contacts.md` (contact permission tiers)
- Internal: `docs/architecture/heartbeat.md` (tick pipeline, GATHER/MIND/EXECUTE stages)
- Internal: `docs/architecture/agent-orchestration.md` (sub-agent spawning, MCP tools)
- Internal: `docs/architecture/channel-packages.md` (channel adapters, IPC protocol)
- Internal: `docs/architecture/plugin-system.md` (plugin MCP servers, lifecycle)
