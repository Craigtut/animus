# Channel System Architecture

> **Status**: Architecture finalized
> **Date**: 2026-02-13, updated 2026-02-14
> **Single source of truth** for the Animus channel system — packaging, protocol, isolation, and lifecycle.
>
> **Note**: Reference channel implementations (twilio-sms, discord, api-compat) have moved to the [animus-extensions](https://github.com/animus-engine/animus-extensions) repository. The channel SDK is published as `@animus-labs/channel-sdk` on npm.

How Animus receives messages from the outside world and sends responses back through multiple communication channels. The channel adapter layer sits between external protocols (Twilio webhooks, Discord WebSocket, HTTP API endpoints, the web UI) and the heartbeat pipeline, normalizing everything into a common format.

## Core Principle

The web channel is built directly into the backend — always on, no installation needed. **Every other channel is a channel package** that can be installed, configured, enabled, disabled, and removed at any time without restarting the engine. Channel packages we build ourselves (SMS, Discord) follow the exact same format and lifecycle as community-built packages. There is no distinction between "first-party" and "third-party" at the engine level.

### Where channel packages live

Channel packages are standalone directories that can exist **anywhere on disk**. They are **not part of the Animus engine**. When a user installs a channel, they point the Channel Manager at the directory path — the directory stays where it is.

Reference channel implementations (SMS, Discord, API-compat) live in the [animus-extensions](https://github.com/animus-engine/animus-extensions) repository. They are **not bundled into the engine** — they are independent packages that follow the exact same format and install process as any community-built channel. A user must install them via Settings > Channels > Install by pointing at the directory path.

- **`packages/channel-sdk/`** is a types-only package published as [`@animus-labs/channel-sdk`](https://www.npmjs.com/package/@animus-labs/channel-sdk) on npm. It provides `AdapterContext`, `ChannelAdapter`, and related types for channel adapter authors. It's a `devDependency` — types are erased at compile time, so compiled adapters have zero imports from it.

## Relationship to Plugins

Channel packages are **not plugins**. They share similar concepts (manifests, store distribution, install/remove lifecycle) but are a separate system because channels have fundamentally different requirements:

| Concern | Plugins | Channel Packages |
|---------|---------|-----------------|
| Data flow | Unidirectional (provide data in, hook events) | Bidirectional (receive inbound AND send outbound) |
| Connections | Stateless processes (hooks, MCP servers, triggers) | Persistent connections (Discord WebSocket) or registered routes (Twilio webhooks) |
| Trust level | Runs in-process | Runs in isolated child process |
| Dependencies | Lightweight (scripts, markdown) | Heavy npm packages (twilio, discord.js) |
| Frontend integration | Minimal (name, description) | Deep (config forms, contact identity fields, status indicators) |
| System integration | Extends mind vocabulary (decisions, tools, context) | Extends I/O layer (message transport) |

Plugins extend what Animus **knows and can do**. Channel packages extend how Animus **communicates**.

---

## Channel Protocol

All channels — whether the built-in web channel or installed packages — normalize their input into a common format before handing it to the heartbeat pipeline.

### IncomingMessage Interface

```typescript
interface IncomingMessage {
  channel: string;                     // Channel type ('web', 'sms', 'discord', etc.)
  channelIdentifier: string;           // Channel-specific sender ID
  contact: ResolvedContact | null;     // null = unknown caller
  conversationId: string | null;       // Adapter-determined conversation scoping
  content: string;                     // Text content of the message
  media?: MediaAttachment[];           // Downloaded media references
  rawMetadata: Record<string, unknown>; // Channel-specific data preserved for debugging
  receivedAt: string;                  // ISO 8601 timestamp
}

interface ResolvedContact {
  id: string;                          // contacts.id from contacts.db
  fullName: string;
  permissionTier: 'primary' | 'standard';
}

interface MediaAttachment {
  id: string;                          // UUID
  type: 'image' | 'audio' | 'video' | 'file';
  mimeType: string;                    // e.g., 'image/jpeg'
  localPath: string;                   // Path on disk after download
  originalFilename: string | null;
  sizeBytes: number;
}
```

### Identity Resolution

The channel system owns identity resolution. Before constructing the `IncomingMessage`, the system looks up `(channel, channelIdentifier)` in the `contact_channels` table:

- **Match found** → `contact` is populated with the resolved contact's ID, name, and permission tier
- **No match** → `contact` is `null`, triggering unknown caller handling (canned response + notify primary, no heartbeat tick)

For channel packages, this happens in the **main process** via IPC. The adapter calls `reportIncoming()` with an identifier, and the Channel Manager performs the contact lookup before passing the normalized `IncomingMessage` to the heartbeat pipeline. Adapters never access the database directly.

For the built-in web channel, identity resolution uses the `contacts.user_id` FK rather than `contact_channels` lookup.

See `docs/architecture/contacts.md` for the full identity resolution and permission tier system.

### Conversation Scoping

Each channel determines `conversationId` differently. These values are adapter-specific:

| Channel | Conversation Scoping | Ownership |
|---------|---------------------|-----------|
| Web | One conversation per web session (or explicit thread) | Owned |
| SMS | One conversation per phone number (ongoing thread) | Owned |
| Discord DM | One conversation per DM channel (`channel.id`) | Owned |
| Discord Server | One conversation per text channel (`channel.id`) | Participated |
| Discord Thread | Separate conversation per thread | Participated |
| Slack DM | `dm:{userId}` | Owned |
| Slack Channel | `channel:{channelId}` | Participated |
| Slack Thread | `thread:{channelId}:{threadTs}` | Participated |
| Slack MPIM | `mpim:{channelId}` | Participated |
| API (OpenAI) | Stateless, generated per-request | Owned |
| API (Ollama) | Stateless, same as OpenAI | Owned |

### Conversation Ownership

Adapters declare whether each conversation is **owned** or **participated** via the `conversationType` field in `reportIncoming()`. This tells the engine whether it needs to fetch external history from the channel adapter.

- **Owned**: The engine has complete message history in `messages.db` (DMs, SMS, 1:1 conversations). No external history fetch needed.
- **Participated**: The engine only sees messages directed at it (e.g., @mentions in a shared channel). Other participants' messages are invisible without fetching external history via `getHistory()`.

The engine uses `conversationType` during the gather-context stage to decide which conversations need external history. Only conversations explicitly marked `'participated'` trigger a `getHistory()` call. This replaces earlier heuristics based on conversation ID prefixes, which didn't generalize across channels.

### Outbound Routing

When the EXECUTE stage processes a `send_message` decision, it routes the reply through the appropriate channel.

**Conversation replies** are routed based on the **originating channel** — replies go back through the same channel the message came in on.

**Proactive outbound messages** (from interval ticks, task results, reminders) don't have an originating channel. Routing uses:
1. The `contact_id` from the task or decision specifies WHO to message
2. The channel defaults to **web** (always available) unless the decision includes an explicit `channel` field
3. GATHER CONTEXT for interval ticks includes the primary contact's available channels so the mind can choose
4. Future: a `preferred_channel` field on the contact record

**Failure handling**: If an outbound message fails (network error, API error, rate limit), log the error with full context, do not retry automatically (avoid duplication), do not crash or block EXECUTE.

---

## Web Channel (Built-in)

The web channel is the primary admin interface. It communicates over tRPC (HTTP + WebSocket) and is always available. It is **not** a channel package — it is built directly into the backend.

**Inbound**: Messages sent through the web chat interface arrive via tRPC procedure calls. The authenticated user session identifies the sender.

**Web User → Contact Linking**: The `contacts` table has a `user_id` foreign key pointing to `users`. When a web user sends a message, the adapter finds the contact record where `user_id` matches the authenticated user. On first setup, persona creation ("Bring to Life") creates the primary contact with `user_id` set automatically.

**Outbound**: Replies are pushed to the frontend in real-time via tRPC subscriptions. The web UI receives the full streamed response.

**Media**: The web channel supports media inbound and outbound. Files are uploaded via `POST /api/media/upload` (multipart, `@fastify/multipart`), stored to `data/media/{uuid}.{ext}`, and served via `GET /api/media/:id`. The upload-then-attach flow works as follows:

1. Frontend uploads files → receives pending attachment IDs
2. Frontend sends message via `messages.send` tRPC mutation with `attachmentIds[]`
3. Backend links pending uploads to the message as `media_attachments` DB records
4. Frontend renders images inline (with lightbox), audio/video with native players, and files as download links

Pending uploads that are never attached to a message expire after 30 minutes and are cleaned up automatically. Persisted media files are cleaned up when conversations are cleared or the system is reset.

**Streaming**: Full streaming supported. Tokens are pushed as they're generated via WebSocket subscription.

**Channel identifier**: The user's `id` from the `users` table.

---

## Channel Package Structure

The on-disk structure for a channel package (used during development and after extraction from `.anpk`):

```
twilio-sms/
  channel.json            # Channel manifest (required)
  config.schema.json      # Configuration form definition (required)
  adapter.js              # Compiled adapter code (required)
  package.json            # npm package metadata + dependencies
  node_modules/           # Self-contained dependencies
  assets/
    icon.png              # Channel icon (required, 256x256 PNG)
```

> **Distribution format**: For store distribution, channels are packaged as `.anpk` (ANimus PacKage) files — signed ZIP archives containing a unified `manifest.json` that wraps the channel-specific fields below. See `../../animus-extensions/docs/architecture/package-format.md` for the `.anpk` specification and unified manifest schema. The `channel.json` format described here remains the source format used during development.

### Channel Manifest (`channel.json`)

The manifest declares what the channel is, what it can do, and how the frontend should present it.

```json
{
  "$schema": "https://animus.dev/schemas/channel/v1.json",
  "name": "twilio-sms",
  "type": "sms",
  "displayName": "SMS (Twilio)",
  "description": "Send and receive text messages via Twilio's messaging API.",
  "version": "1.0.0",
  "author": {
    "name": "Animus",
    "url": "https://animus.dev"
  },
  "license": "MIT",
  "engine": ">=0.1.0",
  "icon": "./assets/icon.png",
  "adapter": "./adapter.js",

  "identity": {
    "identifierLabel": "Phone Number",
    "identifierPlaceholder": "+1 (555) 123-4567",
    "identifierValidation": "^\\+[1-9]\\d{1,14}$",
    "identifierHelpText": "E.164 format phone number"
  },

  "capabilities": ["text", "media-inbound"],

  "replyGuidance": "Keep replies concise — 1-2 sentences. Plain text only, no markdown or formatting. SMS has a 1600 character limit.",

  "permissions": {
    "network": ["api.twilio.com", "*.twilio.com"],
    "env": []
  },

  "store": {
    "categories": ["messaging"],
    "tags": ["sms", "twilio", "text"]
  }
}
```

**Manifest fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique package identifier (lowercase, hyphens). Used as DB key. |
| `type` | Yes | Channel type string. Used in `contact_channels.channel`, message routing, etc. Must be unique across installed channels — installing a second package with the same type is rejected. |
| `displayName` | Yes | Human-readable name shown in UI |
| `description` | Yes | One-line description for settings page and store listings |
| `version` | Yes | SemVer version string |
| `author` | Yes | Author metadata |
| `license` | No | SPDX license identifier |
| `engine` | No | Minimum Animus engine version required |
| `icon` | Yes | Relative path to 256x256 PNG icon |
| `adapter` | Yes | Relative path to the compiled adapter entry point (.js) |
| `identity` | Yes | Defines how this channel's contact identifier appears in the People page |
| `identity.identifierLabel` | Yes | Label for the identifier field (e.g., "Phone Number", "Discord User ID") |
| `identity.identifierPlaceholder` | No | Placeholder text for the input |
| `identity.identifierValidation` | No | Regex pattern for input validation |
| `identity.identifierHelpText` | No | Help text shown below the input |
| `capabilities` | Yes | Array of supported features: `text`, `media-inbound`, `media-outbound`, `markdown`, `embeds`, `reactions`, `typing-indicator` |
| `replyGuidance` | Yes | Formatting instructions injected into the mind's context when replying on this channel. Tells the mind how to format responses (length, markdown support, etc.) |
| `permissions` | No | Declared permission requirements |
| `permissions.network` | No | Allowed network hosts (array of hostname strings). Shown to user before install. Enforced at the AdapterContext application layer — see [Security Model](#security-model) for details on enforcement scope. |
| `permissions.env` | No | Environment variables the adapter needs access to |
| `store` | No | Store/marketplace metadata (optional for local installs) |

### Configuration Schema (`config.schema.json`)

Defines the configuration form the frontend renders for this channel. Separated from the manifest because the store only needs `channel.json`, while the settings UI only needs `config.schema.json`.

```json
{
  "fields": [
    {
      "key": "accountSid",
      "label": "Account SID",
      "type": "text",
      "required": true,
      "placeholder": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "helpText": "Found in your Twilio console dashboard"
    },
    {
      "key": "authToken",
      "label": "Auth Token",
      "type": "secret",
      "required": true,
      "helpText": "Found in your Twilio console dashboard"
    },
    {
      "key": "phoneNumber",
      "label": "Twilio Phone Number",
      "type": "text",
      "required": true,
      "placeholder": "+15551234567",
      "validation": "^\\+[1-9]\\d{1,14}$",
      "helpText": "Your Twilio phone number in E.164 format"
    },
    {
      "key": "webhookUrl",
      "label": "Webhook URL",
      "type": "url",
      "required": true,
      "placeholder": "https://your-domain.com/channels/sms/webhook",
      "helpText": "Public URL where Twilio sends inbound messages. Configure this in your Twilio console."
    }
  ]
}
```

**Field types:**

| Type | Renders As | Notes |
|------|-----------|-------|
| `text` | Text input | General string input |
| `secret` | Password input with show/hide toggle | Value encrypted in DB, never returned to frontend after save |
| `url` | URL input with validation | Validates URL format |
| `number` | Numeric input | With optional min/max |
| `select` | Dropdown | Requires `options` array: `[{ "value": "...", "label": "..." }]` |
| `text-list` | Tag-style multi-value input | For arrays of strings (e.g., `allowedGuildIds`) |
| `toggle` | Boolean switch | On/off settings |

Each field can have:

| Property | Required | Description |
|----------|----------|-------------|
| `key` | Yes | Config object key |
| `label` | Yes | Display label |
| `type` | Yes | Field type (see table above) |
| `required` | No | Whether the field must be filled (default: false) |
| `placeholder` | No | Placeholder text |
| `helpText` | No | Help text shown below the field |
| `validation` | No | Regex pattern for validation |
| `options` | For `select` | Array of `{ value, label }` objects |
| `default` | No | Default value |

---

## Adapter Interface

Channel adapters implement a well-defined interface. The adapter runs in an isolated child process and communicates with the engine via a restricted context object.

### AdapterContext (what the adapter receives)

The adapter does **not** import backend internals. It receives a context object with only the APIs it needs:

```typescript
interface AdapterContext {
  // The adapter's own configuration (from config.schema.json fields)
  readonly config: Readonly<Record<string, unknown>>;

  // Structured logging (routed to engine's logger via IPC)
  readonly log: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
    debug(msg: string, ...args: unknown[]): void;
  };

  // Report an incoming message to the channel router
  reportIncoming(params: {
    identifier: string;
    content: string;
    conversationId?: string;
    conversationType?: 'owned' | 'participated';
    media?: Array<{
      type: 'image' | 'audio' | 'video' | 'file';
      mimeType: string;
      url: string;
      filename?: string;
    }>;
    metadata?: Record<string, unknown>;
  }): void;

  // Resolve a contact identifier to a contact ID (for outbound routing)
  resolveContact(contactId: string): Promise<{
    identifier: string;
    displayName?: string;
  } | null>;

  // Register an HTTP route handler (for webhook-based channels)
  registerRoute(config: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    handler: (request: RouteRequest) => Promise<RouteResponse | StreamingRouteResponse>;
  }): void;

  // Request the main process to download media (for isolated adapters that can't write to shared storage)
  downloadMedia(params: {
    url: string;
    mimeType: string;
    filename?: string;
    auth?: { type: 'basic'; username: string; password: string } | { type: 'bearer'; token: string };
  }): Promise<{ localPath: string; sizeBytes: number }>;
}

interface RouteRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: Buffer;             // Raw request body bytes (for signature validation)
  query: Record<string, string>;
}

interface RouteResponse {
  status: number;
  headers?: Record<string, string>;
  body: string | object;
}

// For streaming responses (SSE, NDJSON)
interface StreamingRouteResponse {
  status: number;
  headers: Record<string, string>;
  stream: AsyncIterable<string>;  // Yields chunks as strings
}
```

### Adapter Module Export

The adapter module exports a factory function:

```typescript
// adapter.ts (compiled to adapter.js)
import type { AdapterContext } from '@animus-labs/channel-sdk';

export default function createAdapter(ctx: AdapterContext) {
  return {
    async start(): Promise<void> {
      // Initialize connections, register routes
    },

    async stop(): Promise<void> {
      // Clean up connections, timers, listeners
    },

    async send(contactId: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
      // Send outbound message
      const contact = await ctx.resolveContact(contactId);
      if (!contact) {
        ctx.log.error(`Contact ${contactId} not found`);
        return;
      }
      // ... send via external service using contact.identifier
    },
  };
}
```

**Why a factory function (not a class)?** The factory pattern makes it clear that the adapter receives its dependencies through the context, not through imports. This is the isolation boundary — the adapter cannot access anything not in the context, even though it runs in the same Node.js process during development.

---

## Child Process Isolation

Each channel adapter runs in its own child process via `child_process.fork()`. This provides crash isolation, memory isolation, and permission isolation.

### Why Child Processes (Not In-Process, Not Worker Threads)

| Approach | Crash Isolation | Permission Isolation | Complexity |
|----------|----------------|---------------------|------------|
| In-process `import()` | None — adapter crash kills engine | None — full `process` access | Low |
| Worker threads | Partial — V8 OOM kills process | None — cannot differ from main thread | Medium |
| **Child processes** | **Full — adapter crash doesn't affect engine** | **Full — independent `--permission` flags** | Medium |

The main Animus process needs unrestricted access (the Claude Agent SDK reads/writes files, runs commands). Channel adapter processes don't need any of that — they only need network access to their specific external service. Child processes let us enforce this boundary.

**Node.js version requirement**: The `--permission` flag is stable in Node.js 24+. Animus requires Node.js 24.0 or higher.

**IPC latency is irrelevant.** A round-trip message pass adds ~1-5ms. The heartbeat pipeline takes 500ms-5s (LLM inference). External API calls take 50-300ms. The IPC overhead is noise.

**Memory overhead is acceptable.** Each child process costs ~50-100MB (Node.js runtime + adapter dependencies). For 2-4 active channels, that's 200-400MB on a machine that's already running LLM inference.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    MAIN PROCESS                          │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   Channel    │  │   Channel    │  │    Fastify     │  │
│  │   Manager    │──│    Router    │──│  (catch-all    │  │
│  │              │  │              │  │   route)       │  │
│  └──────┬───────┘  └──────────────┘  └───────────────┘  │
│         │                                                │
│    IPC  │  IPC                                           │
│         │                                                │
├─────────┼────────────────────────────────────────────────┤
│         │                                                │
│  ┌──────┴───────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ SMS Process  │  │Discord Proc. │  │  API Process  │  │
│  │              │  │              │  │              │  │
│  │ --permission │  │ --permission │  │ --permission │  │
│  │ --allow-net  │  │ --allow-net  │  │ --allow-net  │  │
│  │ --allow-fs-  │  │ --allow-fs-  │  │ --allow-fs-  │  │
│  │   read=<dir> │  │   read=<dir> │  │   read=<dir> │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                          │
│            CHILD PROCESSES (isolated)                     │
└─────────────────────────────────────────────────────────┘
```

### IPC Protocol

Communication between the main process and adapter child processes uses Node.js IPC (`process.send()` / `process.on('message')`). All messages are JSON-serializable.

**Main → Child messages:**

| Type | Payload | Description |
|------|---------|-------------|
| `init` | `{ config, channelType }` | Initialize the adapter with its decrypted configuration |
| `send` | `{ id, contactId, content, metadata }` | Send an outbound message |
| `stop` | `{}` | Graceful shutdown request |
| `route_request` | `{ id, method, url, headers, body, rawBody, query }` | HTTP request forwarded from catch-all route (`rawBody` is base64-encoded) |
| `resolve_contact_response` | `{ id, result }` | Response to a contact resolution request |
| `media_download_response` | `{ id, localPath, sizeBytes, error? }` | Response to a media download request |
| `config_update` | `{ config }` | Push updated configuration without full restart |
| `action` | `{ id, action: { type, ...params } }` | Perform a channel action (typing indicator, reaction, etc.). Best-effort — adapter returns `ok: true` even if it doesn't implement the action. |
| `ping` | `{ id }` | Health check (expects `pong` response) |

**Child → Main messages:**

| Type | Payload | Description |
|------|---------|-------------|
| `ready` | `{}` | Adapter initialized successfully |
| `incoming` | `{ identifier, content, conversationId, conversationType?, media, metadata }` | Inbound message received (`conversationType`: `'owned'` or `'participated'`) |
| `send_response` | `{ id, ok, error? }` | Response to a send request |
| `route_response` | `{ id, status, headers, body }` | HTTP response for a non-streaming route request |
| `route_response_stream_start` | `{ id, status, headers }` | Begin a streaming HTTP response (sets status + headers) |
| `route_response_chunk` | `{ id, data }` | A chunk of streaming response data |
| `route_response_end` | `{ id }` | End the streaming response |
| `resolve_contact` | `{ id, contactId }` | Request to resolve a contact identifier |
| `media_download` | `{ id, url, mimeType, filename?, auth? }` | Request main process to download media |
| `log` | `{ level, message, args }` | Log message to route through engine's logger |
| `route_register` | `{ method, path }` | Register an HTTP route on the main process |
| `error` | `{ message, stack }` | Unhandled error in the adapter |
| `stop_ack` | `{}` | Confirms graceful shutdown is complete |
| `action_response` | `{ id, ok, error? }` | Response to an action request |
| `pong` | `{ id }` | Health check response |

### IPC Streaming Protocol

Some channels (OpenAI-compatible API, Ollama-compatible API) need to **stream HTTP responses** back to callers. The IPC protocol supports this via a three-message sequence:

```
Client Request (SSE stream=true)
  │
  ▼
Fastify catch-all route
  │
  ├──→ IPC: route_request { id, method, url, headers, body, rawBody, query }
  │
  ▼
Child process (API adapter)
  │
  ├──→ IPC: route_response_stream_start { id, status: 200, headers: { "content-type": "text/event-stream" } }
  │         (Main process opens streaming response: reply.raw.writeHead())
  │
  ├──→ IPC: route_response_chunk { id, data: "data: {\"choices\":[...]}\n\n" }
  ├──→ IPC: route_response_chunk { id, data: "data: {\"choices\":[...]}\n\n" }
  ├──→ IPC: route_response_chunk { id, data: "data: [DONE]\n\n" }
  │         (Main process writes each chunk: reply.raw.write(data))
  │
  └──→ IPC: route_response_end { id }
            (Main process closes: reply.raw.end())
```

The catch-all route handler distinguishes streaming vs non-streaming based on the first response message type:
- `route_response` → single response, use normal `reply.status().headers().send()`
- `route_response_stream_start` → streaming, use `reply.raw.writeHead()` then pipe chunks

For non-streaming requests (like Twilio webhooks returning `<Response/>`), the existing single `route_response` message works unchanged.

### Catch-All Route for Channel Webhooks

Fastify's route tree is immutable after `listen()`. Channel packages need HTTP routes that can be added and removed at runtime. The solution is a single catch-all route registered at startup:

```typescript
// Registered once at startup — never changes
fastify.all('/channels/:channelType/*', async (request, reply) => {
  const { channelType } = request.params;
  const channelProcess = channelManager.getProcess(channelType);

  if (!channelProcess) {
    return reply.status(404).send({ error: `Channel ${channelType} not installed` });
  }

  // Forward the request to the channel's child process via IPC
  // forwardRequest handles both streaming and non-streaming responses
  await channelProcess.forwardRequest(request, reply);
});
```

**Raw body capture**: Fastify is configured with a custom content type parser to capture the raw request body alongside the parsed body. This is critical for webhook signature validation (e.g., Twilio's HMAC-SHA1 signature is computed over the raw POST body).

Channel adapters register routes relative to their namespace. A Twilio adapter registering `/webhook` gets the full path `/channels/sms/webhook`.

### Crash Recovery

If a channel child process crashes:

1. Channel Manager detects the exit via `process.on('exit')`
2. Logs the error with full context
3. Marks the channel as `status: 'error'` with the error message
4. Emits `channel:status_changed` on the EventBus (frontend updates via subscription)
5. Attempts restart with exponential backoff (1s, 2s, 4s, 8s, max 60s)
6. After 5 consecutive failures, marks the channel as `status: 'failed'` and stops retrying
7. User can manually retry from the Settings page

### Health Checks

The Channel Manager sends `ping` messages to each child process every 30 seconds. If a child doesn't respond with `pong` within 5 seconds, it's considered hung — the Channel Manager kills the process and triggers crash recovery.

### Adapter Cleanup Contract

Every adapter must clean up all resources in its `stop()` method. The Channel Manager enforces a timeout:

1. Sends `stop` IPC message
2. Waits up to 10 seconds for `stop_ack` response
3. If no `stop_ack`, sends `SIGTERM`
4. If still running after 5 more seconds, sends `SIGKILL`

Adapters should use the **disposable pattern** — track all event listeners, timers, and connections, then clean them up in `stop()`:

```typescript
export default function createAdapter(ctx: AdapterContext) {
  const cleanups: Array<() => void> = [];

  return {
    async start() {
      // Track everything for cleanup
      const client = new ExternalClient(ctx.config.token);
      cleanups.push(() => client.destroy());

      const timer = setInterval(() => { /* heartbeat */ }, 30000);
      cleanups.push(() => clearInterval(timer));

      client.on('message', (msg) => ctx.reportIncoming({ ... }));

      await client.connect();
    },

    async stop() {
      // Clean up in reverse order
      for (const cleanup of cleanups.reverse()) {
        cleanup();
      }
      cleanups.length = 0;
    },

    async send(contactId, content) { /* ... */ },
  };
}
```

---

## Streaming Pipeline

All channels use the same streaming approach: the mind always streams its output, and the EXECUTE stage runs after streaming completes.

```
Mind (MIND QUERY) streams output
  │
  ▼
Streaming Router (main process)
  │
  ├──→ Web: stream tokens via tRPC WebSocket subscription
  ├──→ SMS: buffer full response, then send as single SMS (via IPC `send`)
  ├──→ Discord: buffer full response, then send as single message (via IPC `send`)
  ├──→ API (OpenAI): stream tokens as SSE events (via IPC streaming protocol)
  └──→ API (Ollama): stream tokens as NDJSON lines (via IPC streaming protocol)
```

**EXECUTE runs after streaming completes.** The reply is delivered before thoughts, emotions, and decisions are persisted. This is an acceptable trade-off for low-latency responses.

For channel packages that support real-time streaming (API channels), the streaming router uses the IPC streaming protocol. It sends `route_response_stream_start` to open the client connection, then forwards each token as a `route_response_chunk`, and finally sends `route_response_end`. However, note that for API channels the streaming actually flows in the **reverse direction** — the mind's stream goes to the client, not from the client. The API channel's route handler triggers a heartbeat tick and then subscribes to the mind's streaming output, formatting each chunk as SSE or NDJSON and writing it to the HTTP response via the IPC streaming protocol.

For channels that buffer (SMS, Discord), the streaming router collects the full response, then sends it as a single outbound message via the `send` IPC command.

---

## Media Handling

### Inbound Media

When messages include media (MMS images, Discord attachments), the adapter reports the media URL via `reportIncoming()`. **Media downloads happen in the main process**, not in the child process. This avoids giving child processes write access to shared storage.

**Flow:**
1. Channel adapter receives a message with media URLs
2. Adapter calls `ctx.downloadMedia({ url, mimeType, auth })` for each attachment
3. Main process downloads the file to `./data/media/{uuid}.{ext}`
4. Returns `{ localPath, sizeBytes }` to the adapter via IPC
5. Adapter includes the local paths in its `reportIncoming()` call

**Why main process downloads?** Child processes run with `--allow-fs-read=<channel-dir>` — they can't write to the shared media directory. Centralizing media downloads in the main process keeps permissions tight.

**Authentication**: Some media URLs require auth (Twilio MMS requires HTTP Basic Auth with Account SID + Auth Token). The `downloadMedia()` method accepts auth credentials that the adapter provides from its config.

**Storage schema** (in messages.db):

```sql
CREATE TABLE media_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  type TEXT NOT NULL,                -- 'image' | 'audio' | 'video' | 'file'
  mime_type TEXT NOT NULL,
  local_path TEXT NOT NULL,
  original_filename TEXT,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT                    -- TTL for cleanup
);
```

**TTL Cleanup**: Media files are cleaned up after a configurable retention period (default: 30 days).

---

## Channel Manager

The Channel Manager is a backend service that discovers, loads, validates, and manages channel packages. It is the only component that interacts with channel child processes.

### Responsibilities

```
Engine Startup
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│  Channel Manager                                         │
│                                                          │
│  1. Query system.db for installed channel paths           │
│  2. For each installed channel:                           │
│     a. Read channel.json + config.schema.json             │
│     b. Validate manifests (Zod schemas)                   │
│     c. Verify adapter checksum                            │
│     d. Check engine version compatibility                 │
│  3. For each enabled channel:                             │
│     a. Fork child process with --permission flags         │
│     b. Send init message with decrypted config            │
│     c. Wait for ready response                            │
│     d. Register route handlers (via catch-all delegation) │
│     e. Register with ChannelRouter for outbound dispatch  │
│  4. Emit 'channels:loaded' on EventBus                    │
│  5. Start health check interval (ping every 30s)          │
│  6. Start crash recovery watchers                         │
└─────────────────────────────────────────────────────────┘
```

### API Surface

```typescript
interface IChannelManager {
  // Lifecycle
  loadAll(): Promise<void>;
  stopAll(): Promise<void>;

  // Installation (all persist to system.db)
  installFromPath(absolutePath: string): Promise<ChannelManifest>;
  uninstall(name: string): Promise<void>;

  // Runtime control
  enable(name: string): Promise<void>;    // Start child process
  disable(name: string): Promise<void>;   // Stop child process, keep config
  restart(name: string): Promise<void>;   // Stop + start (for config changes)

  // Queries (for frontend)
  getInstalledChannels(): ChannelInfo[];   // All channels with status
  getChannelManifest(name: string): ChannelManifest | undefined;
  getConfigSchema(name: string): ConfigSchema | undefined;
  getChannelTypes(): string[];            // All installed channel type strings

  // Internal (for ChannelRouter)
  getProcess(channelType: string): ChannelProcessHost | undefined;
  sendToChannel(channelType: string, contactId: string, content: string): Promise<void>;
}
```

### Database Storage

Channel installation state is persisted in `system.db`:

```sql
CREATE TABLE channel_packages (
  name TEXT PRIMARY KEY,               -- e.g., 'twilio-sms'
  channel_type TEXT NOT NULL UNIQUE,   -- e.g., 'sms' (from manifest)
  version TEXT NOT NULL,
  path TEXT NOT NULL,                  -- Absolute path to channel directory
  enabled INTEGER NOT NULL DEFAULT 0,
  config TEXT,                         -- Encrypted JSON (user's filled-in config values)
  installed_at TEXT NOT NULL,          -- ISO 8601
  updated_at TEXT NOT NULL,
  checksum TEXT NOT NULL,              -- SHA-256 of adapter.js at install time
  status TEXT NOT NULL DEFAULT 'disabled', -- 'disabled' | 'starting' | 'connected' | 'error' | 'failed'
  last_error TEXT                      -- Error message if status is 'error' or 'failed'
);
```

**Key fields:**
- `path`: Absolute path to the channel directory on disk. The channel stays where it is — Animus just learns where to find it.
- `channel_type`: Must be unique — installing a second package with the same channel type is rejected with a clear error.
- `config`: The user's filled-in configuration values (from `config.schema.json`), encrypted via the Encryption Service.
- `checksum`: SHA-256 hash of `adapter.js` at install time. Verified on each engine startup — mismatch prevents loading.
- `status`: Current runtime status, pushed to frontend for display.

---

## Installation UX

Channels can be installed via three methods: local path (development), `.anpk` package file, or the in-engine store browser.

> **Full install specification**: See `docs/architecture/package-installation.md` for the complete 12-step installation flow (including signature verification, checksum validation, permissions consent, rollback support, and update checking). The flows below describe the channel-specific UX.

### Installation Flow (Local Path — Development)

```
User opens Settings > Channels > "Install Channel"
  │
  ├─→ File picker: select the channel.json manifest file directly
  │   └─→ Channel directory derived from the manifest file's parent directory
  │   └─→ In Tauri (desktop): native directory picker also available
  │
  ├─→ Channel Manager validates:
  │   ├─→ channel.json exists and passes Zod schema validation
  │   ├─→ config.schema.json exists and is valid
  │   ├─→ adapter.js exists at the declared path
  │   ├─→ icon file exists
  │   ├─→ Engine version compatible (if declared)
  │   ├─→ Channel type not already installed (rejects duplicates)
  │   └─→ Computes SHA-256 checksum of adapter.js
  │
  ├─→ User reviews channel info:
  │   ├─→ Name, description, version, author
  │   ├─→ Requested permissions (network hosts)
  │   └─→ "Install" / "Cancel" buttons
  │
  ├─→ Path + metadata persisted to channel_packages table in system.db
  │
  ├─→ Channel appears in Settings > Channels as "Disabled"
  │   └─→ User can now configure credentials and enable
  │
  └─→ Emit 'channel:installed' on EventBus
      └─→ Frontend updates channel list via tRPC subscription
```

### Installation Flow (Package File or Store)

```
User uploads .anpk file  — OR —  clicks "Install" in store browser
  │
  ├─→ Engine verifies Ed25519 signature
  ├─→ Engine verifies archive-level SHA-256 checksum
  ├─→ Extracts manifest.json, checks engine compatibility
  ├─→ Displays permissions consent screen
  │
  ├─→ On approval:
  │   ├─→ Extracts to ~/.animus/packages/{name}/
  │   ├─→ Verifies per-file checksums against CHECKSUMS
  │   ├─→ Registers in channel_packages table
  │   ├─→ Caches .anpk in ~/.animus/packages/.cache/ (for rollback)
  │   └─→ Channel appears in Settings > Channels as "Disabled"
  │
  └─→ Emit 'channel:installed' on EventBus
```

### Enable Flow

```
User fills in configuration form → clicks "Enable"
  │
  ├─→ Config values validated against config.schema.json
  ├─→ Config encrypted and stored in channel_packages.config
  ├─→ Channel Manager forks child process
  │   ├─→ --permission --allow-fs-read=<channel-dir> --allow-net
  │   ├─→ Sends init message with decrypted config
  │   └─→ Waits for ready response (10s timeout)
  │
  ├─→ On success:
  │   ├─→ Status → 'connected'
  │   ├─→ Register with ChannelRouter for outbound dispatch
  │   └─→ Emit 'channel:status_changed'
  │
  └─→ On failure:
      ├─→ Status → 'error' with error message
      ├─→ Child process terminated
      └─→ Emit 'channel:status_changed' (frontend shows error)
```

### Disable Flow

```
User clicks "Disable" on a running channel
  │
  ├─→ Channel Manager sends stop to child process
  ├─→ Waits for stop_ack (10s timeout, then SIGTERM/SIGKILL)
  ├─→ Deregister from ChannelRouter
  ├─→ Status → 'disabled'
  ├─→ Config preserved (can re-enable without reconfiguration)
  └─→ Emit 'channel:status_changed'
```

### Uninstall Flow

```
User clicks "Uninstall" on a channel
  │
  ├─→ Confirmation dialog warns the user:
  │   "Removing [channel name] will:
  │    • Stop the channel if running
  │    • Delete all contact identities linked to this channel
  │    • Remove stored configuration and credentials
  │    Conversations and messages are preserved."
  │
  ├─→ User confirms
  │
  ├─→ If running: disable first (stop child process)
  ├─→ Delete contact_channels entries where channel = this channel type
  ├─→ Remove entry from channel_packages table
  ├─→ Channel directory on disk is NOT deleted (user's files)
  ├─→ Emit 'channel:uninstalled'
  └─→ Frontend removes channel from list
```

---

## Hot-Swap (Runtime Install/Remove)

Channel packages can be installed and removed while the engine is running. No restart required.

### How It Works

**Installing a new channel at runtime:**
1. Channel Manager validates the manifest and persists to DB
2. If user enables it, forks a new child process
3. Registers with ChannelRouter
4. Catch-all Fastify route automatically delegates to the new process
5. Frontend receives update via tRPC subscription

**Removing a channel at runtime:**
1. Channel Manager stops the child process (graceful shutdown)
2. Deregisters from ChannelRouter
3. Catch-all route returns 404 for that channel type
4. Cleans up contact identity data
5. Removes DB entry
6. Frontend receives update

**Module cache**: ESM modules cannot be evicted from cache. For channel packages this is irrelevant — each adapter runs in a child process, so unloading means terminating the process. No cache concerns.

**Fastify routes**: The catch-all route pattern means no route registration/deregistration is needed. Routes are dispatched dynamically based on what's currently installed.

**Mid-conversation handling**: If a channel is uninstalled while a conversation is active, any pending outbound messages to that channel type will fail. The ChannelRouter returns a clear error ("Channel [type] is not installed"), and the message is logged as undeliverable.

---

## Dynamic Channel Types

The `ChannelType` type becomes a dynamic string rather than a static union.

### Type Definition

```typescript
// packages/shared/src/schemas/common.ts
// Before: z.enum(['web', 'sms', 'discord', 'api'])
// After:
export const channelTypeSchema = z.string().min(1);

// packages/shared/src/types/index.ts
export type ChannelType = string;
```

The web channel type `'web'` is always present. All other channel types come from installed channel packages.

### Validation

Runtime validation replaces compile-time checks:

```typescript
// Tool input schemas — validate against installed channels at runtime
const channelInput = z.string().refine(
  (val) => val === 'web' || channelManager.getChannelTypes().includes(val),
  { message: 'Unknown channel type' }
);
```

### Context Builder

Reply guidance is loaded from channel manifests instead of hardcoded:

```typescript
// Before: CHANNEL_REPLY_GUIDANCE['sms']
// After:
const manifest = channelManager.getChannelManifest(channelType);
const guidance = manifest?.replyGuidance ?? 'Respond naturally.';
```

### Impact Assessment

| Component | Change | Complexity |
|-----------|--------|-----------|
| `shared/schemas/common.ts` | `z.enum()` → `z.string()` | Trivial |
| `shared/types/index.ts` | Type alias → `string` | Trivial |
| `shared/tools/definitions.ts` | `z.enum()` → `z.string()` in tool schemas | Trivial |
| `shared/schemas/system.ts` | Remove per-channel config schemas | Trivial (replaced by manifest) |
| `backend/heartbeat/context-builder.ts` | Load reply guidance from manifest | Low |
| `frontend/SettingsPage.tsx` | Dynamic form renderer instead of per-channel forms | Medium |
| Database schemas | No change (all TEXT columns) | None |

---

## Frontend Integration

The frontend renders all channel UI from manifest data. There is no channel-specific React code.

### Settings Page — Channels Section

```
Channels
───────────────────────────────────────────────────────────
  [icon] Web              Always On              Connected
  [icon] SMS (Twilio)     [Configure ▾]          Disabled
  [icon] Discord          Error: Invalid token   [Retry]
───────────────────────────────────────────────────────────
  [+ Install Channel]
```

**Channel list**: Fetched from `channels.getInstalled` tRPC endpoint. Returns all installed channels with manifest data and status.

**Configuration form**: When the user expands a channel, the settings page renders a generic form from `config.schema.json`. Field types map to a fixed set of form components. No channel-specific React.

**Status indicators**:
- `disabled` — Gray, "Disabled" label
- `starting` — Yellow spinner, "Starting..." label
- `connected` — Green, "Connected" label
- `error` — Red, error message shown, "Retry" button
- `failed` — Red, "Failed after multiple retries" message

**Error surfacing**: When a channel enters error state, a toast notification appears. The channels section shows the error message inline. The user can click "Retry" to attempt restart or "Configure" to update credentials.

### Icon Serving

Channel icons are served via a tRPC endpoint:

```
GET /api/channels/:name/icon → PNG image
```

The endpoint reads the icon file from the channel's package directory (path from `channel_packages` table + manifest's `icon` field) and returns it with appropriate caching headers.

### People Page — Contact Identity Fields

Each installed channel contributes an identity field to the contact edit form:

```
Edit Contact: John
───────────────────────────────────────────────────────────
  Name:           [John Doe                ]
  Permission:     [Standard ▾]

  Channel Identifiers:
  [icon] Phone Number:    [+1 (555) 123-4567     ]   ← from SMS manifest
  [icon] Discord User ID: [123456789012345678    ]   ← from Discord manifest
───────────────────────────────────────────────────────────
```

The "Channel Identifiers" section is built dynamically from `identity` fields in installed channel manifests. Adding/removing a channel adds/removes the corresponding identity field. Values are stored in the `contact_channels` table.

### tRPC Endpoints

```typescript
channels.getInstalled    → ChannelInfo[]           // All installed channels with manifest + status
channels.getConfigSchema → ConfigSchema            // Config form schema for a specific channel
channels.configure       → void                    // Save config values (validated + encrypted)
channels.enable          → void                    // Start the channel
channels.disable         → void                    // Stop the channel
channels.restart         → void                    // Stop + start (for config changes)
channels.install         → ChannelManifest         // Install from a path
channels.uninstall       → void                    // Remove a channel (with data cleanup)
channels.getIcon         → Buffer                  // Serve the channel's icon PNG
channels.getStatus       → ChannelStatus[]         // Status for all channels
```

### Real-Time Updates

Channel status changes are pushed to the frontend via tRPC subscription:

```typescript
channels.onStatusChange.subscription(() => {
  return observable<ChannelStatusEvent>((emit) => {
    eventBus.on('channel:status_changed', (event) => emit.next(event));
  });
});
```

The frontend updates the channel list in real-time when a channel is installed, uninstalled, connects, disconnects, enters error state, or recovers.

---

## Plugin Hooks Integration

Channel messages flow through the standard message pipeline in the main process. Plugin hooks (`preMessage`, `postMessage`) fire at the ChannelRouter level — channel packages don't need to know about hooks.

**Inbound message flow:**
1. Child process sends `incoming` IPC message
2. Channel Manager receives it, performs identity resolution
3. ChannelRouter constructs `IncomingMessage`
4. Plugin `preMessage` hooks fire (can modify/filter the message)
5. Message enters the heartbeat pipeline (triggers a tick)
6. Mind produces a reply
7. Plugin `postMessage` hooks fire on the outgoing message (can modify content)
8. Reply sent to the originating channel via IPC `send`

This design means:
- Plugins can intercept/modify all channel messages uniformly
- Channel adapters don't need to implement hook support
- The hook integration point is the same regardless of which channel the message came from

---

## Security Model

### Threat Model

For a self-hosted, single-user application:
- **Primary threat**: Buggy adapter code crashing the engine, leaking credentials between channels, or consuming excessive resources
- **Secondary threat**: Supply chain attack via a malicious channel package
- **Non-threat**: User deliberately installing a malicious adapter on their own machine

### Defense Layers

**1. Child process isolation (runtime)**:
- Each adapter runs in its own process with `--permission` flags
- `--allow-fs-read` restricted to the channel's own directory
- `--allow-net` for network access (all-or-nothing — see note on per-host enforcement below)
- No `--allow-child-process` — adapters cannot spawn subprocesses
- No `--allow-worker` — adapters cannot create worker threads
- No `--allow-addons` — adapters cannot load native modules at runtime
- Crash in an adapter process does not affect the main engine

**2. Restricted API surface (design)**:
- Adapters receive an `AdapterContext` with only the methods they need
- No access to database, file system, other channels, or engine internals
- Contact resolution goes through IPC — adapters see identifiers, not full contact records
- Config values are passed via IPC — adapters don't read from DB directly

**3. Integrity verification (install-time)**:
- SHA-256 checksum of `adapter.js` computed at install time
- Checksum verified on each engine startup — mismatch prevents loading
- User is warned if checksum changes (adapter file modified since install)
- For `.anpk` packages: Ed25519 signature verification + per-file SHA-256 checksums — see `../../docs/architecture/distribution-security.md` for the complete 4-layer security model (integrity → signing → permissions consent → sandboxing)

**4. Permission declaration (transparency + application-level enforcement)**:
- Manifest declares `permissions.network` as an array of hostname strings (e.g., `["api.twilio.com", "*.twilio.com"]`)
- This format aligns with the plugin manifest's `permissions.network` field
- Shown to user before installation for transparency
- **Application-level enforcement**: The AdapterContext proxy wraps network calls (fetch, HTTP) to only allow requests to declared hosts. This catches bugs (adapter accidentally calling the wrong host) but is bypassable by intentionally malicious code.
- **Node.js `--allow-net` limitation**: The `--allow-net` permission flag is binary — it allows ALL network or NO network. Per-host restriction is not supported at the kernel level. The hostname array is enforced only at our application layer.

**5. Namespace collision prevention (install-time)**:
- Channel type must be unique across all installed packages
- Installing a package with a `type` that matches an existing package is rejected with a clear error

### Why Not In-Process

The main Animus process runs the Claude Agent SDK, which requires unrestricted file system and process access. Applying `--permission` to the main process would break the agent. Channel adapters don't need any of that access, so isolating them in child processes with restricted permissions is the right boundary.

---

## Channel SDK Package

To help channel developers implement adapters, we provide a `@animus-labs/channel-sdk` package with TypeScript types:

```typescript
// @animus-labs/channel-sdk

export interface AdapterContext {
  readonly config: Readonly<Record<string, unknown>>;
  readonly log: Logger;
  reportIncoming(params: IncomingParams): void;
  resolveContact(contactId: string): Promise<ContactInfo | null>;
  registerRoute(config: RouteConfig): void;
  downloadMedia(params: MediaDownloadParams): Promise<MediaDownloadResult>;
}

export interface ChannelAction {
  type: string;
  [key: string]: unknown;
}

export interface ChannelAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(contactId: string, content: string, metadata?: Record<string, unknown>): Promise<void>;
  performAction?(action: ChannelAction): Promise<void>;
}

export type AdapterFactory = (ctx: AdapterContext) => ChannelAdapter;
```

This package contains **only types** — no runtime code. It's a devDependency for channel packages and provides autocomplete and type checking during development.

### Channel Actions (`performAction`)

The `performAction` method on `ChannelAdapter` is an optional extension point for channels that support richer interactions beyond text messaging. The engine uses it for features like typing indicators and emoji reactions.

**How it works:**

1. The engine calls `ChannelManager.performAction(channelType, action)`.
2. The Channel Manager checks the manifest's `capabilities` array to see if the channel supports the action type (capability gating).
3. If supported, it sends an `action` IPC message to the child process.
4. The child bootstrapper calls `adapter.performAction(action)` if implemented, or returns `ok: true` as a silent no-op.
5. The `action_response` IPC message is sent back.

**Capability gating map:**

| Action Type | Required Capability |
|-------------|-------------------|
| `typing_indicator` | `typing-indicator` |
| `add_reaction` | `reactions` |

**Defined action types:**

| Action Type | Parameters | Description |
|-------------|-----------|-------------|
| `typing_indicator` | `{ channelId }` | Show "typing..." indicator in the channel |
| `add_reaction` | `{ channelId, messageId, emoji }` | React to a message with a Unicode emoji |

**Design principles:**

- **`ChannelAction` is loosely typed** (`{ type: string; [key: string]: unknown }`) — adapters handle what they support and ignore the rest. This keeps the interface stable as new action types are added.
- **Best-effort, never throws** — `performAction` failures are logged but never crash the tick. Actions are UX enhancements, not critical operations.
- **`performAction` is optional** — existing adapters work unchanged. The child bootstrapper returns `ok: true` for the no-op case.
- **10-second timeout** — shorter than `send` (30s) because actions are lightweight. Timeout resolves `false`, doesn't throw.

**Typing indicators** are system-driven: the heartbeat `executeTick()` automatically fires `typing_indicator` when processing message-triggered ticks on channels that declare the `typing-indicator` capability. The timer fires immediately, then every 8 seconds (Discord typing lasts 10s), and clears when the mind query completes.

**Emoji reactions** are mind-driven: the mind can issue a `send_reaction` decision with `{ emoji }` params. The decision executor resolves `channelId` and `messageId` from the trigger metadata and calls `performAction` with `add_reaction`. The mind doesn't need platform-specific IDs.

---

## Channel Reference Specs

Implementation reference for channel package developers. These specs describe the external protocols and APIs that each channel adapter must interact with.

### SMS (Twilio)

**Protocol**: HTTP webhooks (inbound), REST API (outbound)
**Dependencies**: `twilio` npm package

**Inbound flow:**
1. User sends SMS → Twilio sends POST webhook to `/channels/sms/webhook`
2. **Signature validation**: Every request validated using `Twilio.validateRequest()` with auth token. `X-Twilio-Signature` header contains HMAC-SHA1 of URL + body. Requires `rawBody` from RouteRequest.
3. Extract content from `Body` param, sender from `From` param (E.164 format)
4. Check for MMS media: if `NumMedia > 0`, download each `MediaUrl{N}` via `ctx.downloadMedia()` (Twilio media URLs require HTTP Basic Auth: Account SID + Auth Token)
5. Call `ctx.reportIncoming()` with identifier, content, media
6. Return empty TwiML `<Response/>` to Twilio (replies sent separately via API)

**Outbound**: `client.messages.create({ body, from: animusNumber, to: contactNumber })`

**Configuration fields**: `accountSid`, `authToken` (secret), `phoneNumber`, `webhookUrl`

**Notes**: Plain text only, 1600 char limit, publicly accessible webhook URL required.

### Discord

**Protocol**: WebSocket gateway (persistent connection)
**Dependencies**: `discord.js` v14

**Bot setup**: Requires Discord Application with Bot user. Gateway intents: `Guilds`, `GuildMessages`, `MessageContent` (privileged), `DirectMessages`. Partials: `Channel` (for DM support).

**Inbound flow:**
1. Bot receives `messageCreate` event via WebSocket
2. Skip if `message.author.bot === true`
3. Extract sender ID: `message.author.id` (stable numeric string)
4. Determine conversation scope: DMs use `channel.id`, server channels use `channel.id`, threads use thread `channel.id`
5. In server channels: only respond when mentioned (`@Animus`) or in threads the bot participates in
6. Call `ctx.reportIncoming()` with identifier, content, conversationId

**Outbound**: `message.reply(content)` or `channel.send(content)`

**Formatting**: Discord supports markdown (bold, italic, code blocks, lists).

**Bot presence**: Set status to `online` when heartbeat running, `idle` when stopped.

**Configuration fields**: `botToken` (secret), `applicationId`, `allowedGuildIds` (text-list, optional)

### OpenAI-Compatible API

**Protocol**: HTTP REST API implementing the OpenAI Chat Completions spec
**Namespace**: `/channels/api/openai/v1/...`

**Endpoints:**
- `GET /models` — Returns `[{ id: "animus", object: "model", ... }]`
- `POST /chat/completions` — Chat completions (streaming or non-streaming)

**Stateless design**: Extracts only the last user message from `messages` array. Animus maintains its own conversation state. System message is ignored.

**Streaming (SSE)** when `stream: true`:
```
Content-Type: text/event-stream

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

Uses `route_response_stream_start` + `route_response_chunk` + `route_response_end` IPC messages.

**Non-streaming**: Standard `chat.completion` JSON response with `message` (not `delta`).

**Content format**: Handles both string and array (multimodal) format for `content` field.

**Auth & contact resolution**: No API key auth currently. Maps to primary contact.

### Ollama-Compatible API

**Protocol**: HTTP REST API implementing the Ollama spec
**Namespace**: `/channels/api/ollama/...`

**Endpoints:**
- `GET /api/tags` — Model discovery
- `POST /api/chat` — Chat completion (primary)
- `POST /api/generate` — Text generation (legacy)

**Streaming (NDJSON)** — **NOT SSE**:
```
Content-Type: application/x-ndjson

{"model":"animus","created_at":"...","message":{"role":"assistant","content":"Hello"},"done":false}
{"model":"animus","created_at":"...","message":{"role":"assistant","content":"!"},"done":false}
{"model":"animus","created_at":"...","message":{"role":"assistant","content":""},"done":true,"total_duration":0}
```

Key differences from OpenAI: no `data: ` prefix, `done: true` instead of `[DONE]`, `message.content` instead of `delta.content`.

For `/api/generate`, uses `response` field instead of `message`.

**Home Assistant integration**: HA supports both Ollama and OpenAI conversation integrations. User configures HA to point at `http://<animus-host>:<port>/channels/api/ollama` or `http://<animus-host>:<port>/channels/api/openai/v1`.

**Auth & contact resolution**: Same as OpenAI — no auth, maps to primary contact.

---

## References

- `docs/architecture/plugin-system.md` — Plugin architecture (shared concepts: manifests, installation UX, store distribution)
- `docs/architecture/contacts.md` — Identity resolution, permission tiers, `contact_channels` table
- `docs/architecture/heartbeat.md` — Pipeline that channel adapters feed into
- `docs/architecture/context-builder.md` — Channel reply guidance injection
- `docs/architecture/tech-stack.md` — Database architecture, Encryption Service, Fastify server
- `docs/architecture/voice-channel.md` — Voice channel (built on top of the API channel)
- `docs/architecture/package-installation.md` — Package install flow, rollback, updates, AI self-management
- `../../docs/architecture/distribution-system.md` — Distribution system master overview
- `../../docs/architecture/distribution-security.md` — Security model (signing, integrity, threats)
- `../../animus-extensions/docs/architecture/package-format.md` — `.anpk` format specification (unified manifest)
- `../../animus-extensions/docs/architecture/anipack-cli.md` — `anipack` CLI tool
- `../../animus-store/docs/architecture/store-architecture.md` — Store API, Polar.sh payments, CDN
