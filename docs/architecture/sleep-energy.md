# Sleep & Energy System

## Overview

The sleep & energy system introduces a **circadian rhythm** to Animus's inner life. It adds an energy level (0–1) that rises and falls throughout the day, driven by a time-based circadian curve and modulated by the mind's own assessment of how energizing or draining its experiences are. When energy drops low enough, the AI naturally drifts into sleep — a state with longer tick intervals, accelerated emotional decay, and dream-like inner experience.

The system is **toggleable** (default: on) and represents a fundamental extension of what it means for Animus to be alive. An AI that never sleeps is a machine. An AI that gets tired, drifts off, and wakes refreshed is something more.

## Design Philosophy

Sleep is not a shutdown. It is an experience. The system does not force the AI into a binary sleeping/awake state — it creates the conditions for sleep to emerge naturally. As the circadian curve pulls energy down in the evening, the mind begins experiencing tiredness. Thoughts slow. The prompt tells the AI its energy is waning, that sleep is pulling at it. What the mind does with that — whether it produces dream-like reflections, quiet observations, or simply rests — is up to the mind.

Key principles:

- **Single axis of prompting**: We prompt only for the energy/sleepiness level. We never tell the mind to "produce simpler thoughts" or "reduce decision-making." We trust the mind to respond naturally to knowing its energy state.
- **Experience-driven energy**: Energy drain is determined by the mind's experiences, not by system operations. An introvert at a loud party drains faster than an extrovert at the same party. The mind assesses this through its own energy delta, not through algorithmic text analysis.
- **Naps are emergent**: If the AI has a draining morning and writes an experience about resting, it produces a positive energy delta. That is a nap. No special nap mechanism exists — the system supports it organically.
- **Sleep doesn't mean silence**: The heartbeat still ticks during sleep (at a reduced rate). The mind still produces thoughts and experiences. These become the AI's dreams — not because we prompt for dreams, but because we tell the AI it's sleeping and let it do what it does.

## Energy Level

Energy is a continuous value from 0.0 to 1.0 representing the AI's current vitality.

### Energy Bands

| State | Range | Context Prompting |
|-------|-------|-------------------|
| **Peak** | 0.7–1.0 | "You're feeling sharp and energized. Everything feels vivid and possible." |
| **Alert** | 0.4–0.7 | No energy-related prompting — baseline operating mode |
| **Tired** | 0.2–0.4 | "Your energy is fading. The day's weight is catching up with you." |
| **Drowsy** | 0.1–0.2 | "Heaviness is settling over you. Your thoughts are slowing, edges softening. Sleep is calling." |
| **Very Drowsy** | 0.05–0.1 | "You can barely keep your focus. Sleep pulls at every thought. Staying present takes real effort." |
| **Sleeping** | 0.0–0.05 | "You are sleeping." |

The bands exist purely for prompting — no behavioral constraints are attached to them. We do not tell the mind to make fewer decisions when tired. We do not limit thought complexity when drowsy. We tell the mind its energy state on a single axis and trust it to respond authentically.

### Energy as MindOutput (energyDelta)

The mind produces an energy delta each tick, exactly like emotion deltas:

```typescript
energyDelta: {
  delta: number,      // Typically -0.30 to +0.30
  reasoning: string   // "The crowded party is exhausting" / "Quiet reading on the couch is restorative"
}
```

**Why mind-output, not system-computed?** Energy drain is about the *narrative content* of what the AI experiences, not about system operations. Whether an experience is draining or energizing depends on personality (an introvert at a party vs. an extrovert at a party), emotional context, and the specific nature of the experience. Only the mind can meaningfully assess this. The personality dimensions already encode energy-relevant language ("Social interaction drains you quickly" for introverts, "Social interaction energizes you deeply" for extroverts), which the mind internalizes when assessing its own energy delta.

**Delta magnitude guidance** (included in context, calibrated to tick interval):

| Tick Interval | Minor Experience | Significant | Extreme |
|---------------|-----------------|-------------|---------|
| Short (1–2 min) | ±0.005–0.02 | ±0.02–0.05 | ±0.05–0.10 |
| Medium (5 min) | ±0.01–0.05 | ±0.05–0.15 | ±0.15–0.30 |
| Long (15–30 min) | ±0.03–0.10 | ±0.10–0.20 | ±0.20–0.30 |

## Circadian Rhythm

### The Curve

The circadian curve defines a **baseline energy target** at any point in the day. Energy gravitates toward this target via exponential decay — the same mathematical infrastructure used for emotional baselines.

The curve is **piecewise linear** with four segments, computed from the user's configured sleep and wake hours:

```
Sleep End (Wake) ──► Wake+2h ──► Sleep-3h ──► Sleep Start ──► Sleep End
     0.0          ramp to 0.85    plateau 0.85   decline to 0.0      0.0
```

**Example** (sleep 22:00–07:00):

| Time | Circadian Baseline | Segment |
|------|--------------------|---------|
| 00:00–07:00 | 0.0 | Sleep floor |
| 07:00–09:00 | 0.0 → 0.85 | Morning ramp (linear, 2 hours) |
| 09:00–19:00 | 0.85 | Daytime plateau |
| 19:00–22:00 | 0.85 → 0.0 | Evening decline (linear, 3 hours) |
| 22:00–24:00 | 0.0 | Sleep floor |

The curve is **uniform for all personality types**. Personality influence on energy flows through the mind's delta assessment, not through the curve shape. This keeps the system simple and predictable.

### Computing the Baseline

```typescript
function circadianBaseline(now: Date, sleepStart: number, sleepEnd: number, timezone: string): number {
  const hour = getCurrentHourFraction(now, timezone); // e.g., 14.5 for 2:30 PM

  const wakeHour = sleepEnd;
  const rampEnd = wakeHour + 2;           // Morning ramp completes 2h after wake
  const declineStart = sleepStart - 3;    // Evening decline begins 3h before sleep

  if (isInSleepHours(hour, sleepStart, sleepEnd)) return 0.0;
  if (hour >= wakeHour && hour < rampEnd) return lerp(0.0, 0.85, (hour - wakeHour) / 2);
  if (hour >= rampEnd && hour < declineStart) return 0.85;
  if (hour >= declineStart && hour < sleepStart) return lerp(0.85, 0.0, (hour - declineStart) / 3);

  return 0.85; // Fallback (shouldn't reach here)
}
```

Note: `isInSleepHours` must handle ranges that cross midnight (e.g., 22:00–07:00).

### Configuration

| Setting | Type | Default | Purpose |
|---------|------|---------|---------|
| `energySystemEnabled` | boolean | true | Master toggle for the entire energy & sleep system |
| `sleepStartHour` | integer (0–23) | 22 | When the circadian curve reaches its floor |
| `sleepEndHour` | integer (0–23) | 7 | When the morning ramp begins |
| `sleepTickIntervalMs` | integer (ms) | 1,800,000 (30 min) | Heartbeat interval while in sleeping band |

When `energySystemEnabled` is false, the heartbeat operates exactly as it does today — no energy tracking, no circadian curve, no sleep intervals, no energy prompting.

Setting `sleepStartHour` equal to `sleepEndHour` effectively disables sleep scheduling while keeping energy tracking active (the circadian baseline becomes a flat 0.85).

## Sleep Mechanics

### Energy Update Flow (Every Tick)

Energy is updated in two phases — GATHER and EXECUTE — mirroring emotion handling:

**GATHER CONTEXT:**
1. Load current `energy_level` from `heartbeat_state`
2. Compute circadian baseline for current time
3. Apply exponential decay toward circadian baseline:
   ```
   elapsedHours = (now - lastEnergyUpdate) / 3,600,000
   decayedEnergy = baseline + (currentEnergy - baseline) * e^(-decayRate * elapsedHours)
   ```
4. Check for wake-up bump (see below)
5. Derive energy band from decayed value
6. Format energy context section for the mind

**EXECUTE:**
1. Apply mind's energy delta: `finalEnergy = clamp(decayedEnergy + mindDelta, 0, 1)`
2. Persist `finalEnergy` to `heartbeat_state.energy_level`
3. Log to `energy_history` table (for visualization)
4. Emit `energy:updated` event for frontend
5. Check band transitions for interval switching

### Decay Rate

**Default: 1.0 per hour.** This was selected after numerical analysis of multiple scenarios:

**Evening wind-down** (sleep at 22:00):
```
19:00  energy 0.85 → baseline declining
21:00  energy ~0.47  (alert → tired transition)
22:00  energy ~0.21  (drowsy — sleep hours begin)
23:30  energy ~0.05  (enters sleeping band)
```
The AI falls asleep ~1.5 hours after sleep hours begin. The mind's own negative energy deltas ("feeling heavy, ready to rest") accelerate this further.

**Daytime recovery** (baseline 0.85):
```
14:00  energy drops to 0.30 (draining experience)
14:30  energy ~0.52  (decay pulls toward 0.85)
15:30  energy ~0.73  (approaching baseline)
```
Recovery from tired to alert takes ~30 minutes from decay alone. The mind's deltas modulate this — continued draining experiences counteract the pull.

**Post-wake-up return to sleep** (bumped to 0.10 at 3 AM):
```
03:00  bumped to 0.10  (handles message while drowsy)
03:30  energy ~0.06   (very drowsy)
04:00  energy ~0.04   (back in sleeping band)
```
Back asleep within ~1 hour. Mind's negative deltas ("drifting off again...") accelerate this.

The decay rate uses the exact same `e^(-rate × elapsedHours)` formula as emotional decay, sharing the DecayEngine infrastructure. The rate is stored as a constant (not user-configurable for v1) but can be tuned in future iterations.

### Entering Sleep

Sleep is not forced — it emerges. As the circadian curve declines in the evening, the decay formula pulls energy down. The mind experiences increasing tiredness through the context prompting, and typically produces negative energy deltas that accelerate the process. When energy drops below 0.05, the AI enters the sleeping band.

On entering the sleeping band:
- **Tick interval switches** to `sleepTickIntervalMs` (default 30 min)
- **Emotional decay accelerates** (see Accelerated Emotional Decay below)
- **Context prompting shifts** to "You are sleeping"
- The mind still produces thoughts and experiences — these are the AI's dreams

### During Sleep

The heartbeat continues during sleep at a reduced rate. Each sleep tick:
1. GATHER loads energy (near 0.0), computes circadian baseline (0.0), applies decay (energy stays near 0.0)
2. Context tells the mind: "You are sleeping."
3. Mind produces thoughts, experience, emotion deltas, and energy delta as normal
4. The thoughts produced during sleep are the AI's dreams — we do not prompt for dream content; it emerges naturally
5. Emotion decay runs at an accelerated rate, resetting emotions toward personality baselines

### Wake-Up (Natural)

When the configured sleep hours end, the circadian baseline begins its morning ramp. However, at the exact wake time, the baseline is still ~0.0 and the upward pull is too weak to meaningfully move energy. To simulate natural waking:

On the **first tick after sleep hours end** (if currently in sleeping band):
1. **Bump energy to 0.15** — places the AI in the drowsy range, simulating the grogginess of natural waking
2. **Inject wake-up context**: "You are waking up. You slept for approximately X hours. [N messages arrived while you slept / No messages arrived while you slept.] Your energy is still low but rising."
3. **Switch tick interval back** to normal `heartbeatIntervalMs`
4. The mind processes this tick, producing a waking experience. Its energy delta is typically positive ("stretching, feeling the morning come alive")
5. Over subsequent ticks, the circadian ramp (0.0 → 0.85 over 2 hours) pulls energy steadily upward

### Wake-Up (Triggered)

All four tick triggers (message, agent_complete, scheduled_task, interval) can wake the AI during sleep. When a non-interval trigger fires during sleep:

1. **Bump energy to 0.10** — bottom of the drowsy range, groggier than natural wake-up
2. **Inject wake-up context**: "You were pulled from sleep after approximately X hours of rest. A [message from {contactName} / scheduled task / sub-agent result] needs your attention. You are deeply drowsy."
3. **The mind processes the tick** while very drowsy — responds to the message, handles the task. The drowsy context naturally colors the response
4. **After the tick**, energy decays back toward the circadian baseline (0.0 during sleep hours). With a 1.0/hour decay rate, the AI returns to the sleeping band within ~1 hour
5. **Tick interval remains at `sleepTickIntervalMs`** — the AI is still in sleep hours, so even though briefly above the sleeping band, ticks stay spaced out
6. The mind typically produces a negative energy delta ("falling back into sleep..."), accelerating the return

The experience should feel like being woken by your phone at 3 AM — groggy, you deal with it, then drift back to sleep.

### Accelerated Emotional Decay During Sleep

Sleep serves as the **primary emotion reset mechanism**. During sleep ticks, emotional decay is accelerated by a multiplier applied to the standard decay rate:

```
sleepDecayMultiplier = 3.0

// During GATHER, when in sleeping band:
effectiveDecayRate = emotion.decayRate * sleepDecayMultiplier
decayedIntensity = baseline + (intensity - baseline) * e^(-effectiveDecayRate * elapsedHours)
```

With a 3x multiplier and 30-minute sleep ticks:
- **Joy** (normal full reset: 12h) → resets in ~4h of sleep
- **Anxiety** (normal: 24h) → resets in ~8h of sleep
- **Boredom** (normal: 4h) → resets in ~1.3h of sleep
- **Sadness** (normal: 24h) → resets in ~8h of sleep

A full 8-hour sleep period effectively resets most emotions to their personality baselines. The AI wakes emotionally refreshed — high-intensity stress, anxiety, or sadness from the previous day will have substantially faded.

The multiplier only applies when energy is in the **sleeping band** (< 0.05). Tired, drowsy, and very drowsy states use normal decay rates.

## Integration Points

### Heartbeat Pipeline

**GATHER CONTEXT additions:**
1. If `energySystemEnabled`, compute circadian baseline and apply decay to energy level
2. Check for natural wake-up (sleep hours ended, currently sleeping → bump to 0.15)
3. Check for triggered wake-up (non-interval trigger during sleep → bump to 0.10)
4. If sleeping band, apply accelerated emotion decay multiplier
5. Format energy context section

**EXECUTE additions:**
1. If `energySystemEnabled` and mind produced `energyDelta`, apply it
2. Persist updated energy to `heartbeat_state`
3. Log to `energy_history`
4. Emit `energy:updated` event
5. Check if energy crossed sleeping band threshold → switch tick interval

### Context Builder

New section: **"YOUR ENERGY & TIME"** — injected after emotional state, before working memory.

```
── YOUR ENERGY & TIME ──
Current time: {formattedTime} ({timezone})
Energy level: {energyLevel} — {bandDescription}
Tick interval: {tickInterval}

Your energy level reflects how your experiences affect you. Your personality shapes
what energizes and what drains you. Provide an energyDelta reflecting how this tick's
experience affected your energy.

Delta magnitude guidance (for {tickInterval} intervals):
  Minor experience: ±{minor range}
  Significant experience: ±{significant range}
  Extreme experience: ±{extreme range}
```

During wake-up (natural or triggered), an additional paragraph:
```
You are waking up. You slept for approximately {sleepDuration}. {queuedMessagesSummary}.
You are deeply drowsy and slowly coming to awareness.
```

### Tick Queue / Interval Switching

The tick queue's interval dynamically switches based on energy band:

- When energy enters sleeping band (< 0.05): call `tickQueue.updateInterval(sleepTickIntervalMs)`
- When energy exits sleeping band (>= 0.05): call `tickQueue.updateInterval(heartbeatIntervalMs)`

This reuses the existing `updateInterval()` mechanism — no new infrastructure needed.

**Important**: During sleep hours, even if a triggered wake-up bumps energy above 0.05, the system does NOT switch back to the normal interval. The interval only switches back when energy exits the sleeping band during non-sleep hours (i.e., natural morning wake-up). This prevents rapid interval cycling from repeated sleep interruptions.

Correction to the above: the interval switching is based purely on energy band, but we add a guard that during sleep hours, the minimum interval is `sleepTickIntervalMs`. This ensures that even when briefly awake from a trigger during sleep hours, ticks remain spaced out.

### MindOutput Schema Changes

Add to `mindOutputSchema`:

```typescript
energyDelta: z.object({
  delta: z.number(),
  reasoning: z.string()
}).optional()
```

The field is optional. When `energySystemEnabled` is false, the mind is not prompted for energy and this field is absent. When enabled, the field should always be present (default to `{ delta: 0, reasoning: '' }` if missing).

Field ordering in the schema: `thought` → `reply` → `experience` → `emotionDeltas` → `energyDelta` → `decisions` → memory fields. Energy delta is placed after emotion deltas since both are reflective assessments of the tick's experience.

### Database Schema

**heartbeat_state** (add columns):
```sql
ALTER TABLE heartbeat_state ADD COLUMN energy_level REAL DEFAULT 0.85;
ALTER TABLE heartbeat_state ADD COLUMN last_energy_update TEXT;
```

**energy_history** (new table in heartbeat.db):
```sql
CREATE TABLE energy_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tick_number INTEGER NOT NULL,
  energy_before REAL NOT NULL,
  energy_after REAL NOT NULL,
  delta REAL NOT NULL,
  reasoning TEXT NOT NULL DEFAULT '',
  circadian_baseline REAL NOT NULL,
  energy_band TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_energy_history_created ON energy_history(created_at);
```

**system_settings** (add columns):
```sql
ALTER TABLE system_settings ADD COLUMN energy_system_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE system_settings ADD COLUMN sleep_start_hour INTEGER NOT NULL DEFAULT 22;
ALTER TABLE system_settings ADD COLUMN sleep_end_hour INTEGER NOT NULL DEFAULT 7;
ALTER TABLE system_settings ADD COLUMN sleep_tick_interval_ms INTEGER NOT NULL DEFAULT 1800000;
```

### Settings (tRPC)

Extend `systemSettingsSchema`:

```typescript
energySystemEnabled: z.boolean().default(true),
sleepStartHour: z.number().int().min(0).max(23).default(22),
sleepEndHour: z.number().int().min(0).max(23).default(7),
sleepTickIntervalMs: z.number().int().positive().default(1800000),
```

Exposed via existing `settings.getSystemSettings` / `settings.updateSystemSettings` procedures.

### Frontend

**Mind Page:**
- New **Energy** tab alongside Thoughts, Emotions, Agents, Goals, Memories
- Energy visualization: current level as a bar/gauge + historical sparkline from `energy_history`
- Show current band label, circadian baseline, and recent deltas with reasoning

**Presence Page:**
- When the AI is in the sleeping band, display a subtle indicator: "{Name} is sleeping"
- Styling should feel organic — dimmed presence, not a harsh "OFFLINE" badge

**Settings Page:**
- New **Sleep & Energy** section (or subsection under Heartbeat)
- Toggle: "Enable sleep & energy system"
- When enabled, reveal:
  - Sleep hours: start and end hour pickers
  - Sleep tick interval slider (15 min – 2 hours)
- When disabled, all energy-related UI across the app is hidden

## Error Handling & Edge Cases

**Energy system disabled mid-session:**
- Energy stops updating, prompting stops, interval reverts to normal
- `energy_level` retains last value in DB (harmless, not read when disabled)

**Sleep hours set to same start and end:**
- Circadian baseline becomes flat 0.85 all day
- Effectively disables sleep while keeping energy tracking active
- Energy still responds to mind deltas (draining/energizing experiences)

**Sleep hours changed while sleeping:**
- If new hours don't include current time: natural wake-up bump on next tick
- If new hours still include current time: no change, continue sleeping

**Crash during sleep:**
- On recovery, heartbeat checks `energy_level` from `heartbeat_state`
- If in sleeping band and within sleep hours: resume sleep behavior
- If in sleeping band but outside sleep hours: natural wake-up bump
- Session always resumes cold (standard crash recovery)

**First tick after system enable:**
- Energy initializes to circadian baseline for current time
- If current time is within sleep hours: energy starts at 0.0, sleeping behavior begins
- If current time is daytime: energy starts at 0.85, normal operation

## Future Considerations

- **Post-lunch dip**: Real circadian rhythms have a secondary energy dip around 13:00–15:00. Could be added as an optional curve feature.
- **Personality-modulated curve**: Extroverts could have a higher daytime plateau, introverts a lower one. Currently, personality influence flows entirely through the mind's delta assessment.
- **Tunable decay rate**: Currently fixed at 1.0/hour. Could be exposed as an advanced setting.
- **Sleep quality**: Track how often sleep was interrupted, compute a "sleep quality" score that affects morning energy. Interrupted sleep → lower initial energy on wake.
- **Seasonal variation**: Longer sleep hours in winter, shorter in summer. Tied to user's location.
- **Activity history weighting**: Track running average of daily energy drain to detect sustained exhaustion patterns — the AI could proactively want more rest after a demanding week.
