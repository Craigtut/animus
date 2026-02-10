# Open Concerns

Known architectural concerns that are acceptable for now but may need attention in the future.

## 1. Interval Timer Reset on Every Tick

**Behavior:** `tickQueue.resetInterval()` fires after every tick completion (including message-triggered, agent_complete, and scheduled_task ticks), which resets the idle timer countdown.

**Impact:** During sustained conversation, idle ticks get starved — deferred tasks, seed reinforcement, and memory consolidation that rely on idle ticks don't run. If a user sends messages every 3 minutes with a 5-minute heartbeat interval, no interval tick ever fires.

**Current Status:** Acceptable. Idle processing is lower priority than responsive conversation. In practice, conversations have natural pauses where idle ticks will fire.

**Future Consideration:** Options include:
- A separate idle timer that isn't reset by interactive ticks
- A periodic forced idle tick (e.g., "at least one idle tick per 30 minutes regardless of activity")
- Counting non-idle ticks and forcing an idle tick after N interactive ticks

## 2. Persona Recompile Race Condition

**Behavior:** `recompilePersona()` replaces a module-level `compiledPersona` variable synchronously. If called while `mindQuery()` is building context (which also reads `compiledPersona`), theoretically the persona could change mid-tick.

**Assessment:** Very unlikely in practice. This is a single-user app where persona editing is a deliberate Settings page action, not something happening during active conversation. The race window is tiny — persona recompile is a synchronous operation that replaces a module-level variable, and the read in `mindQuery()` captures the reference at the start.

**Decision:** No code fix needed. The risk is negligible for a single-user application.
