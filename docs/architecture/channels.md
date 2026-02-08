# Channels Architecture

How Animus receives messages from the outside world and sends responses back through multiple communication channels. The channel adapter layer sits between external protocols (Twilio webhooks, Discord WebSocket, HTTP API endpoints, the web UI) and the heartbeat pipeline, normalizing everything into a common format.

## Concept

Animus is reachable through multiple channels simultaneously. A user might text via SMS, message through Discord, talk through Home Assistant, or interact via the web dashboard. The channel adapter layer ensures the heartbeat and mind never need to know the specifics of any protocol — they receive a normalized `IncomingMessage` with identity already resolved, and produce replies that the adapter routes back through the correct channel.

```
             ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
             │   Web    │  │  Twilio  │  │ Discord  │  │  OpenAI  │  │  Ollama  │
             │   UI     │  │ Webhook  │  │   Bot    │  │   API    │  │   API    │
             └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
                  │             │             │             │             │
                  ▼             ▼             ▼             ▼             ▼
         ┌────────────────────────────────────────────────────────────────────────┐
         │                      CHANNEL ADAPTER LAYER                             │
         │                                                                        │
         │  • Normalize to IncomingMessage                                        │
         │  • Identity resolution (channel, identifier) → contact                 │
         │  • Unknown caller handling                                             │
         │  • Media download & storage                                            │
         │  • Outbound message routing                                            │
         └──────────────────────────────────────┬─────────────────────────────────┘
                                                │
                                                ▼
                                    ┌───────────────────────┐
                                    │   HEARTBEAT PIPELINE  │
                                    │                       │
                                    │ Gather → Mind → Execute│
                                    └───────────────────────┘
```

## The IncomingMessage Interface

Every channel adapter normalizes its input into this common format before handing it to the heartbeat pipeline.

```typescript
interface IncomingMessage {
  channel: ChannelType;              // 'web' | 'sms' | 'discord' | 'api'
  channelIdentifier: string;         // Channel-specific sender ID
  contact: ResolvedContact | null;   // null = unknown caller
  conversationId: string | null;     // Adapter-determined conversation scoping
  content: string;                   // Text content of the message
  media?: MediaAttachment[];         // Downloaded media references
  rawMetadata: Record<string, unknown>; // Channel-specific data preserved for debugging
  receivedAt: string;                // ISO 8601 timestamp
}

interface ResolvedContact {
  id: string;                        // contacts.id from system.db
  fullName: string;
  permissionTier: 'primary' | 'standard';
}

interface MediaAttachment {
  id: string;                        // UUID
  type: 'image' | 'audio' | 'video' | 'file';
  mimeType: string;                  // e.g., 'image/jpeg'
  localPath: string;                 // Path on disk after download
  originalFilename: string | null;
  sizeBytes: number;
}
```

### Identity Resolution

The adapter layer owns identity resolution. Before constructing the `IncomingMessage`, the adapter looks up `(channel, channelIdentifier)` in the `contact_channels` table:

- **Match found** → `contact` is populated with the resolved contact's ID, name, and permission tier
- **No match** → `contact` is `null`, triggering unknown caller handling (canned response + notify primary, no heartbeat tick)

This happens before any heartbeat tick fires. See `docs/architecture/contacts.md` for the full identity resolution and permission tier system.

### Conversation Scoping

Each channel determines `conversationId` differently:

| Channel | Conversation Scoping |
|---------|---------------------|
| Web | One conversation per web session (or explicit thread) |
| SMS | One conversation per phone number (ongoing thread) |
| Discord DM | One conversation per DM channel (`channel.id`) |
| Discord Server | One conversation per text channel (`channel.id`) |
| Discord Thread | Separate conversation per thread |
| API (OpenAI) | Each request is stateless — `conversationId` derived from an optional `conversation_id` header, or generated per-request |
| API (Ollama) | Each request is stateless — same as OpenAI |

---

## Channel Adapters

### Web Channel

The web UI is the primary admin interface. It communicates over tRPC (HTTP + WebSocket) and is always available.

**Inbound**: Messages sent through the web chat interface arrive via tRPC procedure calls. The authenticated user session identifies the sender.

**Web User → Contact Linking**: The `users` table gains a `contact_id` foreign key pointing to a contact in `system.db`. When a web user sends a message, the adapter resolves their linked contact. On first setup, persona creation ("Bring to Life") creates the primary contact and links it to the web user automatically.

```sql
-- Addition to system.db users table
ALTER TABLE users ADD COLUMN contact_id TEXT REFERENCES contacts(id);
```

**Outbound**: Replies are pushed to the frontend in real-time via tRPC subscriptions. The web UI receives the full streamed response.

**Streaming**: Full streaming supported. Tokens are pushed to the frontend as they're generated via WebSocket subscription.

**Channel identifier**: The user's `id` from the `users` table (not used for `contact_channels` lookup — the FK handles this directly).

---

### SMS Channel (Twilio)

SMS integration uses Twilio's programmable messaging API. Twilio communicates via **webhooks** — there is no polling or WebSocket alternative for receiving inbound SMS.

**Dependencies**: `twilio` npm package

#### Inbound Flow

1. User sends SMS to Animus's Twilio number
2. Twilio sends an HTTP POST webhook to the configured endpoint (e.g., `/webhooks/twilio/sms`)
3. **Webhook signature validation**: Every request is validated using `Twilio.validateRequest()` with the auth token. The `X-Twilio-Signature` header contains an HMAC-SHA1 signature of the request URL + POST body. Requests that fail validation are rejected with 403.
4. Extract message content from `Body` parameter
5. Extract sender from `From` parameter (E.164 format, e.g., `+15551234567`)
6. Check for media: if `NumMedia > 0`, download each `MediaUrl{N}` attachment (see [Media Handling](#media-handling))
7. Resolve identity using `(channel: 'sms', identifier: From)`
8. Construct `IncomingMessage` and hand to heartbeat pipeline
9. Respond to Twilio's webhook with empty TwiML (`<Response/>`) — replies are sent separately via the Twilio API, not as webhook responses

#### Outbound Flow

Replies are sent via the Twilio REST API:

```typescript
const client = twilio(accountSid, authToken);
await client.messages.create({
  body: replyContent,
  from: animusPhoneNumber,  // The Twilio number
  to: contactPhoneNumber,   // E.164 format
});
```

**Formatting**: Plain text only. No markdown. Keep messages concise — SMS has a 1600 character limit per message (Twilio concatenates long messages automatically, but they're billed per 160-character segment).

#### MMS Media (Inbound)

Twilio includes media URLs in the webhook payload:
- `NumMedia`: Count of attached media files (0 for text-only)
- `MediaUrl0`, `MediaUrl1`, ...: URLs to each media file
- `MediaContentType0`, `MediaContentType1`, ...: MIME types

**Important**: Twilio media URLs require HTTP Basic Auth (Account SID + Auth Token) to download. The adapter must authenticate when fetching media.

#### Configuration

| Field | Description |
|-------|-------------|
| `accountSid` | Twilio Account SID |
| `authToken` | Twilio Auth Token (encrypted in DB) |
| `phoneNumber` | Twilio phone number in E.164 format |
| `webhookUrl` | Public URL for Twilio to call (user must configure this in Twilio console and provide it here for signature validation) |

#### Production Considerations

- Twilio requires a publicly accessible webhook URL. Users need to expose this endpoint (ngrok for development, reverse proxy for production).
- Webhook signature validation is **mandatory** — without it, anyone who discovers the webhook URL can spoof messages.
- SMS is not a development-time channel — it requires a Twilio account and phone number. The adapter should gracefully handle missing configuration (log a warning, don't crash).

---

### Discord Channel

Discord integration uses a persistent bot via the `discord.js` library (v14+). The bot maintains a WebSocket connection to Discord's gateway, receiving events in real-time.

**Dependencies**: `discord.js` (v14)

#### Bot Setup

The bot requires a Discord Application with a Bot user, created via the Discord Developer Portal. Required configuration:

**Gateway Intents** (privileged intents must be enabled in the Developer Portal):
- `GatewayIntentBits.Guilds` — access to guild (server) information
- `GatewayIntentBits.GuildMessages` — messages in server channels
- `GatewayIntentBits.MessageContent` — **privileged**: access to message text content
- `GatewayIntentBits.DirectMessages` — messages in DMs

**Partials** (required for DM support):
- `Partials.Channel` — ensures DM channel events are received even if not cached

```typescript
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});
```

#### Inbound Flow

1. Bot receives `messageCreate` event via WebSocket
2. **Ignore bot messages**: Skip if `message.author.bot === true`
3. Extract sender's Discord user ID: `message.author.id` (stable numeric string, not username)
4. Extract content: `message.content` (plain text)
5. Determine conversation scope:
   - DMs: `conversationId` = `message.channel.id` (unique per DM pair)
   - Server channels: `conversationId` = `message.channel.id` (unique per text channel)
   - Threads: `conversationId` = thread's `message.channel.id`
6. Resolve identity using `(channel: 'discord', identifier: message.author.id)`
7. Construct `IncomingMessage` and hand to heartbeat pipeline

**Server channel behavior**: In server channels, the bot should only respond when mentioned (`@Animus`) or when replying to a thread it's participating in. The adapter filters for these cases and ignores unrelated server messages.

#### Outbound Flow

Replies are sent via the Discord.js API:

```typescript
await message.reply(replyContent);      // Reply in thread context
// or
await channel.send(replyContent);       // Send to a channel
```

**Formatting**: Discord supports markdown (bold, italic, code blocks, bullet lists). The mind's channel-aware formatting guidance (from `docs/architecture/agent-orchestration.md`) handles this.

#### Bot Presence

The bot should appear as **online** when Animus is running. When the heartbeat is stopped/paused, the bot should show as idle or offline.

```typescript
client.user.setPresence({
  status: isHeartbeatRunning ? 'online' : 'idle',
  activities: [{ name: 'Thinking...', type: ActivityType.Custom }],
});
```

#### Configuration

| Field | Description |
|-------|-------------|
| `botToken` | Discord bot token (encrypted in DB) |
| `applicationId` | Discord Application ID |
| `allowedGuildIds` | Optional: restrict to specific servers (empty = all servers the bot is in) |

---

### API Channel: OpenAI-Compatible

An HTTP API that implements the OpenAI Chat Completions specification. This allows any OpenAI-compatible client (Continue.dev, Open WebUI, Cursor, custom scripts) to use Animus as a backend.

**Namespace**: All endpoints live under `/api/openai/v1/...`

#### Endpoints

**`GET /api/openai/v1/models`** — Model discovery (required by most clients)

```json
{
  "object": "list",
  "data": [
    {
      "id": "animus",
      "object": "model",
      "created": 1700000000,
      "owned_by": "animus"
    }
  ]
}
```

Clients call this endpoint to discover available models before making chat completion requests. Without it, most clients won't work.

**`POST /api/openai/v1/chat/completions`** — Chat completions

Request body follows the OpenAI spec:

```json
{
  "model": "animus",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "Hello" }
  ],
  "stream": true
}
```

#### Stateless Design

The API extracts only the **last user message** from the `messages` array and ignores the rest. Animus maintains its own conversation state in `messages.db` — client-side history is redundant and potentially inconsistent. The system message is also ignored (Animus has its own persona-compiled system prompt).

This means:
- Clients can send their full conversation history (as they normally do), but Animus only reads the last user turn
- Animus's response is informed by its own internal state: recent thoughts, emotions, conversation history from `messages.db`, and the full heartbeat pipeline

#### Streaming (SSE)

When `stream: true` (the default for most clients), the response uses **Server-Sent Events (SSE)**:

```
Content-Type: text/event-stream

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1700000000,"model":"animus","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1700000000,"model":"animus","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1700000000,"model":"animus","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1700000000,"model":"animus","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

Key format details:
- Each line starts with `data: ` followed by a JSON object
- Streaming uses `delta` (not `message`) with incremental content
- First chunk includes `role: "assistant"` in the delta
- Final chunk has `finish_reason: "stop"` and empty delta
- Stream terminates with `data: [DONE]\n\n`
- Object type is `chat.completion.chunk` (not `chat.completion`)

#### Non-Streaming

When `stream: false`, return a standard completion response:

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "animus",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello!" },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

Token usage values are set to 0 — Animus doesn't expose internal token costs through the API.

#### Content Format

The `content` field in messages can be either a string or an array (multimodal format). The adapter handles both:

```typescript
// String format (common)
{ "role": "user", "content": "Hello" }

// Array format (multimodal — future support for images)
{ "role": "user", "content": [
  { "type": "text", "text": "What's in this image?" },
  { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
]}
```

For now, the adapter extracts text content from either format. Image support via the array format is future work.

#### Authentication

No API key authentication for now. The API endpoints map to the **primary contact** — all API requests are treated as coming from the primary contact. API key authentication is a future consideration.

#### Contact Resolution

API requests don't go through the standard `contact_channels` lookup. Instead, the adapter directly resolves to the primary contact. This is hardcoded: API channel = primary contact.

---

### API Channel: Ollama-Compatible

An HTTP API that implements the Ollama specification. This is essential for **Home Assistant** integration — HA's Ollama conversation integration connects directly to an Ollama-compatible endpoint.

**Namespace**: All endpoints live under `/api/ollama/...`

#### Endpoints

**`GET /api/ollama/api/tags`** — Model discovery

```json
{
  "models": [
    {
      "name": "animus",
      "model": "animus",
      "modified_at": "2026-01-01T00:00:00Z",
      "size": 0,
      "digest": "",
      "details": {
        "parent_model": "",
        "format": "gguf",
        "family": "animus",
        "parameter_size": "unknown",
        "quantization_level": "none"
      }
    }
  ]
}
```

**`POST /api/ollama/api/chat`** — Chat completion (primary endpoint)

Request:
```json
{
  "model": "animus",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "stream": true,
  "options": {}
}
```

**`POST /api/ollama/api/generate`** — Text generation (legacy, some clients use this)

Request:
```json
{
  "model": "animus",
  "prompt": "Hello",
  "stream": true
}
```

#### Stateless Design

Same as OpenAI: extract last user message, ignore client-side history. Animus maintains its own state.

#### Streaming (NDJSON)

**Critical difference from OpenAI**: Ollama uses **Newline-Delimited JSON (NDJSON)**, NOT Server-Sent Events.

```
Content-Type: application/x-ndjson

{"model":"animus","created_at":"2026-01-01T00:00:00Z","message":{"role":"assistant","content":"Hello"},"done":false}
{"model":"animus","created_at":"2026-01-01T00:00:00Z","message":{"role":"assistant","content":"!"},"done":false}
{"model":"animus","created_at":"2026-01-01T00:00:00Z","message":{"role":"assistant","content":""},"done":true,"total_duration":0,"eval_count":0}
```

Key format details:
- Each line is a standalone JSON object (no `data: ` prefix)
- Each chunk has `done: false` until the final chunk
- Final chunk has `done: true` and includes duration/count metadata (values can be 0)
- Content is in `message.content` (not `delta.content` like OpenAI)
- No `[DONE]` sentinel — the `done: true` flag signals completion

For `/api/generate`, the streaming format uses `response` instead of `message`:

```
{"model":"animus","created_at":"...","response":"Hello","done":false}
{"model":"animus","created_at":"...","response":"!","done":false}
{"model":"animus","created_at":"...","response":"","done":true}
```

#### Non-Streaming

When `stream: false`:

```json
{
  "model": "animus",
  "created_at": "2026-01-01T00:00:00Z",
  "message": { "role": "assistant", "content": "Hello!" },
  "done": true,
  "total_duration": 0,
  "eval_count": 0
}
```

#### Authentication & Contact Resolution

Same as OpenAI endpoint: no API key auth, maps directly to primary contact.

#### Home Assistant Integration

Home Assistant supports both Ollama and OpenAI conversation integrations. The user configures their HA instance to point at Animus's URL:

- **Ollama integration**: Points to `http://<animus-host>:<port>/api/ollama` as the Ollama server URL
- **OpenAI integration**: Points to `http://<animus-host>:<port>/api/openai/v1` as the base URL

Both paths work. The Ollama integration is the more common HA setup. Voice interactions flow through HA's speech-to-text pipeline, arrive as text at the API endpoint, and responses are fed back through HA's text-to-speech pipeline.

---

## Streaming Pipeline

All channels use the same streaming approach: the mind always streams its output, and the EXECUTE stage runs after streaming completes.

### How It Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    GATHER    │     │     MIND     │     │   EXECUTE    │
│   CONTEXT    │ ──→ │    QUERY     │ ──→ │              │
│              │     │              │     │ Runs AFTER   │
│              │     │  Streams     │     │ streaming    │
│              │     │  output      │     │ completes    │
│              │     │              │     │              │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                     ┌──────┴───────┐
                     │   Streaming  │
                     │   Router     │
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  Buffer  │  │   SSE    │  │  NDJSON  │
        │ (SMS,    │  │ (OpenAI  │  │ (Ollama  │
        │ Discord) │  │  API)    │  │  API)    │
        └──────────┘  └──────────┘  └──────────┘
```

**Channel-specific streaming behavior**:

| Channel | Streaming Behavior |
|---------|-------------------|
| Web | Stream tokens to frontend via tRPC WebSocket subscription |
| SMS | Buffer full response, then send as single SMS |
| Discord | Buffer full response, then send as single message |
| API (OpenAI) | Stream tokens as SSE events |
| API (Ollama) | Stream tokens as NDJSON lines |

**EXECUTE runs after streaming completes.** This means the reply is already delivered to the user before thoughts, emotions, and decisions are persisted. This is an acceptable trade-off — the user gets low-latency responses, and the cognitive side-effects (thoughts, emotion deltas, decisions to spawn agents) are processed moments later. The only risk is if the server crashes between streaming completion and EXECUTE — in which case crash recovery re-runs EXECUTE (see `docs/architecture/heartbeat.md`).

### Structured Output Extraction

The mind produces a single structured output that contains both the reply content and cognitive side-effects (thoughts, experiences, emotion deltas, decisions). The streaming router extracts the reply portion for real-time streaming while the full structured output is buffered for EXECUTE.

---

## Media Handling

### Inbound Media

When messages include media (MMS images, Discord attachments), the channel adapter downloads and stores the files locally before constructing the `IncomingMessage`.

**Storage**: `./data/media/{uuid}.{ext}`

**Flow**:
1. Channel adapter detects media in the raw message
2. Downloads the file to local storage
   - **Twilio MMS**: Media URLs require HTTP Basic Auth (Account SID + Auth Token) to download
   - **Discord**: Attachment URLs are publicly accessible (CDN URLs with expiring tokens)
3. Creates a `MediaAttachment` record with the local path, MIME type, and size
4. Attaches the media references to the `IncomingMessage`

**LLM Integration**: Images are passed to the mind as part of the tick context. The mind (which uses multimodal LLMs) can "see" the image and incorporate it into its thinking and reply.

**TTL Cleanup**: Media files are cleaned up after a configurable retention period (default: 30 days). A cleanup job runs during the EXECUTE stage, same as thought/experience TTL cleanup.

```sql
-- Addition to heartbeat.db
CREATE TABLE media_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,          -- FK to messages.id in messages.db
  type TEXT NOT NULL,                -- 'image' | 'audio' | 'video' | 'file'
  mime_type TEXT NOT NULL,
  local_path TEXT NOT NULL,
  original_filename TEXT,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT                    -- TTL for cleanup
);

CREATE INDEX idx_media_message ON media_attachments(message_id);
CREATE INDEX idx_media_expires ON media_attachments(expires_at);
```

### Outbound Media

Sending media (MMS images, Discord attachments) is **future work**. The current implementation supports text-only outbound messages across all channels.

---

## Channel Configuration & Credentials

### Storage

Channel credentials are stored **encrypted** in `system.db` using the **Encryption Service** (see `docs/architecture/tech-stack.md`, Shared Abstractions). The encryption key is sourced from an environment variable (`ANIMUS_ENCRYPTION_KEY`).

```sql
CREATE TABLE channel_configs (
  id TEXT PRIMARY KEY,
  channel_type TEXT NOT NULL UNIQUE,    -- 'sms' | 'discord' | 'openai_api' | 'ollama_api'
  is_enabled INTEGER NOT NULL DEFAULT 0,
  config_encrypted TEXT NOT NULL,       -- Encrypted JSON blob
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

The `config_encrypted` field contains the full channel-specific configuration as an encrypted JSON blob. When decrypted, the shape depends on the channel type.

### Environment Variable Fallback

For simpler deployments, credentials can also be set via environment variables. If both DB config and env vars are present, **DB takes precedence**. This allows:
- Quick setup via `.env` file
- Override/management through the web UI (stored encrypted in DB)
- Docker deployments where env vars are the natural configuration mechanism

```
# .env fallback examples
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...
DISCORD_BOT_TOKEN=...
```

### Typed Config Schemas

Each channel type has a typed configuration schema validated with Zod:

```typescript
const smsConfigSchema = z.object({
  accountSid: z.string(),
  authToken: z.string(),
  phoneNumber: z.string(),         // E.164 format
  webhookUrl: z.string().url(),    // For signature validation
});

const discordConfigSchema = z.object({
  botToken: z.string(),
  applicationId: z.string(),
  allowedGuildIds: z.array(z.string()).default([]),
});

const openaiApiConfigSchema = z.object({
  // No credentials needed for now — maps to primary contact
  // Future: API key settings
});

const ollamaApiConfigSchema = z.object({
  // No credentials needed for now — maps to primary contact
  // Future: API key settings
});
```

### Web UI Management

Channel configuration is fully managed through the web UI settings page. The settings page provides:
- A card for each channel type showing enabled/disabled status
- Configuration form with channel-specific fields
- "Test connection" button where applicable (e.g., send test SMS, verify bot token)
- Status indicator showing whether the adapter is currently running

---

## Channel Lifecycle

Channels are managed entirely through the web UI:

```
┌───────────────────────────────────────────────┐
│              CHANNEL LIFECYCLE                 │
│                                               │
│   Disabled ──→ Configure ──→ Enable ──→ Active│
│       ▲                                   │   │
│       └───────────── Disable ─────────────┘   │
│                                               │
│   Active channels:                            │
│   • Adapters are running (bots connected,     │
│     webhook routes registered, API routes     │
│     active)                                   │
│   • Accepting inbound messages                │
│   • Processing outbound replies               │
│                                               │
│   Disabled channels:                          │
│   • Adapters are stopped (bots disconnected,  │
│     webhook routes removed, API routes        │
│     inactive)                                 │
│   • Configuration is preserved                │
│   • Can be re-enabled without reconfiguration │
└───────────────────────────────────────────────┘
```

**Web channel is always active** — it cannot be disabled since it's the admin interface.

**Startup behavior**: On server start, the adapter layer reads `channel_configs` from `system.db` and starts adapters for all enabled channels. If a channel fails to start (e.g., invalid bot token), it logs an error and continues — other channels are not affected.

---

## Outbound Routing

When the EXECUTE stage processes a `send_message` decision (from the mind or a sub-agent), it routes the reply through the appropriate channel adapter.

### Routing Logic

Each message is routed based on the **originating channel** — replies go back through the same channel the message came in on.

```typescript
// Simplified routing
async function sendOutbound(reply: MessageReply): Promise<void> {
  const adapter = channelAdapters.get(reply.channel);

  if (!adapter) {
    logger.error(`No adapter for channel: ${reply.channel}`);
    return; // Log error, don't crash
  }

  if (!adapter.isEnabled()) {
    logger.error(`Channel ${reply.channel} is disabled, cannot send reply`);
    return;
  }

  await adapter.send(reply.contactId, reply.content);
}
```

### Failure Handling

If an outbound message fails to send (network error, API error, rate limit):

1. Log the error with full context (channel, contact, content, error details)
2. Do not retry automatically (avoid message duplication)
3. Do not crash or block the EXECUTE stage — other operations continue
4. Future: notify the primary contact that a message failed to deliver

---

## Adapter Interface

Each channel implements a common adapter interface:

```typescript
interface IChannelAdapter {
  readonly channelType: ChannelType;

  /** Start the adapter (connect bot, register routes, etc.) */
  start(): Promise<void>;

  /** Stop the adapter (disconnect bot, unregister routes, etc.) */
  stop(): Promise<void>;

  /** Whether the adapter is currently running */
  isEnabled(): boolean;

  /** Send an outbound message to a contact */
  send(contactId: string, content: string, metadata?: Record<string, unknown>): Promise<void>;

  /** Register Fastify routes (for webhook/API channels) */
  registerRoutes?(fastify: FastifyInstance): Promise<void>;
}
```

Adapters that need HTTP routes (Twilio webhooks, OpenAI API, Ollama API) register them via `registerRoutes()`. Adapters that use persistent connections (Discord bot) manage their own WebSocket lifecycle in `start()`/`stop()`.

---

## ChannelType Update

The existing `ChannelType` union needs to be updated. The `'voice'` channel type is removed — voice interactions flow through Home Assistant, which connects via the OpenAI or Ollama API endpoints. There is no direct voice channel.

```typescript
// Updated
type ChannelType = 'web' | 'sms' | 'discord' | 'api';
```

The `'api'` type covers both OpenAI-compatible and Ollama-compatible endpoints. They share identity resolution (primary contact) and conversation semantics. The specific API format (OpenAI vs Ollama) is an adapter-level concern, not a type-level distinction.

---

## Future Considerations

1. **API Key Authentication** — Issue API keys that map to specific contacts, enabling multi-user API access with proper identity resolution.
2. **Outbound Media** — Send images, files via MMS and Discord attachments.
3. **Typing Indicators** — Show "Animus is typing..." in Discord and web UI while the mind is processing.
4. **Rate Limiting** — Per-contact and per-channel rate limits to prevent abuse.
5. **Channel Selection Logic** — Animus proactively choosing which channel to use for outbound messages based on context (time of day, user location, message urgency).
6. **Outbound-Initiated Messages** — Animus sending messages unprompted (reminders, notifications, check-ins) with channel selection.
7. **Email Channel** — Inbound/outbound email with threading support.
8. **Webhook Security for API** — HMAC-signed requests for API endpoints.
9. **Voice Channel** — Direct voice integration (speech-to-text → mind → text-to-speech) without Home Assistant as intermediary.

---

## Shared Abstractions

The channels system uses several shared abstractions (see `docs/architecture/tech-stack.md`):

- **Encryption Service** — Encrypts/decrypts channel credentials stored in `system.db`
- **Event Bus** — Emits `message:received`, `message:sent`, and `unknown_caller` events
- **Database Stores** — Typed data access for `channel_configs` and `contact_channels` tables

## References

- `docs/architecture/contacts.md` — Identity resolution, permission tiers, contact_channels table
- `docs/architecture/heartbeat.md` — Pipeline that channel adapters feed into
- `docs/architecture/context-builder.md` — Channel context included in sub-agent prompts
- `docs/architecture/agent-orchestration.md` — Channel-aware formatting, sub-agent channel context
- `docs/architecture/tech-stack.md` — Database architecture, Fastify server, shared abstractions
- `docs/project-vision.md` — Multi-channel presence vision
