# Animus: Mind System Prompt

> **Status: TODO** — This document needs to be fully designed.

## Overview

The mind's system prompt is the compiled instruction set that shapes how Animus thinks, decides, and responds during each heartbeat tick. It combines the persona prompt (compiled from persona configuration) with operational instructions that tell the mind how to process context, produce structured output, and make decisions.

## TODO

The following areas need to be designed:

- **Prompt Structure** — How the system prompt is assembled (persona section + operational section + output format instructions)
- **Operational Instructions** — Rules for how the mind should think, what decisions it can make, and how to format its structured output
- **Persona Integration** — How the compiled persona prompt (from `docs/architecture/persona.md`) is injected into the system prompt
- **Contact-Aware Context** — How the mind is instructed to handle contact permissions, message isolation, and cross-contact disclosure boundaries
- **Emotion Instructions** — How the mind is guided to produce emotion deltas (format, magnitude constraints, reasoning requirements)
- **Decision Type Reference** — Documentation of all available decision types (reply, spawn_agent, update_agent, schedule_task, etc.) and their schemas
- **Sub-Agent Delegation Guidelines** — When to delegate vs. handle directly, how to frame sub-agent tasks
- **Output Schema Reference** — The MindOutput structured output format the mind must produce (see `docs/architecture/heartbeat.md`, Mind Query section)
- **Warm Session Continuity** — How the prompt handles warm sessions where prior tick context is already in the conversation

## Related Documents

- `docs/architecture/heartbeat.md` — The tick pipeline that invokes the mind
- `docs/architecture/persona.md` — Persona compilation into prompt text
- `docs/architecture/agent-orchestration.md` — Sub-agent delegation patterns
- `docs/architecture/contacts.md` — Contact permissions and message isolation
