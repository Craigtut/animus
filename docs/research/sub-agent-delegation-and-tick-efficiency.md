# Sub-Agent Delegation & Tick Efficiency

**STATUS**: Proposal, not implemented. (2026-05-27)
**Created**: 2026-05-27
**Problem**: When the mind pursues long-running, open-ended work, it does that work inline across stateless heartbeat ticks instead of delegating it, so every tick re-derives the same context. This is slow and expensive.
**Spans**: `animus/packages/backend` (wiring) and `cortex-mono/packages/cortex` (general-purpose harness hooks). Per the Cortex boundary rules, all Cortex changes here are harness-generic, with no Animus-specific concepts leaking into Cortex.

---

## Problem Statement

Analysis of the production macOS instance (data directory `~/Library/Application Support/com.animus.desktop/`) found the mind pursuing an open-ended goal ("Lead and build the Reverie application") by doing the build work **itself**, in interval ticks, one fresh empty-history session at a time. The measured consequences over ~48 hours:

- **94% of all file reads (3,592 of 3,820) were re-reads** of a file already read in an earlier tick. Only 6% were first-time discovery.
- Core files were re-read across dozens of distinct ticks (e.g. `App.tsx` 526 times across 52 ticks; `implementation-queue.md` in 65 ticks). Each tick re-runs nearly the same `glob` / `grep` / `read` sequence to rebuild its mental model before it can act.
- Roughly 28% of active ticks made zero edits: they spent their whole budget re-orienting.
- Cost ran ~$250 to $400 per day; the interval `agentic_loop` phase alone was the dominant line item.

The mind delegated to a sub-agent only twice in 310 interval loops. The re-derivation tax is the direct result of doing continuous work in a discontinuous (per-tick, empty-history) execution model.

### Root cause

1. **The mind does long-running work inline.** It holds `Read/Edit/Write/Bash` directly (correct, and not changing), so the path of least resistance is to start working in the loop rather than delegate.
2. **Delegation is split across two paths, and the better one is awkward.**
   - The legacy `spawn_agent` *decision* (predates Cortex, first seen in "sprint 1") is emitted in the REFLECT phase, **after** the loop already did the work inline. It is tracked (creates an `agent_tasks` row via the orchestrator) but fires too late to prevent inline work.
   - Cortex's built-in `SubAgent` *tool* is callable in-loop and is auto-enabled, but it spawns directly through Cortex and **bypasses the orchestrator**, so those spawns get no `agent_tasks` row, no journal linkage, and are invisible to `getRunningTasks()`.
3. **The mind is blind to its own running sub-agents.** `AgentOrchestrator.getRunningTasks()` exists but is never injected into tick context, and Cortex's live per-child activity is not surfaced. The mind cannot reason about what it has already delegated.
4. **Caching is underused.** The model is `gpt-5.5`, which has 24h extended prompt caching on by default. pi-ai wires `prompt_cache_key` to `options.sessionId`, but Cortex never passes a `sessionId`, so the key is always undefined and cross-request routing stickiness is lost.
5. **Mutable context sits in the cache anchor.** Goals and tasks are context slots 8 and 9, positioned before conversation history and ephemeral context. During heavy task work they change every tick and truncate the cacheable prefix that the slot region is meant to anchor.

> Note: the in-tick "compaction every turn" churn and 50 to 272 turn runaways observed in the same data were a separate, already-fixed Cortex 0.2.7 bug (fixed in Cortex 0.3.0, pending a desktop rebuild). That is out of scope here.

---

## Goals & Non-Goals

**Goals**
- Make delegation the natural path for large or parallelizable work, triggered **in-loop** the moment it is recognized, via a single tool.
- Give delegated sub-agents continuous context so the heavy work happens once, not re-derived per tick.
- Make running sub-agents visible to the mind so it can coordinate rather than duplicate.
- Stop leaking spend: sub-agent cost counts toward the global budget, including in-flight.
- Recover the caching that is currently left on the table.

**Non-Goals**
- We are NOT building a coding agent. Animus is a generic agent; nothing here should assume software work.
- We are NOT disabling Cortex's built-in `SubAgent` tool and reimplementing an Animus-specific one. We extend Cortex generically instead.
- We are NOT setting per-sub-agent turn or cost caps (see the budget decision below).
- We are NOT injecting the orchestrator's goal as a directive into sub-agents (see the seed-context decision below).
- The richer "code-map journal" idea is explicitly dropped (coding-agent-specific).

---

## Design Decisions (locked)

1. **Single delegation path: Cortex's in-loop `SubAgent` tool.** Keep it enabled. The orchestrator's reflect-phase `spawn_agent` decision is **fully removed** (not deprecated): decision type, handler, decision-reference text, permission-list entries, and any tests. `update_agent` / `cancel_agent` decisions remain for now (steering running agents); candidates to become in-loop tools later.

2. **Extend Cortex via general-purpose hooks, never fork.** Cortex gains a small, harness-generic extension surface (below). It learns nothing about goals, tasks, or Animus tables.

3. **No per-sub-agent budget caps.** A legitimate sub-agent may run for a very long time, so `maxTurns` / `maxCost` per sub-agent are intentionally left unset. Runaway protection lives at the **global** level: sub-agent spend (including in-flight) counts toward Animus's existing configurable **weekly budget**, and the budget hard-stop gates new spawns.

4. **Seed context is background context, not a brief or a directive.** The orchestrator's `instructions` (the `SubAgent` tool call) are the sub-agent's sole task. The seed is supplementary **background** only (e.g. working directory, environment/toolchain), injected as an **initial context slot** on the child, framed explicitly as reference. The broad orchestrator goal is **not** passed as something for the sub-agent to pursue. See the dedicated section below.

5. **Move goals/tasks out of the slot anchor into the top of ephemeral context.** Correct home for per-tick mutable content; protects the cached conversation history on message ticks; neutral on interval ticks.

6. **Thread a stable `sessionId` into Cortex completion options** so pi-ai sets `prompt_cache_key`. gpt-5.5 already provides 24h retention, so no retention change is needed for the current model.

---

## The seed-context line we must not cross

This is the subtle part and the easiest to get wrong.

The orchestrator (the mind) pursues a goal that is frequently broad ("Lead and build the Reverie application"). A sub-agent must **not** inherit that objective. A sub-agent exists to do exactly the one thing the orchestrator handed it in `instructions`, then report back. If we inject the goal as a directive, sub-agents will drift, re-scope, and chase the whole goal: precisely the runaway we are trying to avoid.

Therefore:

- The sub-agent's **objective** = the orchestrator's `instructions`, nothing more.
- The **seed context** is strictly **background information**: where it is working (working directory), the available environment/toolchain, and at most neutral situational facts. It is labeled as reference, with explicit framing along the lines of: *"The following is background context only. Your task is defined by the instructions you were given above, not by this context."*
- We lean **minimal**. When in doubt, leave it out of the seed; the orchestrator can always put what matters into `instructions`.
- The orchestrator's persona is inherited automatically (Cortex copies the parent system prompt), so the sub-agent already sounds like the entity without any goal injection.

---

## Workstreams

### WS1 — Cortex harness extensions (general-purpose) — `cortex-mono`

All additions are phrased as harness-generic capabilities a Cortex consumer would want, not Animus features.

- **W1.1 Pre-spawn hook.** Add `onBeforeSubAgentSpawn?(req) => Augmentation | Promise<Augmentation>` invoked inside `createChildAgent` (cortex-agent.ts:4090) before the child is built. `req = { taskId, instructions, background, requestedTools?, requestedSystemPrompt? }`. `Augmentation = { systemPrompt?, seedContext?, tools?, metadata? }`. `seedContext` is injected as the child's initial context slot. This single seam lets any consumer persist a record, curate the child's starting context, and attach correlation metadata.
- **W1.2 Opaque metadata round-trip.** Add `metadata?: Record<string, unknown>` to `TrackedSubAgent` (set from the pre-spawn hook), and echo it back in `onCompleted` / `onFailed` (`SubAgentLifecycleHooks`, sub-agent-manager.ts:25). Cortex never interprets it.
- **W1.3 Introspection getter.** Add `getActiveSubAgents(): SubAgentSnapshot[]` returning the safe subset of `TrackedSubAgent`: `{ taskId, instructions, background, spawnedAt, status, toolCount, lastToolName, lastToolSummary, lastToolStartedAt, liveCostUsd, metadata }`. The manager already records most of this (`updateToolActivity`, sub-agent-manager.ts:157); `liveCostUsd` comes from the child's budget guard.
- **W1.4 In-flight cost exposure.** Ensure each tracked child's live cost (`childAgent.getBudgetGuard().getTotalCost()`) is readable for W1.3 so consumers can account for in-flight spend.

### WS2 — Animus delegation wiring — `backend`

- **W2.1 Keep `SubAgent` tool enabled** (default; cortex-mind.ts never sets `enableSubAgentTool`). Confirm `maxConcurrentSubAgents` (Cortex default 4) is the value we want; make it a setting if needed.
- **W2.2 Implement `onBeforeSubAgentSpawn`** in the orchestrator wiring (agent-orchestrator.ts): insert the `agent_tasks` row (taskId, description from `instructions`, tickNumber, contactId from current tick, parentTaskId if resolvable from the active task context), return `{ metadata: { animusTaskId: taskId }, seedContext }` where `seedContext` is the minimal background block (working dir, environment) per the seed-context rules. Move the row-insertion logic here from `spawnCortexSubAgent`.
- **W2.3 Completion routing stays.** `onSubAgentCompleted` / `onSubAgentFailed` already update the row and fire the `agent_complete` tick (wireCortexLifecycleHooks, agent-orchestrator.ts:159). Correlate via `metadata`.
- **W2.4 Running-agents ephemeral section.** Add a `── RUNNING SUB-AGENTS ──` section near the top of `buildEphemeralSections` (cortex-pipeline.ts:1425), sourced from `cortexAgent.getActiveSubAgents()` (live activity: what each one is doing right now, elapsed, live cost). This is the visibility fix.
- **W2.5 Delegation guidance.** A dedicated, generic "When to delegate" section in the system prompt (context-builder.ts) plus tool framing: delegate work that needs many sequential tool calls, spans more than a tick, or can run in parallel. Explicitly **not** "every goal needs an agent." Prefer background mode for long work.
- **W2.6 Fully remove `spawn_agent` decision.** Strip: the `spawn_agent` case from the decision reference (context-builder.ts:355), the handler (agent-decision-handlers.ts:16), the entry in `restrictedDecisionTypes` (decision-executor.ts:60) and `permission-enforcer.ts`, the `execute-output.ts:440` filter reference, `spawnAgent`/`spawnCortexSubAgent` in the orchestrator if no longer used by any path, the `agent-orchestration.md` references, and associated tests. Verify nothing else dispatches it.

### WS3 — Budget integration — `backend`

- **W3.1 Count in-flight sub-agent spend.** Extend `BudgetService.getCurrentSpend` / `getBudgetStatus` (budget-service.ts) to add the sum of live sub-agent cost from `getActiveSubAgents()` to the logged `agent_usage` spend. Without this, a long background sub-agent accrues no recorded spend until completion, so the cap cannot see a runaway.
- **W3.2 Gate spawning on hard-stop.** When `shouldAllowTick` would hard-stop (>=95%), block new sub-agent spawns (return a clear tool error so the model knows to wait), and surface budget pressure in the running-agents/budget context so the mind can wind sub-agents down.
- **W3.3 Confirm completion accounting is not double-counted** once in-flight accounting exists (in-flight estimate replaced by the logged row at completion).

### WS4 — Context structure — `backend`

- **W4.1 Move goals + tasks to the top of `buildEphemeralSections`** (before Date/Time), and remove `goals` / `tasks` from `MIND_SLOT_NAMES` (cortex-mind.ts:96) and their `setSlot` calls (cortex-mind.ts:1540-1571). Keeps the slot region a stable cache anchor; protects cached history on message ticks.

### WS5 — Caching — `cortex-mono` (+ thin Animus wiring)

- **W5.1 Thread a stable `sessionId`** into Cortex completion options (`buildDirectCompletionOptions`, cortex-agent.ts:835, and the agentic-loop path) so pi-ai emits `prompt_cache_key` (and reuses the Codex websocket session context). Stable for the mind (shared system+slots prefix across ticks); distinct per sub-agent. This is a general-purpose Cortex capability (let the consumer set a cache/session key).
- **W5.2 No retention change** for gpt-5.5 (24h default-on). Document the latent gap: pi-ai sends no `prompt_cache_retention`, so a future non-5.5 Codex model would not get extended retention without an upstream pi-ai change. Out of scope now.

### WS6 — Glob stack overflow — `cortex-mono`

- **W6.1 Fix** the recurring `Glob` "Maximum call stack size exceeded" in Cortex's built-in Glob tool (likely unbounded recursion or a symlink cycle on a large tree). Replace recursion with an iterative walk plus a depth/visited guard. Lower priority but a real source of wasted turns.

---

## Sequencing

1. **WS1 + WS2 + WS3** together (the delegation spine and its guardrails). This is the highest-leverage change and the reason for the whole effort.
2. **WS4** (context structure): small, independent.
3. **WS5** (caching): small, independent; can land anytime.
4. **WS6** (Glob): independent cleanup.

Tier-3 "resume a compacted session for continuing-task ticks" remains deferred. If the delegation spine works, the persistent background sub-agent **is** the durable session, and re-derivation moves off the mind entirely.

---

## Files in scope

**cortex-mono** (`packages/cortex/src/`)
- `sub-agent-manager.ts` — metadata on `TrackedSubAgent`, hook signature additions, snapshot accessor.
- `cortex-agent.ts` — `onBeforeSubAgentSpawn` invocation in `createChildAgent` (~4090), seedContext injection, `getActiveSubAgents()`, sessionId in completion options (~835).
- `tools/sub-agent.ts` — tool description tuning if needed (generic only).

**animus/packages/backend/src/**
- `heartbeat/agent-orchestrator.ts` — pre-spawn hook impl, row insertion move, in-flight cost source.
- `heartbeat/cortex-pipeline.ts` — running-agents ephemeral section; goals/tasks relocation.
- `heartbeat/cortex-mind.ts` — `MIND_SLOT_NAMES` edit; pass stable sessionId; populateContextSlots edit.
- `heartbeat/context-builder.ts` — delegation guidance; remove `spawn_agent` from decision ref.
- `heartbeat/agent-decision-handlers.ts`, `decision-executor.ts`, `execute-output.ts`, `contacts/permission-enforcer.ts` — strip `spawn_agent`.
- `services/budget-service.ts` — in-flight sub-agent spend + spawn gating.
- `docs/architecture/agent-orchestration.md` — update to the single-path model.

---

## Open questions for build

- **seedContext shape**: exact minimal contents (working dir + environment confirmed; anything else stays out unless justified) and the precise reference framing string.
- **sessionId identity for the mind**: a single stable constant vs. per-provider-session id; confirm it maximizes prefix sharing without colliding across logically distinct contexts.
- **In-flight cost sampling cadence**: live read on each budget query vs. periodic snapshot; ensure no double counting at completion.
- **`maxConcurrentSubAgents`**: keep Cortex default (4) or expose as an Animus setting.

---

## Testing

- Cortex: unit tests for the pre-spawn hook (augmentation applied, metadata round-trips through complete/fail), `getActiveSubAgents()` shape, sessionId passed to the provider options.
- Animus: sub-agent spawn creates a tracked `agent_tasks` row via the hook; running-agents section renders from live snapshot; budget reflects in-flight sub-agent spend and gates spawns at hard-stop; `spawn_agent` decision is fully gone (no references, type-check and tests green).
- Regression: confirm a background sub-agent survives across ticks and its `agent_complete` tick fires with correlated metadata.
