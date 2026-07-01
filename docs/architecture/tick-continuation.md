# Tick Continuation: Interruptible Settling for Conversational Responsiveness

> **STATUS**: Approved, in progress.
> The Cortex foundation (abortable direct completions) is **implemented** in `@animus-labs/cortex`. The Animus pipeline integration described here is **pending**.
>
> **See also**: `docs/architecture/heartbeat.md` (tick pipeline, tick queue), `docs/architecture/context-builder.md`, and the Cortex framework docs in the cortex-mono repository.

## The problem

A tick is processed to completion before the next one for the same contact can start. The `TickQueue` is strictly serial per contact: a message that arrives while a tick is running is stored as a pending follow-up and only enqueued after the current tick's processor fully resolves (`tick-queue.ts`, `enqueueMessage` → `pendingFollowUps`).

That processor includes the post-reply phases. In low-latency mode the reply is streamed during the agentic loop, but the tick does not finish there: the deferred THOUGHT and then REFLECT still run synchronously inside the tick (`cortex-pipeline.ts`, `executeCortexPipeline`), and REFLECT is a single structured call on the primary model. On a production instance running Opus 4.6, REFLECT measured 13-52s (avg ~30s). THOUGHT adds another 5-8s.

So a follow-up utterance in a live conversation waits for the previous turn's full inner-life processing before it even begins. In one measured exchange, a voice command finished transcription but sat ~14s behind the prior tick's REFLECT before its own agentic loop could start. The reply itself is fast; the wait is the previous tick settling.

This is not specific to voice. It affects every channel where a person sends messages in quick succession. The fix is general.

## The decision

- **Applies to all message ticks**, not just voice or low-latency ticks. Quick back-and-forth is the common case across channels.
- **No upper bound on re-entries.** A human will not stream messages indefinitely; the exchange always settles. We do not add a safety valve to force a reflect checkpoint mid-burst.
- **The primary model is the user's choice and stays as-is.** This work improves responsiveness within whatever model the user selected. It does not downgrade THOUGHT or REFLECT to a smaller model.

## Core idea

Treat the post-reply phases (deferred THOUGHT + REFLECT) as an interruptible **settling** stage, not committed work. A new message from the same contact during settling means the conversational beat is not over, so we **abort settling and re-enter the agentic loop within the same tick**, carrying all prior context. REFLECT and EXECUTE commit only when the exchange actually settles, meaning no inbound message arrived during the settling window.

This is a faithful reading of the heartbeat metaphor: one tick spans the whole exchange, and reflection is the exhale at the end of it. It is also higher quality and cheaper than the status quo. One coherent reflection covers the whole burst instead of a half-formed mid-burst reflection that the next message immediately makes stale, and we stop paying for reflections we throw away.

### Why interrupt-and-reopen, not run-in-parallel

The mind is a single persistent `CortexAgent`. We must never run REFLECT's persistence concurrently with a second tick. `coreSelfUpdate` and `workingMemoryUpdate` are whole-blob replacements; two ticks doing read-modify-write on the same singleton identity and relationship state would produce lost updates and an incoherent emotional baseline. Interrupt-and-reopen keeps the mind single-threaded, which sidesteps all of that.

## What already exists

Most of the machinery is in place; this is an extension, not a new system.

- **Phase-routed injection.** `messageInjectionHandler` (`heartbeat/index.ts`) already branches on the current pipeline phase. During `agentic-loop` it calls `cortexAgent.steer()` to fold a live message into the running loop; during `thought` it queues the message into `pendingInjections` for the loop start. During `reflect`/`execute` it deliberately does nothing and lets the TickQueue make a new tick. That fall-through is the gap.
- **Deferred persistence.** The reply is streamed per-turn during the agentic loop and the session history is saved at loop end, but THOUGHT and REFLECT results are held in memory and only written in EXECUTE. Abandoning thought/reflect before EXECUTE is therefore side-effect-free. This is the key enabler and it is already true.
- **Persistent agent.** The mind agent and its conversation history persist across ticks, so re-entering the loop is just running it again on the same warm agent and history.

## Design

### The settling stage

Restructure the tail of `executeCortexPipeline` so the post-reply phases run inside a re-entrant loop:

```
capture burstStartHistoryLength   // once, before the FIRST agentic loop of the burst
inputs = pendingInjections

loop:
  agenticResult = runAgenticLoop(inputs)        // reply streams per-turn

  settle = new AbortController()
  arm settling: a same-contact inbound message →
      record it, settle.abort()

  try:
    if (thought deferred) thought = runThought({ signal: settle.signal })
    reflect = runReflect(
        turnsSince(burstStartHistoryLength),
        { signal: settle.signal })
  catch (AbortError):
    inputs = [the interrupting message]
    thought = null
    continue          // re-enter the agentic loop, same tick, same burst boundary

  break               // settled

runExecute(thought, reflect)   // commit once, covering the whole burst
```

### Burst history boundary

REFLECT currently reflects over `history.slice(preLoopHistoryLength)` captured per loop. For the final reflection to cover the whole exchange, capture the boundary **once** at the first loop of the burst and keep it across re-entries. Otherwise the eventual reflect would only see the last message.

### Cancellation (Cortex dependency, implemented)

Cancelling an in-flight THOUGHT/REFLECT requires aborting a direct completion. `CortexAgent.abort()` only stops the agentic loop; the direct-completion methods did not receive a signal. This has been addressed in Cortex (see below). The pipeline creates a per-settling `AbortController` and passes `{ signal }` to `structuredComplete`; on an interrupting message it calls `settle.abort()`, and the reflect/thought call rejects with an `AbortError` that the settling `catch` handles as "re-enter the loop."

### TickQueue coordination

An inbound message reaches the engine on two paths: the event bus (`message:received`, which `messageInjectionHandler` listens to) and `tickQueue.enqueueMessage` (which stores a `pendingFollowUp` for a new tick). When the settling-reopen path claims a message, it must consume the matching pending follow-up for that contact so the same message does not also spawn a redundant tick after the burst ends. This is the fiddliest part and needs a small coordination API on the TickQueue (for example, "a message with this id was handled inline").

### Side-effect safety

Re-entry is clean because all durable writes are already ordered correctly:

| Effect | When | Safe to abort settling? |
|---|---|---|
| Reply to user | streamed per-turn during the agentic loop | Already delivered; nothing to undo |
| Session/conversation history | saved at agentic-loop end | Persisted before settling; re-entry appends |
| Thought, experience, emotions, memory, working-memory, core-self, decisions | EXECUTE only | Not yet written; abandoning is a no-op |

### Inner-state staleness (accepted)

During a burst, each re-entry runs without updated emotion/working-memory state from the prior turns, because EXECUTE has not run yet. The agent still has the full conversation in its history, so functionally nothing is lost; emotionally, the reactions land together at burst end rather than evolving turn by turn. For conversational exchanges this is the right tradeoff and is accepted by design.

## Cortex foundation (implemented)

Implemented in `@animus-labs/cortex` (`packages/cortex/src/cortex-agent.ts`), kept fully general-purpose per the framework's boundary rules.

- `DirectCompletionOptions` gains an optional `signal?: AbortSignal`.
- `directComplete`, `structuredComplete`, and `utilityComplete` forward the signal to pi-ai's `complete()` (pi-ai supports `signal` natively and resolves with stopReason `'aborted'`).
- A `throwIfAborted` guard runs before the silent-error check and surfaces cancellation as a standard `AbortError` (an `Error` whose `name` is `'AbortError'`), checking both the resolved stopReason and the caller's signal so a result that resolves a beat after abort is still discarded.
- Covered by unit tests in `cortex-agent-model-contract.test.ts` (signal forwarding, and `AbortError` on both result-reported and pre-aborted-signal cases). Full cortex suite green.

This is the "extend Cortex, never fork" path: abortable direct completions are useful to any consumer, not just Animus.

## Implementation plan (Animus side)

1. Thread a settling `AbortController` into `executeThought`/`executeReflect` and pass `{ signal }` to the underlying `structuredComplete` calls.
2. Refactor the post-loop tail of `executeCortexPipeline` into the re-entrant settling loop, capturing the burst history boundary once.
3. Extend `messageInjectionHandler`'s reflect/settling branch to record the message and abort the settling controller instead of falling through to the TickQueue.
4. Add TickQueue coordination so an inline-claimed message does not also spawn a follow-up tick.
5. Tests: a message during settling re-enters the loop and produces a second reply within the same tick; a settled exchange commits exactly one REFLECT/EXECUTE covering the whole burst; no duplicate follow-up tick.

## Non-goals

- No mid-burst reflect checkpoint / safety valve.
- No change to the user-selected primary model.
- No concurrent ticks on the mind agent.
