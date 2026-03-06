# Channel Reference Specs

> **Scope**: Implementation reference for individual channel adapters (SMS, Discord, OpenAI API, Ollama API). Covers protocol details, webhook formats, streaming formats, and configuration specifics for each channel type.
>
> **See also**: `docs/architecture/channel-packages.md` is the single source of truth for the channel *system* architecture: packaging, the IncomingMessage protocol, identity resolution, child process isolation, IPC, the Channel Manager, installation lifecycle, security model, and the adapter interface. Read that doc first.

This document provides the protocol-level reference information that channel adapter authors need when building specific adapters. The web channel (built-in) is documented in `channel-packages.md`.

---

## SMS Channel (Twilio)

SMS integration uses Twilio's programmable messaging API. Twilio communicates via **webhooks**; there is no polling or WebSocket alternative for receiving inbound SMS.

**Dependencies**: `twilio` npm package

### Inbound Flow

1. User sends SMS to Animus's Twilio number
2. Twilio sends an HTTP POST webhook to the configured endpoint (e.g., `/channels/sms/webhook`)
3. **Webhook signature validation**: Every request is validated using `Twilio.validateRequest()` with the auth token. The `X-Twilio-Signature` header contains an HMAC-SHA1 signature of the request URL + POST body. Requests that fail validation are rejected with 403.
4. Extract message content from `Body` parameter
5. Extract sender from `From` parameter (E.164 format, e.g., `+15551234567`)
6. Check for media: if `NumMedia > 0`, download each `MediaUrl{N}` attachment via `ctx.downloadMedia()` (see MMS Media below)
7. Call `ctx.reportIncoming()` with `identifier: From`, `content: Body`
8. Respond to Twilio's webhook with empty TwiML (`<Response/>`) via the route response. Replies are sent separately via the Twilio API, not as webhook responses.

### Outbound Flow

Replies are sent via the Twilio REST API:

```typescript
const client = twilio(ctx.config.accountSid, ctx.config.authToken);
await client.messages.create({
  body: replyContent,
  from: ctx.config.phoneNumber,  // The Twilio number
  to: contactIdentifier,         // E.164 format
});
```

**Formatting**: Plain text only. No markdown. Keep messages concise. SMS has a 1600 character limit per message (Twilio concatenates long messages automatically, but they're billed per 160-character segment).

### MMS Media (Inbound)

Twilio includes media URLs in the webhook payload:
- `NumMedia`: Count of attached media files (0 for text-only)
- `MediaUrl0`, `MediaUrl1`, ...: URLs to each media file
- `MediaContentType0`, `MediaContentType1`, ...: MIME types

**Important**: Twilio media URLs require HTTP Basic Auth (Account SID + Auth Token) to download. The adapter passes auth credentials to `ctx.downloadMedia()`.

### Configuration (config.schema.json)

| Field | Type | Description |
|-------|------|-------------|
| `accountSid` | text | Twilio Account SID |
| `authToken` | secret | Twilio Auth Token |
| `phoneNumber` | text | Twilio phone number in E.164 format |
| `webhookUrl` | url | Public URL for Twilio to call (user configures this in Twilio console; needed for signature validation) |

### Production Considerations

- Twilio requires a publicly accessible webhook URL. Users need to expose this endpoint (ngrok for development, reverse proxy for production).
- Webhook signature validation is **mandatory**; without it, anyone who discovers the webhook URL can spoof messages.
- SMS is not a development-time channel. It requires a Twilio account and phone number. The adapter should gracefully handle missing configuration (log a warning, don't crash).

### Reply Guidance (replyGuidance)

```
Keep replies concise, 1-2 sentences. Plain text only, no markdown or formatting. SMS has a 1600 character limit.
```

---

## Discord Channel

Discord integration uses a persistent bot via the `discord.js` library (v14+). The bot maintains a WebSocket connection to Discord's gateway, receiving events in real-time.

**Dependencies**: `discord.js` (v14)

### Bot Setup

The bot requires a Discord Application with a Bot user, created via the Discord Developer Portal. Required configuration:

**Gateway Intents** (privileged intents must be enabled in the Developer Portal):
- `GatewayIntentBits.Guilds` -- access to guild (server) information
- `GatewayIntentBits.GuildMessages` -- messages in server channels
- `GatewayIntentBits.MessageContent` -- **privileged**: access to message text content
- `GatewayIntentBits.DirectMessages` -- messages in DMs

**Partials** (required for DM support):
- `Partials.Channel` -- ensures DM channel events are received even if not cached

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

### Inbound Flow

1. Bot receives `messageCreate` event via WebSocket
2. **Ignore bot messages**: Skip if `message.author.bot === true`
3. Extract sender's Discord user ID: `message.author.id` (stable numeric string, not username)
4. Extract content: `message.content` (plain text)
5. Determine conversation scope and type:
   - DMs: `conversationId` = `message.channel.id`, `conversationType` = `'owned'`
   - Server channels: `conversationId` = `message.channel.id`, `conversationType` = `'participated'`
   - Threads: `conversationId` = thread's `message.channel.id`, `conversationType` = `'participated'`
6. Call `ctx.reportIncoming()` with `identifier: message.author.id`, `content: message.content`

**Server channel behavior**: In server channels, the bot should only respond when mentioned (`@Animus`) or when replying to a thread it's participating in. The adapter filters for these cases and ignores unrelated server messages.

### Outbound Flow

Replies are sent via the Discord.js API:

```typescript
await message.reply(replyContent);      // Reply in thread context
// or
await channel.send(replyContent);       // Send to a channel
```

**Formatting**: Discord supports markdown (bold, italic, code blocks, bullet lists).

### Bot Presence

The bot should appear as **online** when Animus is running. When the heartbeat is stopped/paused, the bot should show as idle or offline.

```typescript
client.user.setPresence({
  status: isHeartbeatRunning ? 'online' : 'idle',
  activities: [{ name: 'Thinking...', type: ActivityType.Custom }],
});
```

### Configuration (config.schema.json)

| Field | Type | Description |
|-------|------|-------------|
| `botToken` | secret | Discord bot token |
| `applicationId` | text | Discord Application ID |
| `allowedGuildIds` | text-list | Optional: restrict to specific servers (empty = all servers the bot is in) |

### Reply Guidance (replyGuidance)

```
Discord supports markdown formatting. Use bold, italic, code blocks, and bullet lists as appropriate. Keep responses conversational.
```

---

## API Channel: OpenAI-Compatible

An HTTP API that implements the OpenAI Chat Completions specification. This allows any OpenAI-compatible client (Continue.dev, Open WebUI, Cursor, custom scripts) to use Animus as a backend.

**Namespace**: All endpoints live under `/channels/api-openai/...` (via the catch-all route in `channel-packages.md`).

### Endpoints

**`GET /v1/models`** -- Model discovery (required by most clients)

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

**`POST /v1/chat/completions`** -- Chat completions

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

### Stateless Design

The API extracts only the **last user message** from the `messages` array and ignores the rest. Animus maintains its own conversation state in `messages.db`. The system message is also ignored (Animus has its own persona-compiled system prompt).

This means:
- Clients can send their full conversation history (as they normally do), but Animus only reads the last user turn
- Animus's response is informed by its own internal state: recent thoughts, emotions, conversation history from `messages.db`, and the full heartbeat pipeline

### Streaming (SSE)

When `stream: true` (the default for most clients), the response uses **Server-Sent Events (SSE)** via the IPC streaming protocol (see `channel-packages.md`):

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

### Non-Streaming

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

Token usage values are set to 0. Animus doesn't expose internal token costs through the API.

### Content Format

The `content` field in messages can be either a string or an array (multimodal format). The adapter handles both:

```typescript
// String format (common)
{ "role": "user", "content": "Hello" }

// Array format (multimodal, future support for images)
{ "role": "user", "content": [
  { "type": "text", "text": "What's in this image?" },
  { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
]}
```

For now, the adapter extracts text content from either format. Image support via the array format is future work.

### Authentication & Contact Resolution

No API key authentication for now. All API requests are treated as coming from the primary contact. API key authentication is a future consideration.

---

## API Channel: Ollama-Compatible

An HTTP API that implements the Ollama specification. This is essential for **Home Assistant** integration, since HA's Ollama conversation integration connects directly to an Ollama-compatible endpoint.

**Namespace**: All endpoints live under `/channels/api-ollama/...` (via the catch-all route).

### Endpoints

**`GET /api/tags`** -- Model discovery

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

**`POST /api/chat`** -- Chat completion (primary endpoint)

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

**`POST /api/generate`** -- Text generation (legacy, some clients use this)

Request:
```json
{
  "model": "animus",
  "prompt": "Hello",
  "stream": true
}
```

### Stateless Design

Same as OpenAI: extract last user message, ignore client-side history. Animus maintains its own state.

### Streaming (NDJSON)

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
- No `[DONE]` sentinel; the `done: true` flag signals completion

For `/api/generate`, the streaming format uses `response` instead of `message`:

```
{"model":"animus","created_at":"...","response":"Hello","done":false}
{"model":"animus","created_at":"...","response":"!","done":false}
{"model":"animus","created_at":"...","response":"","done":true}
```

### Non-Streaming

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

### Authentication & Contact Resolution

Same as OpenAI endpoint: no API key auth, maps directly to primary contact.

### Home Assistant Integration

Home Assistant supports both Ollama and OpenAI conversation integrations. The user configures their HA instance to point at Animus's URL:

- **Ollama integration**: Points to `http://<animus-host>:<port>/channels/api-ollama` as the Ollama server URL
- **OpenAI integration**: Points to `http://<animus-host>:<port>/channels/api-openai/v1` as the base URL

Both paths work. The Ollama integration is the more common HA setup. Voice interactions flow through HA's speech-to-text pipeline, arrive as text at the API endpoint, and responses are fed back through HA's text-to-speech pipeline.

---

## Future Channel Considerations

1. **API Key Authentication** -- Issue API keys that map to specific contacts, enabling multi-user API access with proper identity resolution.
2. **Outbound Media** -- Send images and files via MMS and Discord attachments.
3. **Typing Indicators** -- Show "Animus is typing..." in Discord (via `performAction`, see `channel-packages.md`).
4. **Rate Limiting** -- Per-contact and per-channel rate limits to prevent abuse.
5. **Email Channel** -- Inbound/outbound email with threading support.
6. **Webhook Security for API** -- HMAC-signed requests for API endpoints.
7. **Voice Channel** -- Direct voice integration. See `docs/architecture/voice-channel.md` for the full architecture using Parakeet TDT v3 (STT) and Pocket TTS. See `docs/architecture/speech-engine.md` for the shared speech engine.

---

## References

- `docs/architecture/channel-packages.md` -- Channel system architecture (packaging, protocol, isolation, lifecycle, security)
- `docs/architecture/contacts.md` -- Identity resolution, permission tiers, contact_channels table
- `docs/architecture/heartbeat.md` -- Pipeline that channel adapters feed into
- `docs/architecture/context-builder.md` -- Channel context included in sub-agent prompts
- `docs/architecture/voice-channel.md` -- Voice channel architecture
- `docs/architecture/speech-engine.md` -- Shared speech engine
