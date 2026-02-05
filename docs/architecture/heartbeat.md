# The Heartbeat System

The heartbeat is the foundational mechanism that gives Animus its "life." It's a continuous tick system that drives all internal processes, creating the illusion of a persistent, thinking entity.

## Concept

Traditional AI assistants are stateless - they wake when called and sleep when dismissed. Animus is different. The heartbeat ensures Animus is always running, always thinking, always *being* - whether or not anyone is watching.

Think of it like a biological heart pumping blood in a steady rhythm. The heartbeat pumps *time* through Animus. Each tick triggers a cascade of cognition: thoughts form, experiences emerge, emotions shift, memories consolidate, and agency considers action.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `heartbeatIntervalMs` | 300000 (5 min) | Time between ticks |
| `thoughtRetentionDays` | 30 | How long thoughts persist |
| `experienceRetentionDays` | 30 | How long experiences persist |
| `emotionRetentionDays` | 7 | How long emotions persist |

## The Pipeline

Each heartbeat tick executes a sequential pipeline of phases:

```
┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐
│  PERCEIVE │ → │   THINK   │ → │   FEEL    │ → │  DECIDE   │
└───────────┘   └───────────┘   └───────────┘   └───────────┘
      ↓
┌───────────┐   ┌───────────┐   ┌───────────┐
│    ACT    │ → │  REFLECT  │ → │CONSOLIDATE│
└───────────┘   └───────────┘   └───────────┘
```

### Phase Details

#### 1. PERCEIVE
Gather inputs and observe the environment.
- Check for new messages from users
- Review pending tasks
- Check calendar/scheduled events
- Observe any environmental triggers

#### 2. THINK
Process information and generate thoughts.
- Call the agent SDK with current context
- Generate observations, reflections, intentions
- Consider active goals and tasks
- Form questions that need answers

#### 3. FEEL
Evaluate emotional state based on current context.
- Process the emotional valence of recent experiences
- Update current emotional state
- Consider how emotions should influence decisions

#### 4. DECIDE
Determine if any action should be taken.
- Evaluate whether proactive action is warranted
- Check guardrails and constraints
- Decide on communication priorities
- Queue actions for execution

#### 5. ACT
Execute decided actions.
- Send messages if needed
- Perform scheduled tasks
- Update external systems
- Log all actions taken

#### 6. REFLECT
Review what happened this tick.
- Assess outcomes of actions
- Note unexpected results
- Update internal models
- Generate reflective thoughts

#### 7. CONSOLIDATE
Memory management and cleanup.
- Delete expired thoughts, experiences, emotions
- Potentially compress older memories
- Update long-term memory structures
- Prepare state for next tick

## Crash Recovery

The heartbeat system is designed to survive crashes gracefully.

### How It Works

1. Before each phase, the current progress is persisted to SQLite:
   ```sql
   UPDATE heartbeat_state SET
     tick_number = ?,
     current_phase = ?,
     pipeline_progress = ?  -- JSON array of completed phases
   WHERE id = 1;
   ```

2. If the server crashes mid-tick and restarts:
   ```typescript
   if (state.pipelineProgress.length > 0 && state.currentPhase !== 'idle') {
     // Resume from where we left off
     await executeTick();
   }
   ```

3. The tick resumes from the next uncompleted phase.

### State Schema

```sql
CREATE TABLE heartbeat_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- Singleton
  tick_number INTEGER NOT NULL DEFAULT 0,
  current_phase TEXT NOT NULL DEFAULT 'idle',
  pipeline_progress TEXT NOT NULL DEFAULT '[]',  -- JSON array
  started_at TEXT NOT NULL,
  last_tick_at TEXT,
  is_running INTEGER NOT NULL DEFAULT 0
);
```

## Data Generated

Each tick can generate various types of data:

### Thoughts
```typescript
interface Thought {
  id: UUID;
  tickNumber: number;
  content: string;
  type: 'observation' | 'reflection' | 'intention' | 'question' | 'insight';
  createdAt: Timestamp;
  expiresAt: Timestamp | null;
}
```

### Experiences
```typescript
interface Experience {
  id: UUID;
  tickNumber: number;
  description: string;
  emotionalValence: number;  // -1 to 1
  salience: number;          // 0 to 1 (importance)
  createdAt: Timestamp;
  expiresAt: Timestamp | null;
}
```

### Emotions
```typescript
interface Emotion {
  id: UUID;
  tickNumber: number;
  name: string;
  intensity: number;  // 0 to 1
  createdAt: Timestamp;
  expiresAt: Timestamp | null;
}
```

### Actions
```typescript
interface Action {
  id: UUID;
  tickNumber: number;
  type: string;
  description: string;
  result: string | null;
  createdAt: Timestamp;
}
```

## TTL and Cleanup

Expired data is automatically cleaned up during the CONSOLIDATE phase:

```typescript
async function cleanupExpiredEntries(): Promise<void> {
  const now = new Date().toISOString();

  // Clean up expired thoughts
  db.prepare(`
    DELETE FROM thoughts WHERE expires_at IS NOT NULL AND expires_at < ?
  `).run(now);

  // Clean up expired experiences
  db.prepare(`
    DELETE FROM experiences WHERE expires_at IS NOT NULL AND expires_at < ?
  `).run(now);

  // Clean up expired emotions
  db.prepare(`
    DELETE FROM emotions WHERE expires_at IS NOT NULL AND expires_at < ?
  `).run(now);
}
```

## API

### Control

```typescript
// Start the heartbeat
startHeartbeat(): void

// Stop the heartbeat
stopHeartbeat(): void

// Manually trigger a tick (for testing/debugging)
triggerTick(): Promise<void>
```

### Query

```typescript
// Get current state
getHeartbeatState(): HeartbeatState

interface HeartbeatState {
  tickNumber: number;
  currentPhase: HeartbeatPhase;
  pipelineProgress: HeartbeatPhase[];
  startedAt: Timestamp;
  lastTickAt: Timestamp | null;
  isRunning: boolean;
}
```

## Real-time Monitoring

The frontend can subscribe to heartbeat updates via tRPC subscriptions:

```typescript
// Backend
onHeartbeat: publicProcedure.subscription(() => {
  return observable<HeartbeatState>((emit) => {
    const onTick = () => emit.next(getHeartbeatState());
    heartbeatEmitter.on('tick', onTick);
    return () => heartbeatEmitter.off('tick', onTick);
  });
});

// Frontend
const { data: heartbeat } = trpc.onHeartbeat.useSubscription();
```

## Future Considerations

1. **Variable Tick Rate**: Adjust heartbeat speed based on activity level
2. **Sleep Mode**: Reduced tick rate during quiet hours
3. **Burst Mode**: Faster ticks when actively engaged
4. **Multi-Phase Parallelism**: Run independent phases concurrently
5. **Distributed Processing**: Offload heavy computation to worker threads
