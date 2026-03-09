# Telemetry

Anonymous usage telemetry collected via [PostHog](https://posthog.com) to understand how Animus is used and prioritize improvements. All collection is backend-only, fully anonymous, and opt-out at any time.

## Privacy Principles

- **No PII**: No email, IP address, account info, or user identifiers are ever collected.
- **No content**: No messages, conversations, persona data, memories, or personal information.
- **Anonymous ID**: Each instance gets a random UUID stored on disk (`data/telemetry-id`). It is not tied to any identity. Re-enabling telemetry after disabling it regenerates the UUID, so the old and new IDs cannot be linked.
- **Minimal volume**: Typically 3 to 8 events per day, heavily deduplicated.
- **Backend-only**: The frontend has no PostHog SDK. All events originate from the server process.

## Events

Five event types are collected. Every event includes a `$lib: 'animus-engine'` property.

### 1. `install`

Fires once on first-ever run (when the `telemetry-id` file does not yet exist).

| Property | Example | Description |
|----------|---------|-------------|
| `version` | `0.3.0` | Engine version from package.json |
| `os` | `darwin` | `process.platform` |
| `arch` | `arm64` | `process.arch` |
| `nodeVersion` | `v24.1.0` | `process.version` |

**Source**: `telemetry-service.ts:captureInstall()`, called from `index.ts` at startup.

### 2. `app_started`

Fires on every server startup, after subsystems initialize.

| Property | Example | Description |
|----------|---------|-------------|
| `version` | `0.3.0` | Engine version |
| `os` | `darwin` | Platform |
| `arch` | `arm64` | Architecture |
| `nodeVersion` | `v24.1.0` | Node.js version |
| `provider` | `claude` | Default agent provider (`claude`, `codex`, `opencode`) |
| `channelCount` | `2` | Number of installed channels |
| `pluginCount` | `5` | Number of loaded plugins |

**Source**: `telemetry-service.ts:captureAppStarted()`, called from `index.ts` after heartbeat and channel/plugin initialization.

### 3. `daily_active`

Fires once per calendar day on the first heartbeat tick.

| Property | Example | Description |
|----------|---------|-------------|
| `version` | `0.3.0` | Engine version |
| `provider` | `claude` | Current default agent provider |
| `uptimeHours` | `12.3` | Process uptime in hours (1 decimal) |

**Dedup**: Tracked by `lastDailyActiveDate`. When a new day begins, the per-day feature and error dedup state also resets.

**Source**: `telemetry-service.ts:captureDailyActive()`, called from `heartbeat/index.ts` during each tick.

### 4. `feature_used`

Fires once per feature per calendar day when that feature is first activated.

| Property | Example | Description |
|----------|---------|-------------|
| `feature` | `goals` | Feature name (see table below) |

**Tracked features**:

| Feature | Event bus trigger | Meaning |
|---------|-------------------|---------|
| `goals` | `goal:created`, `seed:created` | A goal or seed memory was created |
| `memory` | `memory:stored` | A long-term memory was stored |
| `channels` | `channel:installed` | A channel was installed |
| `plugins` | `plugin:changed` | A plugin was installed, enabled, disabled, or uninstalled |
| `sleep_energy` | `energy:updated` | The energy/sleep system changed state |
| `voice` | (reserved) | Voice feature usage (not yet wired) |

**Dedup**: Keyed by `YYYY-MM-DD:featureName` in a `Set`. Each feature fires at most once per day.

**Source**: `telemetry-service.ts:captureFeatureUsed()`, triggered by event bus listeners in `index.ts`.

### 5. `error_occurred`

Fires for uncaught exceptions and unhandled promise rejections, up to 5 unique errors per day.

| Property | Example | Description |
|----------|---------|-------------|
| `errorType` | `TypeError` | Error constructor name (or `typeof` for non-Error values) |
| `errorHash` | `283719` | Numeric hash of `ClassName:message` for dedup |

**No error message content is sent.** Only the error class name and a numeric hash for deduplication.

**Dedup**: Capped at 5 per day. Duplicate hashes within the same day are skipped. Resets on new calendar day.

**Source**: `telemetry-service.ts:captureError()`, called from `process.on('uncaughtException')` and `process.on('unhandledRejection')` handlers in `index.ts`.

## Architecture

### Service

`TelemetryService` is a singleton in `packages/backend/src/services/telemetry-service.ts`. It wraps the `posthog-node` SDK.

```
getTelemetryService() → TelemetryService (singleton)
  ├── initialize()           — read/create anonymous ID, init PostHog client
  ├── captureInstall()       — one-time install event
  ├── captureAppStarted()    — every startup
  ├── captureDailyActive()   — once per day
  ├── captureFeatureUsed()   — once per feature per day
  ├── captureError()         — up to 5 unique per day
  ├── isEnabled()            — check env + DB setting
  ├── regenerateId()         — new UUID on re-enable
  └── shutdown()             — flush pending events
```

### PostHog Configuration

- **SDK**: `posthog-node` v5.26.2
- **Host**: `https://us.posthog.com`
- **Flush interval**: 30 seconds
- **Flush threshold**: 5 events (whichever comes first)

### Integration Points

| Lifecycle event | Location | Telemetry call |
|-----------------|----------|---------------|
| Server startup | `index.ts` | `initialize()`, `captureInstall()`, `printFirstRunNotice()` |
| Subsystems ready | `index.ts` | `captureAppStarted({ provider, channelCount, pluginCount })` |
| Heartbeat tick | `heartbeat/index.ts` | `captureDailyActive(uptimeHours)` |
| Feature activation | `index.ts` (event bus listeners) | `captureFeatureUsed(feature)` |
| Uncaught error | `index.ts` (process handlers) | `captureError(error)` |
| Server shutdown | `index.ts` | `shutdown()` (flush pending) |

All telemetry calls are wrapped in try/catch and never block the heartbeat pipeline or server lifecycle.

### Anonymous ID

Stored at `data/telemetry-id` as a plain UUID string. Created on first run. Regenerated when the user re-enables telemetry after disabling, so old and new sessions cannot be correlated.

### Database

Migration `system/019_telemetry.sql` adds `telemetry_enabled INTEGER NOT NULL DEFAULT 1` to the `system_settings` table. Managed via `settingsStore.getSystemSettings()` and `settingsStore.updateSystemSettings()`.

## Opt-Out

Three ways to disable telemetry, checked in order:

1. **Environment variables** (process-level, immutable at runtime):
   - `DO_NOT_TRACK=1` (POSIX standard)
   - `ANIMUS_TELEMETRY_DISABLED=1` (project-specific)

2. **UI toggle**: Settings > Telemetry in the frontend. Persists to `system_settings.telemetry_enabled`.

3. **Debug mode**: `ANIMUS_TELEMETRY_DEBUG=1` logs events to console instead of sending them (useful for development).

When disabled, all capture methods return immediately without queuing or buffering any data.

## Frontend

The frontend has no PostHog SDK. Its only role is displaying the telemetry settings UI (`TelemetryInline` component in `components/settings/TelemetrySection.tsx`), which includes:

- A toggle to enable/disable telemetry
- An expandable "What is collected" section listing privacy guarantees and event descriptions
- Environment variable opt-out instructions

## Key Files

| File | Purpose |
|------|---------|
| `packages/backend/src/services/telemetry-service.ts` | Core service (all event capture logic) |
| `packages/backend/tests/services/telemetry-service.test.ts` | Unit tests |
| `packages/backend/src/db/migrations/system/019_telemetry.sql` | DB migration |
| `packages/backend/src/db/stores/settings-store.ts` | `telemetryEnabled` setting read/write |
| `packages/frontend/src/components/settings/TelemetrySection.tsx` | UI toggle and details |
| `packages/backend/src/index.ts` | Integration (startup, event bus, shutdown) |
| `packages/backend/src/heartbeat/index.ts` | Daily active capture during tick |
