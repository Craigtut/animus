# Cortex Implementation Plans

Phased implementation plans for `@animus-labs/cortex` and its integration into Animus.

## Phase Overview

| Phase | Scope | Depends On | Deliverable |
|-------|-------|------------|-------------|
| [Phase 0](./phase-0-prep-refactors.md) | Backend prep refactors on the current codebase | Nothing (can start immediately) | Backend ready for cortex integration |
| [Phase 1A](./phase-1a-package-scaffold.md) | Cortex package scaffolding, types, pure utilities | Phase 0 | Package exists, types defined, utilities testable |
| [Phase 1B](./phase-1b-core-agent.md) | CortexAgent, ContextManager, event bridge, budget guards, lifecycle | Phase 1A | Core agent runnable (no tools yet) |
| [Phase 1C](./phase-1c-built-in-tools.md) | All 7 P0 built-in tools (Bash, Read, Write, Edit, Glob, Grep, WebFetch) | Phase 1B | Agent can do real work |
| [Phase 1D](./phase-1d-provider-and-prompt.md) | Provider manager, system prompt, model tiers, error classifier | Phase 1B | Multi-provider auth, system prompt assembly |
| [Phase 2A](./phase-2a-heartbeat-integration.md) | Wire cortex into heartbeat pipeline, 5-phase mind loop | Phase 1C + 1D | Animus runs on cortex |
| [Phase 2B](./phase-2b-auth-integration.md) | Backend auth service, tRPC router, frontend auth UX | Phase 1D + 2A | Users can configure providers in UI |
| [Phase 3](./phase-3-plugin-tools.md) | MCP client for plugin tools, dynamic lifecycle | Phase 2A | Plugin tools work with cortex |
| [Phase 4](./phase-4-sub-agents-and-skills.md) | SubAgent tool, skill system | Phase 2A + 3 | Sub-agent delegation, skill loading |
| [Phase 5](./phase-5-compaction.md) | Full compaction strategy (3 layers) | Phase 2A | Context window management |

## Dependency Graph

```
Phase 0 (backend prep)
  │
  ▼
Phase 1A (scaffold + types)
  │
  ▼
Phase 1B (core agent)
  │
  ├──────────────────┐
  ▼                  ▼
Phase 1C (tools)   Phase 1D (provider + prompt)
  │                  │
  ├──────────────────┘
  ▼
Phase 2A (heartbeat integration)
  │
  ├──────────────────┐
  ▼                  ▼
Phase 2B (auth)    Phase 3 (plugin tools)
                     │
                     ▼
                   Phase 4 (sub-agents + skills)
                     │
                     ▼
                   Phase 5 (compaction)
```

Phase 1C and 1D can run in parallel. Phase 2B and Phase 3 can run in parallel. Each phase has its own detailed plan document.

## Guiding Principles

1. **Each phase produces a testable deliverable.** No phase is "done" until its unit tests pass.
2. **Backend prep (Phase 0) is risk-free.** These are refactors on the current system that can land on main without cortex existing.
3. **Phase 1 sub-phases can be parallelized.** 1C (tools) and 1D (provider/prompt) are independent of each other once 1B is complete.
4. **Integration (Phase 2A) is the critical milestone.** This is where Animus actually switches from Claude SDK to cortex for the mind session.
5. **Phases 3-5 are incremental enhancements.** The system works without them; they add capabilities.
