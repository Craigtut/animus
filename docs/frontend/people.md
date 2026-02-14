# People

The being's social world. Contacts, conversations, and relationships. Where Presence is about being with the entity and Mind is about observing its inner life, People is about the network of humans it knows and communicates with. This space is relational, organized, and clear -- it serves a fundamentally different purpose than the other two spaces.

## Design Philosophy

People is the most "traditional" space in Animus. It has a contact list, detail views, and familiar patterns for managing relationships. But it still inhabits the warm Animus design language -- rim-lit cards, generous spacing, organic animation. The key distinction: People is organized around humans, not around the being. The information hierarchy is structured around "who is this person and what is my relationship with them," not "what is the being feeling."

**Guiding Principles:**
- **People-centric, not entity-centric** -- The contact's name, tier, and channels are primary. The being's relationship to them is secondary.
- **Conversation history is king** -- The most important thing about any contact is what has been said between them and the being.
- **Clean and scannable** -- Contact lists should be immediately readable. No visual complexity.
- **Editable** -- Notes, channels, and tier settings are editable inline. No navigating to settings for contact management.

---

## Screen: Contact List

**Route:** `/people`

### Layout

A single-column list of contacts, centered within the content column (max-width 720px). No sidebar, no multi-panel layout. The list is the content.

### Contact Entry Design

Each contact is a horizontal card (rim-lit, consistent with design system). The card contains:

**Left section:**
- **Avatar placeholder:** A warm-toned circle (40px diameter) with the contact's initials in Semibold, center-aligned. Background color is derived from the contact's name (a deterministic hash producing a warm hue). No photos -- Animus doesn't store profile images.
- **Name:** Full name in 16px Semibold, primary text color.
- **Tier badge:** A small label next to the name. "Primary" in warm accent color, "Standard" in secondary text color. Styled as a minimal badge (no background, just colored text in 11px weight).

**Right section:**
- **Channels:** Small Phosphor icons (14px) for each channel the contact is reachable on. Icons: `Globe` (web), `ChatText` (SMS), `DiscordLogo` (Discord), `Code` (API). Each icon is in secondary text color. Channels with verified identity have full opacity (0.55); unverified have reduced opacity (0.30).
- **Last message:** A single line of the most recent message (truncated, 13px Regular, 0.45 opacity) with relative timestamp: "2 hours ago". If the last message was from the being, prefix with "You: ".

### Sorting

Contacts are sorted by last message date (most recent first). The primary contact is always pinned to the top regardless of recency.

### Search

A search input at the top of the list. Placeholder: "Search contacts..." Filters contacts by name in real-time (client-side, since the contact count is small). The input uses the standard input styling (slight background offset, rim-lit focus state).

### Unknown Caller Log

Below the contact list, a collapsible section:

**Header:** "Unknown messages" with a Phosphor `Warning` icon (16px, warm orange). A count badge shows the number of unreviewed unknown messages.

**Content (when expanded):** A list of unknown caller entries:
- Channel icon + identifier (phone number, Discord ID, etc.)
- Message preview (truncated, 13px)
- Timestamp
- Actions: "Add as contact" (text link) and "Dismiss" (text link)

"Add as contact" opens a minimal inline form: name field and channel pre-filled. Submitting creates a new contact with `standard` tier and the channel entry. "Dismiss" removes the entry from the log (the message remains in the database for audit).

If there are no unknown messages, this section is hidden entirely.

### Empty State

If only the primary contact exists (fresh installation): the primary contact card is shown. Below it, a warm centered text: "Other contacts will appear here as people message your Animus through SMS, Discord, or API. You can also add contacts manually." with a "+ Add contact" button (secondary button style).

### Add Contact

A "+ Add contact" button at the bottom of the contact list (or in the empty state). Clicking opens a modal dialog (centered, rim-lit, generous radius):

**Fields:**
- Full name (required)
- Phone number (optional, E.164 format)
- Email (optional)
- Discord ID (optional)

**Actions:** "Add" (primary button) and "Cancel" (secondary). Adding creates a `standard` tier contact with any provided channel entries.

---

## Screen: Contact Detail

**Route:** `/people/:contactId`

### Transition

Clicking a contact card in the list triggers the click-deeper transition (see `docs/frontend/app-shell.md`). The contact card becomes the anchor element, expanding into the full detail view. The back indicator appears in the navigation pill.

### Layout

A single-column layout with the contact's information and conversation history.

### Contact Header

A prominent header section at the top:

- **Name:** 24px Semibold, primary text color
- **Tier:** "Primary contact" or "Standard contact" below the name, 14px Regular, secondary text color
- **Channels:** Row of channel badges, each showing: channel icon + identifier (e.g., phone number, Discord username). Each badge is a small pill.
- **Edit button:** A Phosphor `PencilSimple` icon (16px) that toggles the header into edit mode (see [Editing](#editing) below).

### Tabs

Below the header, two tabs:

- **Conversation** (default active)
- **About**

Tabs use the same visual treatment as the Mind sub-navigation: text labels, subtle underline on active.

### Tab: Conversation

The full message history between this contact and the being, across all channels.

**Message rendering:** Same treatment as Presence conversation (user messages right-aligned with warm tint, being messages left-aligned without container), but with additional metadata:

- **Channel indicator:** Each message shows a small channel icon (12px, 0.30 opacity) next to the timestamp, indicating which channel the message was sent/received on. This is important for contacts reachable on multiple channels.
- **Direction indicator:** Inbound messages (from the contact) and outbound messages (from the being) are visually distinguished as in Presence.

**No message input.** The contact detail view is read-only for conversation. To message the being, the user goes to Presence. To message the being as this contact (for testing), the user uses the actual channel.

Exception: For the **primary contact**, a message input IS shown at the bottom, identical to the Presence input. This allows the user to converse with the being from anywhere in the app. Messages sent from here appear in the Presence conversation as well (they are the same conversation).

**Pagination:** Messages load 50 at a time, infinite scroll upward (same as Presence).

**Empty state:** "No messages yet." in centered secondary text.

### Tab: About

Information about this contact that the being carries. Two sections:

**Contact Notes (user-defined):**
- Header: "Your notes" with a Phosphor `NotePencil` icon (16px)
- The `notes` field from the contact record, displayed in an editable text area
- For the primary contact, this is labeled "About you" and corresponds to the "Notes About You" set during onboarding
- An inline save mechanism: the text area saves automatically after 1.5 seconds of inactivity (debounced). A small "Saved" confirmation appears briefly (fades in, holds 1 second, fades out) near the text area.
- Token guidance: same as onboarding -- a subtle note appears when approaching ~500 tokens

**Working Memory (AI-maintained):**
- Header: "What [Name] knows" with a Phosphor `Brain` icon (16px)
- Read-only display of the being's working memory for this contact
- If empty: "Your Animus hasn't formed notes about this contact yet."
- This text is not editable by the user -- it is the being's own observations
- Last updated timestamp in small secondary text

**Channel Management:**
Below the notes sections, a "Channels" section:
- List of current channel entries for this contact (channel type, identifier, verified status)
- "Add channel" link to add a new channel entry (inline form: channel type dropdown + identifier input)
- "Remove" link on each channel entry (with confirmation: "Remove this channel?")
- The primary contact's web channel cannot be removed

### Editing

When the user clicks the edit icon in the contact header, the header fields become editable:

- Name becomes a text input (pre-filled)
- Tier shows a toggle: "Primary" / "Standard" (with a warning when changing: "Changing the primary contact transfers all elevated permissions. Are you sure?")
- Phone, email fields become editable

An "Save" button and "Cancel" text link appear. Saving writes changes to the backend. The edit mode uses the same warm input styling as the rest of the application.

### Delete Contact

A "Delete contact" text link at the very bottom of the About tab, in red text (semantic error color). Clicking shows a confirmation dialog: "Delete [Name]? This will remove the contact and all their channel associations. Message history will be preserved." with "Delete" (red primary button) and "Cancel".

The primary contact cannot be deleted. The delete link does not appear for the primary contact.

---

## Responsive Behavior

### Desktop (>1024px)

Contact list at 720px max-width. Contact detail at 720px. Generous spacing. Avatar circles at 40px.

### Tablet (768-1024px)

Slightly reduced padding. Contact cards maintain their full layout. Detail view may reduce header spacing.

### Mobile (<768px)

Contact list goes full-width with 16px padding. Contact cards reduce: the channel icons move below the name/tier, and the last message truncates more aggressively.

Contact detail is full-width. The conversation tab takes the full viewport height (minus the header and navigation). The "About" tab has comfortable mobile padding for the text areas.

The "Add contact" flow uses a full-screen modal on mobile instead of a centered dialog.

---

## State Management

### Zustand Store: People State

```typescript
interface PeopleState {
  contacts: Contact[];
  selectedContactId: string | null;
  unknownMessages: UnknownMessage[];
  searchQuery: string;

  // Contact detail
  contactDetail: {
    contact: Contact | null;
    channels: ContactChannel[];
    workingMemory: string | null;
    messages: Message[];
    isLoadingMessages: boolean;
    hasMoreMessages: boolean;
  } | null;
}

interface Contact {
  id: string;
  fullName: string;
  phoneNumber: string | null;
  email: string | null;
  isPrimary: boolean;
  permissionTier: 'primary' | 'standard';
  notes: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

interface UnknownMessage {
  id: string;
  channel: string;
  identifier: string;
  content: string;
  receivedAt: string;
  isDismissed: boolean;
}
```

---

## Data Sources

- `contacts` table via tRPC query (from `system.db`)
- `contact_channels` table via tRPC query
- `messages` table via tRPC query (from `messages.db`, filtered by contact)
- `working_memory` table via tRPC query (from `memory.db`)
- Unknown caller log: a dedicated tRPC query for unresolved inbound messages

**Note:** `lastMessageAt` and `lastMessagePreview` in the Contact list view are computed fields, derived from a join with the most recent message in `messages.db` at query time. They are not stored in the `contacts` table.

---

## References

- `docs/frontend/app-shell.md` -- Navigation, click-deeper transitions
- `docs/frontend/presence.md` -- Primary contact conversation (shared between Presence and People)
- `docs/architecture/contacts.md` -- Contact data model, permission tiers, identity resolution, unknown callers
- `docs/architecture/channel-packages.md` -- Channel types, identifiers, channel adapters
- `docs/architecture/memory.md` -- Working memory (per-contact notepad, AI-maintained)
- `docs/frontend/design-principles.md` -- Cards, inputs, typography, animation
- `docs/brand-vision.md` -- Warm, approachable, clean
