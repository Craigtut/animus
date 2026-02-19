# Agent Provider Settings — Redesign Spec

## Context

The current Agent Provider section in settings is credentials-focused: two provider cards (Claude, Codex) with expand-to-configure credential management. There is no model selection. No cost visibility. The user picks a provider and gets whatever default model the system uses internally.

With the unified model registry now in place (pricing, context windows, capabilities for all models), we can give the user real control over their AI setup and real visibility into what it costs.

## Design Goals

1. **Provider + Model as one decision** — The user picks a provider AND a model. One model for everything (heartbeat, messages, sub-agents). No per-task granularity.
2. **Cost visibility** — Show pricing for each model so the user can make informed choices.
3. **Credentials as secondary** — Credential setup is a one-time concern. Once configured, it should fade into the background. The primary interaction is choosing the right model.
4. **Respect the design language** — Frank, practical, warm. No decorative elements. Clear hierarchy.

## Data Requirements

### New Setting: `defaultModel`

Add `defaultModel: string` to `systemSettingsSchema`. This stores the model ID (e.g., `"claude-opus-4-6"`, `"codex-mini-latest"`). When null/empty, the system uses a sensible default for the active provider.

### New tRPC Endpoint: `provider.listModels`

Returns the model list from the model registry, filtered by provider. Each entry includes:

```typescript
{
  id: string;           // "claude-opus-4-6"
  name: string;         // "Claude Opus 4.6"
  provider: string;     // "claude"
  contextWindow: number;
  maxOutputTokens: number;
  inputPricePer1M: number;   // for display: $5.00
  outputPricePer1M: number;  // for display: $25.00
  supportsVision: boolean;
  supportsThinking: boolean;
}
```

---

## Layout

The section is restructured into three zones stacked vertically:

1. **Provider selector** — Which SDK
2. **Model picker** — Which model (the primary interaction)
3. **Credentials** — Auth configuration (collapsible)

```
┌──────────────────────────────────────────────┐
│                                              │
│  Provider                                    │
│  ┌──────┐  ┌──────┐  ┌──────────┐           │
│  │Claude│  │Codex │  │ OpenCode │           │
│  └──────┘  └──────┘  └──────────┘           │
│                                              │
│  Model                                       │
│  ┌──────────────────────────────────────────┐│
│  │  ● Claude Opus 4.6            ← current  ││
│  │    200K ctx · 128K out · Vision·Thinking  ││
│  │    $5.00 / $25.00 per 1M tokens          ││
│  ├──────────────────────────────────────────┤│
│  │  ○ Claude Sonnet 4.5                     ││
│  │    200K ctx · 64K out · Vision · Thinking ││
│  │    $3.00 / $15.00 per 1M tokens          ││
│  ├──────────────────────────────────────────┤│
│  │  ○ Claude Haiku 4.5                      ││
│  │    200K ctx · 64K out · Vision · Thinking ││
│  │    $1.00 / $5.00 per 1M tokens           ││
│  ├──── ... more models ... ────────────────┤│
│  └──────────────────────────────────────────┘│
│                                              │
│  Credentials              [Connected ✓]      │
│  ▸ Manage credentials                        │
│                                              │
└──────────────────────────────────────────────┘
```

---

## Zone 1: Provider Selector

### Visual Treatment

Three buttons in a horizontal row, styled as a **segmented control** (not tabs, not cards). Each segment shows:

- Provider name
- A subtle status dot: green if credentials are configured, gray if not

The active provider segment is filled (high-contrast background, inverted text). Inactive segments are transparent with subtle hover states.

```
┌─────────────┬─────────────┬─────────────┐
│  ● Claude   │  ○ Codex    │  ○ OpenCode │
└─────────────┴─────────────┴─────────────┘
```

- Green dot = credentials configured
- Gray dot = not configured
- Filled segment = active provider

### Behavior

Clicking a provider segment:

- If credentials are configured: switch immediately (with confirmation modal, same as today — "Switch to Codex? The current mind session will end and restart.")
- If credentials are NOT configured: expand the Credentials zone below and scroll to it. Do not switch yet — the user needs to set up credentials first.

Selecting a provider also updates the Model picker to show that provider's models.

### Why Segmented Control

Cards-with-expand worked when credentials were the primary concern. Now that model selection is primary, the provider choice should be compact and get out of the way. A segmented control is the most space-efficient way to handle a 2-3 option choice.

---

## Zone 2: Model Picker

### Header

```
Model
Choose which model powers your Animus.
```

Label: 18px Semibold. Help text: 14px Regular, secondary color.

### Model List

A vertical list of selectable rows. Each row is a radio-style selection (not cards — we want density here since there can be 9+ models).

#### Model Row — Layout

```
┌──────────────────────────────────────────────────┐
│  ● Claude Opus 4.6                               │
│    200K context · 128K max output                 │
│    $5.00 input / $25.00 output  per 1M tokens    │
│    Vision · Thinking                              │
└──────────────────────────────────────────────────┘
```

**Line 1: Model name + selection indicator**
- Radio indicator (●/○) at the left edge
- Model name: 15px Medium, primary color
- Selected row: radio filled, subtle warm background tint

**Line 2: Context & output**
- "200K context · 128K max output"
- 13px Regular, secondary color
- Numbers use abbreviated format: 200K, 1M, 128K

**Line 3: Pricing**
- "$5.00 input / $25.00 output per 1M tokens"
- 13px Regular, secondary color
- Dollar amounts in primary color for emphasis

**Line 4: Capability badges**
- Small inline badges/tags for notable capabilities
- "Vision" and "Thinking" as subtle pill badges (12px, muted background)
- Only show when the model supports them

#### Visual Treatment

- Rows are separated by a 1px warm gray border (0.06 opacity)
- Selected row has a subtle warm tint background (accent color at 0.04 opacity) and the rim-light left border treatment (2px solid accent on the left edge)
- Hover: slight background tint (accent at 0.02 opacity)
- Transition: background 150ms ease-out

#### Model Row — Compact Variant

For providers with many models (Codex has 10), rows after the first 4-5 are collapsed behind a "Show N more models" toggle. This keeps the page scannable by default while allowing access to the full list.

```
  ● Claude Opus 4.6        [selected]
  ○ Claude Sonnet 4.5
  ○ Claude Haiku 4.5
  ○ Claude Opus 4.5
  ▸ Show 5 more models
```

The toggle is a text link, 13px Regular, secondary color, with a caret icon. Clicking expands the full list with a smooth height animation (200ms).

#### "Current" vs "Selected" State

The "current" model (what the system is actually using right now) gets a small "Current" badge to the right of the model name. When the user clicks a different model, that model gets the radio selection indicator but the "Current" badge stays on the old model until the user confirms.

Selecting a different model immediately shows a **sticky save bar** at the bottom of the model list:

```
┌──────────────────────────────────────────────┐
│  Claude Opus 4.6 → Claude Haiku 4.5         │
│  [Cancel]                     [Save change]  │
└──────────────────────────────────────────────┘
```

This bar:
- Shows the change clearly: old model → new model
- Has Cancel (ghost button) and Save change (primary button)
- Fades in with a 200ms ease-out when a new model is selected
- Fades out when cancelled or saved
- On save: calls `updateSystemSettings({ defaultModel: newModelId })`, shows brief "Saved" confirmation

### Notes on Model Display

The model `notes` field from models.json (e.g., "Latest and most capable model. Supports 1M context in beta.") could be shown as a tooltip on hover or as a third line in the expanded view. Keep it optional — the pricing and capabilities are the primary decision factors.

### OpenCode Special Case

OpenCode has no fixed model list in our registry (`"opencode": {}`). When the OpenCode provider is selected, the model picker changes to:

```
Model
OpenCode supports 75+ LLM providers. Enter your model identifier.

┌──────────────────────────────────────────┐
│  anthropic/claude-sonnet-4-5             │
└──────────────────────────────────────────┘
Format: provider/model-name (e.g., openai/gpt-4.1, google/gemini-2)
```

A text input with the current model value pre-filled. Save on blur or Enter. No pricing display (we don't have pricing data for arbitrary models).

---

## Zone 3: Credentials

### Collapsed State (Default When Configured)

When credentials are already configured, this zone shows a compact summary:

```
Credentials                              Connected ✓
▸ Manage credentials
```

- "Credentials" label: 16px Semibold
- "Connected ✓" badge: green, right-aligned
- "Manage credentials" is a clickable text link with caret, 13px Regular, secondary color

### Expanded State

Clicking "Manage credentials" expands to show the full credential management UI. This is essentially the current credential UI (API key input, CLI detection, Codex OAuth) moved here and wrapped in a collapsible container.

The expanded content includes:
- CLI detection banner (if available)
- Codex OAuth flow (if provider is Codex)
- API key / OAuth token input with validate & save
- Remove credential button
- Security footnote ("Encrypted at rest. Never leaves your instance.")

### Not Configured State

When credentials are NOT configured for the active provider, the credentials zone starts **expanded** with a warm orange indicator:

```
Credentials                         Not configured ⚠
Set up credentials to use Claude.

[API key input field]         [Validate & Save]

CLI detected                  [Use CLI]
```

The model picker above is still visible but the rows are slightly dimmed (0.5 opacity) with a note: "Configure credentials to select a model."

---

## Provider Switching Flow

When the user clicks a different provider segment:

**If credentials exist for the new provider:**
1. Confirmation modal appears: "Switch to Codex? Your Animus will use Codex for all future thinking. The current mind session will end and restart with the new provider."
2. On confirm: update `defaultAgentProvider` and `defaultModel` (reset to that provider's default model)
3. Model picker updates to show the new provider's models

**If credentials do NOT exist:**
1. Provider segment highlights as "pending" (dotted outline, not filled)
2. Credentials zone scrolls into view and expands
3. A helpful message: "Set up Codex credentials to switch."
4. Once credentials are saved, the switch confirmation modal appears automatically

---

## State Management

### New Fields in System Settings

```typescript
// Add to systemSettingsSchema:
defaultModel: z.string().optional(),  // e.g., "claude-opus-4-6"
```

When `defaultModel` is not set or doesn't match the active provider, the backend falls back to the first model in that provider's list (from models.json).

### Frontend State

```typescript
// Local component state (not persisted):
selectedProvider: 'claude' | 'codex' | 'opencode';  // what's shown in the model picker
pendingModel: string | null;  // model the user clicked but hasn't saved yet

// From server:
activeProvider: string;   // from systemSettings.defaultAgentProvider
activeModel: string;      // from systemSettings.defaultModel
models: ModelEntry[];     // from provider.listModels query
```

---

## Responsive Behavior

### Desktop (>1024px)
Full layout as described. Model rows are comfortable with all info visible.

### Tablet (768-1024px)
Same layout, slightly tighter spacing. Model rows stay the same.

### Mobile (<768px)
- Provider segmented control: full width, smaller text (13px)
- Model rows: stack pricing below capabilities instead of inline
- Credentials section: full-width inputs
- Save bar: full-width, sticks to bottom of viewport

---

## Backend Changes Required

1. **Add `defaultModel` to `systemSettingsSchema`** — new optional string field
2. **Add `provider.listModels` tRPC query** — returns models from registry for a given provider, formatted for display (prices in per-1M format)
3. **Backend reads `defaultModel`** — wherever the system chooses what model to use for the mind session and sub-agents, respect this setting
4. **Migration** — add `default_model` column to system_settings or handle via the existing JSON settings storage

---

## What's NOT in This Spec

- Per-task model selection (heartbeat vs messages vs sub-agents) — intentionally excluded for simplicity
- Cost estimation per tick or monthly projections — too speculative, maybe later
- Model performance benchmarks — not our data to show
- Auto-model selection based on task complexity — future concern

---

## References

- `docs/frontend/settings.md` — Current settings spec
- `docs/frontend/design-principles.md` — Visual language, components
- `docs/brand-vision.md` — Warmth, restraint, practical
- `packages/agents/src/models.json` — Model data
- `packages/agents/src/model-registry.ts` — Registry API
