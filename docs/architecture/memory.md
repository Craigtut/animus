# Animus: Memory System

> **Status: Under Construction** — This document outlines the design questions and requirements for the memory system. Detailed design is pending.

## Overview

The memory system gives Animus persistent, retrievable knowledge beyond the immediate conversation context. It bridges the gap between short-term context (what's in the current mind session) and long-term retention (everything Animus has ever experienced). Without a memory system, the mind can only work with what fits in its context window for the current tick.

## Design Questions

### What Gets Stored as Memory?

- **Thoughts** — Already persisted to `heartbeat.db`. Which thoughts graduate to long-term memory?
- **Experiences** — Already persisted to `heartbeat.db`. How are experiences consolidated into retrievable memories?
- **Conversation Summaries** — Should conversations be summarized and stored as memories?
- **Learned Facts** — Information about contacts, preferences, recurring topics
- **Sub-Agent Results** — Key findings from delegated research or tasks
- **Goal Outcomes** — What happened when goals were pursued, what worked and what didn't

### Embedding Strategy

- Which embedding model to use (and whether it runs locally or via API)
- What gets embedded — raw text, summaries, or structured representations
- Chunking strategy for longer content
- When embeddings are generated (at write time, background job, or on-demand)
- Storage in LanceDB (already in the tech stack for this purpose)

### Retrieval

- How the GATHER CONTEXT stage selects relevant memories for the current tick
- Similarity search vs. recency vs. importance-weighted retrieval
- Context budget allocation — how much of the mind's context window is reserved for memories
- Query construction — what signal drives memory retrieval (trigger context, recent thoughts, active goals)

### Consolidation

- How raw thoughts/experiences get summarized into higher-level memories over time
- Whether consolidation happens during ticks, in background processes, or on a schedule
- Forgetting — whether low-importance memories decay or get pruned
- Deduplication — handling repeated similar experiences

### Context Budget

- How memories compete with other context (emotions, recent thoughts, messages, active goals) for space in the mind's context window
- Priority ordering when context is tight
- Whether memory retrieval is adaptive (more memories when idle, fewer when busy)

## Data Model (Preliminary)

To be designed. Likely includes:

- **memories** table — Consolidated memory records with content, importance, timestamps, source references
- **LanceDB collection** — Vector embeddings for similarity search, linked to memory records by ID

## Related Documents

- `docs/architecture/heartbeat.md` — The tick pipeline where memories are gathered and new ones are created
- `docs/architecture/persona.md` — Personality shapes what is considered important/memorable
- `docs/architecture/tech-stack.md` — LanceDB is the chosen vector database
