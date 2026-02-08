# Contacts & Identity Architecture

How Animus identifies who it's communicating with, enforces permission boundaries between contacts, and isolates sensitive information across conversations.

## Concepts

### Contacts vs Users

**Users** are web UI administrators. They authenticate with email/password to access the Animus dashboard, configure settings, manage personality, and observe the heartbeat. A user is the person who runs this Animus instance.

**Contacts** are people Animus communicates with through messaging channels (SMS, Discord, voice, web UI, etc.). A contact represents an identity in Animus's social world. There can be many contacts. One of them is designated the **primary contact** — the person Animus "belongs to."

Users and contacts are **linked but distinct** concepts. Every web UI user has a corresponding contact record (created automatically at signup). The contact record is what gives the user an identity in Animus's social world — it's how the mind knows who it's talking to, regardless of whether the message came from the web UI, SMS, or Discord.

### User-Contact Auto-Creation

When a user signs up through the web UI:

1. A user record is created in `system.db` (authentication, dashboard access)
2. A contact record is **automatically created** and linked via `user_id`
3. A `contact_channels` entry is created with `channel: 'web'` and the user's ID as the identifier
4. Contact details (name, phone, email) are collected during signup

**The very first user to sign up is marked as the primary contact.** All subsequent users create non-primary contacts. This ensures Animus always has a primary contact from the moment the first user completes onboarding.

This means web UI messages flow through the same contact-based pipeline as all other channels. When a user sends a message from the web UI, it resolves to their linked contact record, and the heartbeat tick processes it like any other message — with the same identity resolution, permission tier enforcement, and message isolation.

### Primary Contact

Exactly one contact is the primary contact at any given time. The primary contact is the owner — the person Animus works for. They have full access to Animus's capabilities: spawning sub-agents, scheduling tasks, accessing personal tools (calendar, etc.), and modifying goals.

If the primary flag is moved to a different contact:
- The previous primary loses elevated permissions immediately
- Running sub-agents spawned for the previous primary continue to completion (don't kill in-progress work)
- Scheduled tasks created under the previous primary's authority are flagged for the new primary to review
- The swap is logged as a significant system event
- Only the web UI (authenticated user) can change the primary contact designation

### Non-Primary Contacts

Non-primary contacts are other people in Animus's life — friends, family, coworkers. They can message Animus and receive replies, but they operate under a restricted permission tier. Animus still thinks about their messages, forms experiences, and has emotional responses — but it cannot take powerful actions on their behalf.

### Unknown Callers

When a message arrives from an unrecognized channel identifier (unknown phone number, unknown Discord ID, etc.), the system does **not** trigger a full cognitive cycle. Instead:

1. The ingestion layer identifies the sender as unknown
2. A brief, canned response is sent: something like "I don't recognize this number. If you know me, ask my owner to add you as a contact."
3. The primary contact is notified: "Unknown message received from +1-555-0199: '{message preview}'"
4. No heartbeat tick fires. No thoughts, experiences, or emotions are generated.
5. The message is logged for audit purposes but does not enter the conversation pipeline.

This prevents unknown callers from consuming cognitive resources, triggering tool use, or accessing any information.

---

## Contact Data Model

### Contact Record

Contacts are stored in `system.db` as persistent configuration.

```typescript
interface Contact {
  id: UUID;
  userId: UUID | null;          // FK → users.id (null for contacts without web UI accounts)
  fullName: string;
  phoneNumber: string | null;   // E.164 format (+1234567890)
  email: string | null;
  isPrimary: boolean;           // Exactly one contact has this set to true
  permissionTier: 'primary' | 'standard';  // Derived from isPrimary, but explicit for clarity
  notes: string | null;         // Optional freeform notes (relationship, preferences, etc.)
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### Contact Channels

A single contact can be reachable on multiple channels. The `contact_channels` table maps channel-specific identifiers to a contact record.

```typescript
interface ContactChannel {
  id: UUID;
  contactId: UUID;              // FK → contacts.id
  channel: ChannelType;         // 'sms' | 'discord' | 'voice' | 'web' | 'api'
  identifier: string;           // Channel-specific: phone number, Discord user ID, etc.
  displayName: string | null;   // How they appear on this channel (Discord nickname, etc.)
  isVerified: boolean;          // Has identity been confirmed?
  createdAt: Timestamp;
}
```

**Identity resolution**: When a message arrives, the system looks up `(channel, identifier)` in `contact_channels` to find the contact. If no match → unknown caller handling.

**Examples:**
| Channel | Identifier | Notes |
|---|---|---|
| sms | `+15551234567` | E.164 phone number |
| discord | `123456789012345678` | Discord user ID (not username — usernames change) |
| voice | `home_assistant_user_1` | Home Assistant user/device ID |
| web | `user_abc123` | Web UI user ID — resolves to the linked contact record |
| api | `api_key_abc123` | API key identifier |

### SQLite Schema (system.db)

```sql
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),  -- Linked web UI user (null for non-UI contacts)
  full_name TEXT NOT NULL,
  phone_number TEXT,              -- E.164 format
  email TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Enforce exactly one primary contact at the database level
CREATE UNIQUE INDEX idx_contacts_primary
  ON contacts(is_primary) WHERE is_primary = 1;

CREATE TABLE contact_channels (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,          -- 'sms' | 'discord' | 'voice' | 'api'
  identifier TEXT NOT NULL,       -- Channel-specific identifier
  display_name TEXT,
  is_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channel, identifier)     -- One identity per channel identifier
);

CREATE INDEX idx_contact_channels_lookup
  ON contact_channels(channel, identifier);
```

The `UNIQUE` constraint on `(channel, identifier)` ensures no two contacts claim the same phone number, Discord ID, etc.

The partial unique index on `is_primary WHERE is_primary = 1` ensures the database itself prevents multiple primary contacts.

---

## Permission Tiers

Permissions are enforced at multiple layers (prompt instructions, context filtering, and hard enforcement in EXECUTE). The table below defines what each tier can and cannot do.

| Capability | Primary | Standard (Non-Primary) | Unknown |
|---|---|---|---|
| Trigger heartbeat tick | Yes | Yes | No |
| Receive replies | Yes | Yes | Canned response only |
| Generate thoughts/experiences | Yes | Yes | No |
| Spawn sub-agents | Yes | **No** | No |
| Schedule tasks | Yes | **No** | No |
| Update/create goals | Yes | **No** | No |
| Cancel running agents | Yes | **No** | No |
| Access personal tools (calendar, etc.) | Yes | **No** | No |
| Access system configuration | Yes | **No** | No |
| View Animus's emotional state (via replies) | Yes | Naturally colored | No |
| Message history visible to mind | Own thread | Own thread | None |

### Tool Restrictions by Tier

MCP tools available to the mind and sub-agents must be filtered based on the contact that triggered the current tick. This is a **hard system configuration** — the tool list is assembled during GATHER CONTEXT and passed to the mind/sub-agent session. Tools that are unavailable for the current contact are simply not present in the tool list.

```
Primary contact tick:
  Available tools: [send_message, spawn_agent, calendar_lookup, read_memory,
                    schedule_task, update_goal, system_config, ...]

Standard contact tick:
  Available tools: [send_message, read_memory]
```

The mind cannot call tools it doesn't have. This is a hard boundary — not prompt-dependent.

### Allowed Decision Types by Tier

Even with tool filtering, the EXECUTE stage validates decisions from the mind's structured output:

| Decision Type | Primary | Standard |
|---|---|---|
| `spawn_agent` | Execute | **Drop + log warning** |
| `update_agent` | Execute | **Drop + log warning** |
| `cancel_agent` | Execute | **Drop + log warning** |
| `send_message` | Execute | Execute (to triggering contact only) |
| `update_goal` | Execute | **Drop + log warning** |
| `schedule_task` | Execute | **Drop + log warning** |
| `no_action` | Execute | Execute |

If the mind produces a disallowed decision during a standard-contact tick, the EXECUTE stage silently drops it and logs a warning. This is the belt-and-suspenders layer on top of tool filtering and prompt instructions.

---

## Integration with the Heartbeat Pipeline

### Ingestion (Pre-Pipeline)

Before a heartbeat tick fires, the ingestion layer processes the incoming message:

```
Incoming Message (SMS, Discord, etc.)
        │
        ▼
┌──────────────────────┐
│  IDENTITY RESOLUTION │
│                      │
│  (channel, id) →     │
│   contact_channels   │
│   lookup             │
└──────┬───────────────┘
       │
       ├── Contact found ──→ Tag message with contactId, permissionTier
       │                     Proceed to heartbeat tick
       │
       └── Not found ──→ Unknown caller handling
                         Canned response + notify primary
                         No heartbeat tick
```

### Stage 1: GATHER CONTEXT

Contact-aware context assembly. The trigger context now includes identity information:

```typescript
interface MessageTriggerContext {
  type: 'message';
  contactId: string;
  contactName: string;
  permissionTier: 'primary' | 'standard';
  channel: ChannelType;
  channelIdentifier: string;
  messageContent: string;
  messageId: string;
  timestamp: string;
}
```

What gets loaded changes based on contact:

| Context Item | Behavior |
|---|---|
| Trigger context | Includes contactId, permissionTier, channel |
| Message history | **Filtered to triggering contact only** (from messages.db) |
| Thoughts | All recent thoughts (Animus's unified inner life) |
| Experiences | All recent experiences |
| Emotional state | Full emotional state |
| Active goals | All goals (primary) / Read-only summary (standard) |
| Running sub-agents | Full status (primary) / Omitted (standard) |
| Available tools | Filtered by permission tier |

The mind receives an explicit permission block as part of its context:

```
── CURRENT INTERACTION ──
Contact: Mom (standard tier)
Channel: SMS (+15551234567)
Permissions: Reply only. No sub-agents, tasks, goals, or personal tools.
Privacy: Do NOT reference conversations with other contacts. Do NOT share
personal information about other contacts. Keep this conversation self-contained.
──────────────────────────
```

### Stage 2: MIND QUERY

The mind produces its structured output as normal, but:
- The prompt includes the permission block above
- The tool list only contains tools allowed for this permission tier
- Instructions explicitly state which decision types are available

The mind naturally adapts its behavior — it knows it's talking to a non-primary contact and adjusts accordingly. But we don't rely on this alone.

### Stage 3: EXECUTE

Hard enforcement:
1. Validate each decision against the permission tier
2. Drop disallowed decisions, log warnings
3. Send replies only to the triggering contact on the originating channel
4. Persist thoughts, experiences, emotions as normal (unified inner life)
5. Store message and reply in messages.db tagged with `contact_id`

---

## Message Storage (messages.db)

Messages live in `messages.db` — a dedicated database with long-term retention that persists across heartbeat resets. This is important: if the heartbeat/mind is reset, conversation history is preserved.

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,         -- FK reference to system.db contacts.id
  channel TEXT NOT NULL,            -- Channel this conversation is on
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_conversations_contact ON conversations(contact_id);
CREATE INDEX idx_conversations_active ON conversations(is_active, last_message_at);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  contact_id TEXT NOT NULL,         -- Denormalized for fast filtering
  direction TEXT NOT NULL,          -- 'inbound' | 'outbound'
  channel TEXT NOT NULL,            -- Channel message was sent/received on
  content TEXT NOT NULL,
  metadata TEXT,                    -- JSON: channel-specific metadata
  tick_number INTEGER,              -- Which heartbeat tick processed this (null for outbound from sub-agents)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_contact ON messages(contact_id, created_at);
CREATE INDEX idx_messages_tick ON messages(tick_number);
```

### Why a Separate Database?

Messages have a fundamentally different lifecycle than heartbeat state:
- **Heartbeat.db** may be reset during development, debugging, or personality reconfiguration. Thoughts and experiences are ephemeral (TTL-based).
- **Messages.db** should persist. Conversation history is valuable long-term context. Resetting the heartbeat shouldn't erase what people said to Animus.
- **System.db** is configuration. Messages are operational data — high write volume, different retention policies.

---

## Sub-Agent Contact Scoping

When the mind delegates work to a sub-agent, the sub-agent must be scoped to the correct contact.

### agent_tasks Table Addition

The `agent_tasks` table in `heartbeat.db` needs a `contact_id` column:

```sql
ALTER TABLE agent_tasks ADD COLUMN contact_id TEXT;  -- FK reference to system.db contacts.id
```

### Prompt Template Changes

The sub-agent prompt template (see `docs/architecture/agent-orchestration.md`) adds contact context:

```
┌─────────────────────────────────────────────────────┐
│                  SUB-AGENT PROMPT                    │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  TEMPLATE CONTEXT (system-assembled)          │  │
│  │                                               │  │
│  │  • Personality & behavioral instructions      │  │
│  │  • Emotional state snapshot                   │  │
│  │  • Recent thoughts (~10)                      │  │
│  │  • Recent experiences (~10)                   │  │
│  │  • Recent messages from THIS CONTACT (~10) ◄──── Contact-filtered  │
│  │  • Contact identity & permission tier     ◄──── NEW  │
│  │  • Channel context (SMS, Discord, etc.)       │  │
│  │  • Available tools (tier-filtered)        ◄──── NEW  │
│  │  • Environment (time, date, etc)              │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  CONTACT CONTEXT                          NEW │  │
│  │                                               │  │
│  │  • Contact name and tier                      │  │
│  │  • Originating channel and identifier         │  │
│  │  • Reply instructions (channel + contact)     │  │
│  │  • Privacy instructions (don't cross-share)   │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  TASK INSTRUCTIONS (mind-provided)            │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

Sub-agents only spawn for primary contact tasks (enforced in EXECUTE), so in practice sub-agents always operate under primary-tier permissions. But the contact scoping still matters for:
- Loading the correct message history
- Replying on the correct channel to the correct contact
- Including the contact's name and context in the prompt

---

## Contact Notes & "Notes About You"

Every contact record has a `notes` text field for freeform context about who that contact is. This is conceptually "knowledge about a contact" — relationship context, preferences, personal details that help Animus interact with them appropriately.

### Primary Contact: "Notes About You"

During onboarding (Step 3: Your Identity), the user provides personal context about themselves — the kind of information that helps Animus know them better. This free text is stored as the primary contact's `notes` field.

**Example content:**
> "I'm a software engineer living in Austin. I have a dog named Max. I prefer morning meetings and hate being called before 9 AM. I'm working on a home automation project."

### How Notes Are Surfaced

The primary contact's `notes` are included in the **base system prompt on every tick** via the Context Builder (see `docs/architecture/context-builder.md`). They're always present in the mind's context — not retrieved via memory search, but hardcoded alongside the persona. This is user-configured knowledge, not something the AI "learned."

For non-primary contacts, notes are surfaced during GATHER CONTEXT when that contact triggers a tick — as part of the contact identity block.

### Editability

Contact notes are editable from the web UI settings at any time — they're just a text field on the contact record. For the primary contact, this is accessible from both the contact settings and from a "Notes About You" section in the persona/identity settings area.

### Token Budget

The Context Builder allocates a soft cap (~500 tokens) for the primary contact's notes within the system prompt section. If notes exceed this cap, they are truncated with a warning displayed in the settings UI encouraging the user to be more concise.

---

## Information Sharing Boundaries

### What IS Shared Across Contacts (Unified Inner Life)

These are part of Animus as an entity. They exist regardless of who triggered them:

- **Thoughts** — Animus's observations, insights, questions, intentions
- **Experiences** — Notable events in Animus's inner life
- **Emotions** — Current emotional state and shifts
- **Goals** — What Animus is working toward
- **Long-term memory** — Animus's consolidated memories (LanceDB)

A thought like "Mom seems stressed today" is Animus's own observation. It exists in the thought stream and may influence Animus's behavior in future ticks — for any contact. This is by design: Animus has a unified consciousness.

### What is NOT Shared Across Contacts

- **Message history** — Each contact's conversation is loaded independently. The mind only sees the current contact's messages during a tick.
- **Sub-agent results** — Results are tagged with `contact_id` and only surfaced to the originating contact.
- **Scheduled task details** — Tasks are associated with the contact that triggered them.

### The Soft Boundary: Cross-Contact Disclosure

Even though thoughts and experiences are shared, Animus should not freely *disclose* information about one contact to another. This is enforced via prompt instructions:

> "You are Animus. Your thoughts and experiences are your own — they make you who you are. However, when communicating with any contact, exercise discretion. Do not share details of conversations with other contacts. Do not reveal personal information one contact shared with you to another contact. Treat each relationship as its own space, even though your inner life is unified. You may reference your own feelings or general observations, but keep specifics private unless the contact involved has given you reason to believe sharing is appropriate."

This is a soft boundary. The mind is an LLM and may occasionally leak. Accept this as a limitation and mitigate through strong prompting, message history isolation, and the fact that the mind's context is refreshed each tick with only the relevant contact's messages.

---

## Future Considerations

1. **Contact groups** — Grouping contacts (family, work, friends) for shared permission policies or group message threads.
2. **Per-contact personality tuning** — Animus might be more formal with a boss, more casual with a friend. Contact-level personality overrides.
3. **Contact approval workflow** — Unknown callers could create "pending contact" entries for the primary to approve via the web UI, rather than being ignored entirely.
4. **Contact-scoped memory** — LanceDB memories tagged with contact context, so the mind can recall contact-specific history during semantic search.
5. **Rate limiting per contact** — Prevent a non-primary contact from flooding the system with messages and consuming cognitive resources.
6. **Contact-to-contact introduction** — If Animus knows both parties, it could facilitate introductions or relay messages (with explicit permission).

---

## Shared Abstractions

The contacts system uses several shared abstractions (see `docs/architecture/tech-stack.md`):

- **Context Builder** — Assembles contact permission blocks and privacy instructions for the mind's context (`docs/architecture/context-builder.md`)
- **Database Stores** — Typed data access for contacts and contact_channels tables in `system.db`, and conversations/messages in `messages.db`

## References

- `docs/architecture/heartbeat.md` — Heartbeat pipeline where contact context flows through
- `docs/architecture/context-builder.md` — How contact context is assembled into the mind's prompt
- `docs/architecture/agent-orchestration.md` — Sub-agent prompt template and delegation
- `docs/architecture/tech-stack.md` — Database architecture (five databases), shared abstractions
