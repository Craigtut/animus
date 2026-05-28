# Agent Orchestration Architecture

> **Status**: Implemented with Cortex sub-agents

How the mind delegates work to sub-agents, tracks their lifecycle, and delivers results back to the user.

## Current Runtime

Sub-agents are managed through Cortex. The backend owns Animus-specific orchestration, persistence, contact permissions, and result delivery. Cortex owns the active agent sessions and the `SubAgentManager` runtime.

The retired `@animus-labs/agents` subprocess SDK stack is not used for active sub-agent orchestration.

## When To Delegate

The mind should handle simple, quick work directly and delegate work that would block the heartbeat or consume too much context.

**Handle directly:**

- simple questions answerable from current context
- quick lookups or status checks
- brief conversational exchanges
- tasks where sub-agent startup overhead exceeds the task

**Delegate to a sub-agent:**

- research requiring several searches or tool calls
- multi-step workflows with dependencies
- code generation or multi-file edits
- analysis that needs a long working context
- tasks where the user explicitly asks Animus to go work on something

Spawning happens **in-loop** via Cortex's built-in `SubAgent` tool: the moment
the mind recognizes large or parallelizable work, it calls the tool (preferring
background mode for long work) rather than waiting until the REFLECT phase. The
legacy reflect-phase `spawn_agent` decision has been removed. The `update_agent`
and `cancel_agent` decisions remain (REFLECT phase) and are restricted to the
primary contact.

## Core Flow

```
GATHER
  -> includes running sub-agent status and completed results
     (the agentic loop also receives Cortex's live <background-tasks> block)

AGENTIC LOOP
  -> mind calls the SubAgent tool to delegate work (foreground or background)
  -> Cortex onBeforeSubAgentSpawn fires -> backend records the agent_tasks row
  -> mind may also produce update_agent / cancel_agent decisions (in REFLECT)

EXECUTE
  -> validates contact permissions (update_agent / cancel_agent)
  -> calls AgentOrchestrator for steering / cancellation
  -> sends user-facing messages when appropriate

Cortex SubAgentManager
  -> owns active sub-agent sessions
  -> emits lifecycle updates (onSpawned / onCompleted / onFailed)
  -> returns completion results

agent_complete trigger
  -> wakes the heartbeat
  -> mind synthesizes result for the user
```

## Key Backend Files

| File | Purpose |
|------|---------|
| `packages/backend/src/heartbeat/agent-orchestrator.ts` | Animus wrapper around Cortex `SubAgentManager`, decision handling, persistence hooks |
| `packages/backend/src/heartbeat/cortex-mind.ts` | Creates CortexAgent and wires tools, skills, permissions, and MCP |
| `packages/backend/src/heartbeat/decision-executor.ts` | Executes mind decisions and applies contact permission gates |
| `packages/backend/src/db/migrations/heartbeat/006_agent_orchestration.sql` | Sub-agent task/session persistence |
| `packages/backend/tests/heartbeat/agent-orchestrator.test.ts` | Orchestrator behavior tests |

## Updates And Cancellation

The mind can send new information to a running sub-agent through an `update_agent` decision. The orchestrator forwards that update to Cortex so it becomes part of the sub-agent's conversation.

Every spawn (via the in-loop `SubAgent` tool) is recorded in `agent_tasks`
through Cortex's `onBeforeSubAgentSpawn` hook (`recordSubAgentSpawn` in
`cortex-mind.ts`), keyed by the Cortex task id. When the sub-agent completes,
the `onSubAgentCompleted` lifecycle hook updates that row and the
`agent_complete` tick includes the completion result, letting reflection fold
the returned findings back in. A sub-agent's task is defined solely by its
instructions; it does not inherit the mind's broader goals.

Cancellation is handled through Cortex when possible. If a sub-agent cannot be stopped cleanly, Animus stops tracking it, marks the task state accordingly, and lets the next heartbeat tick reason over the outcome.

## Crash Recovery

On startup, the orchestrator checks persisted running tasks and reconciles them with Cortex state:

- completed during downtime: store result and trigger `agent_complete`
- missing or failed: mark failed and let the next tick observe it
- still running: reattach tracking

The goal is safe recovery, not replaying partially completed work.

## Design Notes

Sub-agents carry the same Animus persona and user context, but they are scoped to a specific delegated task. They can send meaningful progress updates, but they should not narrate every internal step. The mind remains the top-level orchestrator and synthesizes final results for the user.
