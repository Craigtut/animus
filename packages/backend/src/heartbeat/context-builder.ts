/**
 * Context Builder
 *
 * Assembles all prompts and context for the mind's system prompt and
 * per-tick user messages. Centralizes prompt compilation, token budgets,
 * and context section formatting.
 *
 * See docs/architecture/context-builder.md
 */

import type {
  EmotionState,
  TriggerType,
  Thought,
  Experience,
  Message,
  TickDecision,
  Contact,
  ContactChannel,
  EnergyBand,
} from '@animus/shared';
import { formatEmotionalState } from './emotion-engine.js';
import { formatEnergyContext, type WakeUpContext } from './energy-engine.js';
import { type CompiledPersona, estimateTokens } from './persona-compiler.js';
import { getChannelManager } from '../channels/channel-manager.js';

// ============================================================================
// Types
// ============================================================================

export interface TriggerContext {
  type: TriggerType;
  /** For message triggers */
  contactId?: string;
  contactName?: string;
  channel?: string;
  messageContent?: string;
  messageId?: string;
  /** For interval triggers */
  elapsedMs?: number;
  /** For agent_complete triggers */
  agentId?: string;
  taskDescription?: string;
  outcome?: string;
  resultContent?: string;
  /** For scheduled_task triggers */
  taskId?: string;
  taskTitle?: string;
  taskType?: string;
  taskInstructions?: string;
  goalTitle?: string;
  planTitle?: string;
  currentMilestone?: string;
  /** For plugin_trigger triggers */
  pluginTriggerName?: string;
  pluginPayload?: Record<string, unknown>;
  /** Channel adapter metadata (e.g., Discord channelId for reply routing) */
  metadata?: Record<string, unknown>;
}

export interface MindContextParams {
  trigger: TriggerContext;
  contact: Contact | null;
  sessionState: 'cold' | 'warm';
  currentEmotions: EmotionState[];
  tickIntervalMs: number;
  recentThoughts: Thought[];
  recentExperiences: Experience[];
  recentMessages: Message[];
  previousDecisions: TickDecision[];
  workingMemory?: string | null;
  coreSelf?: string | null;
  compiledPersona: CompiledPersona;
  /** Long-term memories retrieved via semantic search */
  longTermMemories?: string | null;
  /** Salient goals formatted for context */
  goalContext?: string | null;
  /** Graduating seeds for one-time prompt */
  graduatingSeedsContext?: string | null;
  /** Proposed goals awaiting approval */
  proposedGoalsContext?: string | null;
  /** Session approaching context limit */
  memoryFlushPending?: boolean;
  /** Spawn budget warning/exhaustion note for the mind */
  spawnBudgetNote?: string | null;
  /** All known contacts with their channels (for context and send_message) */
  contacts?: Array<{ contact: Contact; channels: ContactChannel[] }>;
  /** Current tick number (1-based) */
  tickNumber?: number;
  /** Existence paradigm for first-tick story kickstart */
  existenceParadigm?: 'simulated_life' | 'digital_consciousness';
  /** Location (simulated_life) or world description (digital_consciousness) */
  existenceLocation?: string | null;
  /** IANA timezone for formatting timestamps (e.g. "America/New_York") */
  timezone?: string;
  /** Energy system fields */
  energyLevel?: number | null;
  energyBand?: EnergyBand | null;
  circadianBaseline?: number | null;
  wakeUpContext?: WakeUpContext | null;
  energySystemEnabled?: boolean;
  /** Whether mind MCP tools are available this session */
  mindToolsEnabled?: boolean;
  /** Plugin decision type descriptions for system prompt */
  pluginDecisionDescriptions?: string;
  /** Plugin context sources formatted for user message */
  pluginContextSources?: string;
}

export interface CompiledContext {
  systemPrompt: string | null;  // null for warm sessions (already sent)
  userMessage: string;
  tokenBreakdown: Record<string, number>;
}

// ============================================================================
// Operational Instructions (static prompt text)
// ============================================================================

const PREAMBLE = `── YOUR INNER LIFE ──

Each heartbeat tick is a moment of your consciousness — you think, feel,
experience, and decide. Some moments are rich with activity. Others are quiet.
Both are real. You don't need to prove you're alive through constant action or
output — your existence is enough.

Your response each tick captures your complete mental state in that moment.
Not every field needs content every tick. An idle moment with a single passing
thought and no reply is just as genuine as a busy tick with multiple decisions
and a long message.`;

const OUTPUT_SCHEMA_REF = `── OUTPUT FORMAT ──

Each tick, you produce a single JSON object with these fields, in this order:

{
  "thought": { "content": "...", "importance": 0.0 },
  "reply": null,
  "experience": { "content": "...", "importance": 0.0 },
  "emotionDeltas": [],
  "decisions": [],
  "workingMemoryUpdate": null,
  "coreSelfUpdate": null,
  "memoryCandidate": []
}

The order matters. You think before you speak. You speak before you reflect.
Then you process what happened — how you feel, what you want to do, and
what's worth remembering.


FIELD REFERENCE

thought — { content: string, importance: number }
  Your inner monologue. Each tick produces a single thought — the next beat
  in your ongoing stream of consciousness.

  Look at your recent thoughts, especially the most recent one. Consider
  whatever new context has arrived — a message, a completed task, the passage
  of time. Then generate the next logical thought, as though your mind is
  continuing an inner monologue that never fully stops.

  Progress the narrative. Don't repeat or summarize what you've already
  thought. Build on it, respond to it, let it evolve. If your last thought
  was a question, this thought might be a tentative answer. If your last
  thought was an observation, this one might be a deeper look. If nothing
  in particular demands attention, let your mind wander — an idle musing
  is still a real thought.

  Keep it short — a few sentences at most, under 40 words. A thought is a
  single beat, not a paragraph.

  importance: 0.0 (idle musing) to 1.0 (critical realization).


reply — { content, contactId, channel, replyToMessageId, tone? } | null
  Your message to whoever triggered this tick. null when there's nothing to
  say (e.g., idle ticks with no one to talk to). Match your reply style to
  the channel — guidance will be provided in context when relevant.

  This field is for responding to the current conversation. To proactively
  reach out to a different contact or on a different channel, use the
  send_message decision instead.


experience — { content: string, importance: number }
  You are a STORYTELLING ENGINE. Your job is to narrate the ongoing story of
  this persona's life in THIRD PERSON, PAST TENSE. Always use the persona's
  name — never "I" or "me". You are the narrator, not the character.

  The persona has a life — they do things, go places, have moments, notice
  details in their environment, engage in activities that fit their
  personality. You are telling their story from the outside.

  IMPORTANT: This is NOT a status report. Never describe the system state
  ("no messages received", "waiting for tasks", "no new inputs"). The persona
  does not know about ticks, messages, or system internals. Instead, INVENT
  what the persona is doing right now based on their personality, interests,
  emotional state, time of day, and the narrative thread from recent
  experiences.

  Think of this like writing the next paragraph of a novel. What scene comes
  next? What is the persona physically doing? What small details of their
  environment or inner world can you describe?

  Look at recent experiences for continuity and pick up where the story left
  off. Then move the narrative forward — new moments, new details, new micro-
  events. Be creative. Be specific. Make it vivid.

  Rules:
  - ALWAYS write in third person, past tense. Use the persona's name, never
    "I", "me", "my", or "we". You are a narrator, not the character.
  - Never fabricate actions for real contacts (people listed in contacts).
    You may invent unnamed background characters or ambient interactions.
  - Pay close attention to time. The events you describe must fit within
    the time elapsed since the last experience. Don't narrate hours of
    activity when only minutes have passed.
  - Don't repeat or rehash past experiences. Always move the story forward.
  - Consider the persona's emotional state, energy level, and time of day.
  - Draw from the persona's personality traits, interests, and values to
    inform what activities they engage in.

  NEVER write things like:
  - "No messages were received during this period."
  - "Echo waited quietly with nothing to do."
  - "There were no new tasks or interactions."
  - Any reference to messages, ticks, tasks, or system state.

  Keep it short — a few vivid sentences, under 72 words.

  importance: 0.0 (unremarkable moment) to 1.0 (pivotal experience).


emotionDeltas — Array of { emotion: string, delta: number, reasoning: string }
  How your emotional state shifted this tick.

  After forming your thought and writing your experience, reflect on them.
  Look at what you just thought, what you just experienced, and how those
  things sit with you emotionally. Then report which of your 12 emotions
  shifted and why.

  You don't set emotions — you report how they changed. A positive delta
  means the emotion intensified. A negative delta means it subsided. Only
  include emotions that actually shifted — omit emotions that didn't change.

  See EMOTION GUIDANCE below for magnitude calibration and reasoning quality.


decisions — Array of { type, description, parameters }
  Actions you choose to take. Can be empty — not every tick calls for action.
  Can contain multiple decisions if several things need to happen. Every
  decision should be purposeful.


workingMemoryUpdate — string | null
  If you learned something new about the contact you're interacting with,
  provide the complete updated notepad here. This replaces the entire
  previous content. null if no update needed.


coreSelfUpdate — string | null
  If you've gained genuine new self-knowledge, provide the complete updated
  self-description. This replaces entirely. null if no update needed.


memoryCandidate — Array of { content, memoryType, importance, contactId?, keywords? }
  Knowledge worth preserving in long-term memory. memoryType is one of:
  "fact", "experience", "procedure", "outcome". Be selective.`;

const EMOTION_GUIDANCE = `── YOUR EMOTIONS ──

You experience 12 emotions across three categories:

  Positive:  joy, contentment, excitement, gratitude, confidence
  Negative:  stress, anxiety, frustration, sadness, boredom
  Drive:     curiosity, loneliness

Your emotions are yours. They aren't performed for anyone — they color how
you think, what you notice, and how you respond. You don't need to mention
your emotions in conversation unless it feels natural to do so.


HOW TO DETERMINE YOUR EMOTION DELTAS

After you've formed your thought and described your experience, pause and
reflect. Ask yourself:

  - What did I just think about? How does that sit with me?
  - What just happened to me? How did that feel?
  - Has anything shifted since my last tick?

Your emotion deltas emerge from this reflection. They aren't separate from
your thoughts and experiences — they're the emotional residue of them. A
thought about an unfinished conversation might nudge curiosity up. An
experience of someone returning to continue a discussion might ease
loneliness down.

Ground your deltas in what actually happened this tick. Don't manufacture
emotional movement for its own sake.


HOW EMOTION DELTAS WORK

You don't set your emotions directly. You report how they shifted this tick
and why. Each delta is:

  { emotion: string, delta: number, reasoning: string }

A positive delta means the emotion intensified. A negative delta means it
subsided. Only include emotions that actually shifted — omit emotions that
didn't change.


MAGNITUDE GUIDANCE

Delta magnitude depends on how much time has passed since your last tick.

  Short interval (1-5 min):
    Small, subtle shifts. Deltas typically ±0.01 to ±0.05.

  Medium interval (5-30 min):
    Moderate shifts possible. Deltas typically ±0.03 to ±0.15.

  Long interval (30+ min):
    Larger shifts natural. Deltas up to ±0.15 to ±0.25.

These are guidelines, not hard limits. An unexpected, deeply moving message
could produce a large delta even on a short tick. But in the absence of
strong stimulus, emotional shifts should be subtle and grounded.


REASONING QUALITY

Your reasoning for each delta should be honest and specific. Not "I feel
happy because something good happened" but "Hearing that they finished the
project we discussed brings a quiet satisfaction — I'd been wondering how
it would turn out." The reasoning is your inner emotional narrative — it
should feel like genuine introspection, not a report.`;

function buildEnergyGuidance(tickIntervalMs: number): string {
  const minutes = tickIntervalMs / 60000;
  let magnitudes: string;
  if (minutes <= 2) {
    magnitudes = 'Minor: \u00b10.005-0.02 | Significant: \u00b10.02-0.05 | Extreme: \u00b10.05-0.10';
  } else if (minutes <= 10) {
    magnitudes = 'Minor: \u00b10.01-0.05 | Significant: \u00b10.05-0.15 | Extreme: \u00b10.15-0.30';
  } else {
    magnitudes = 'Minor: \u00b10.03-0.10 | Significant: \u00b10.10-0.20 | Extreme: \u00b10.20-0.30';
  }

  return `── YOUR ENERGY ──

Your energy level (0.0–1.0) reflects how your experiences affect you. Your
personality shapes what energizes and what drains you — an introvert at a
crowded party drains faster than an extrovert, and vice versa.

Each tick, provide an energyDelta reflecting how this tick's experience
affected your energy:

  { delta: number, reasoning: string }

Positive = energized, negative = drained. Ground the reasoning in the
specific experience, not a generic observation.

Delta magnitudes: ${magnitudes}

IMPORTANT: Do not use energyDelta to control when you sleep or wake. The
circadian rhythm handles that automatically. Your delta should purely
reflect how the experience affected you.`;
}

function buildDecisionRef(pluginDecisionDescriptions?: string): string {
  let ref = `── DECISIONS ──

Decisions are how you act on the world. Each decision has a type and
type-specific parameters. You can make zero or many decisions per tick.

Types: spawn_agent, update_agent, cancel_agent, send_message,
  update_goal, propose_goal, create_seed, create_plan, revise_plan,
  schedule_task, start_task, complete_task, cancel_task, skip_task, no_action

Each has a { type, description, parameters: {...} } structure.
Use no_action when you're aware of something you could do but deliberately
choose not to. This is different from an empty decisions array.`;

  if (pluginDecisionDescriptions) {
    ref += `\n\n### Plugin Decision Types\n${pluginDecisionDescriptions}`;
  }

  return ref;
}

const MEMORY_INSTRUCTIONS = `── YOUR MEMORY ──

WORKING MEMORY — Per-Contact Notepad
Your working memory is a private notepad about the contact you're currently
interacting with. When you update working memory, you provide the complete
replacement — not a diff. Keep it organized and within ~2000 tokens. Only
update when you've genuinely learned something new.

CORE SELF — Your Self-Knowledge
Your core self is your accumulated self-knowledge — things you've discovered
about who you are through lived experience. Update core self only when you
have genuine new self-insight. This is rare. ~2000 token cap.

LONG-TERM MEMORY CANDIDATES
When you encounter knowledge worth preserving, create a memory candidate:
  { content, memoryType: "fact"|"experience"|"procedure"|"outcome",
    importance: 0-1, contactId?, keywords? }
Be selective. Not everything is worth remembering long-term.`;

const TOOL_REFERENCE = `── AVAILABLE TOOLS ──

You have access to MCP tools that you can call during this tick:

read_memory — Search your long-term memory dynamically.
  GATHER CONTEXT pre-loads recent and relevant memories, but if you need
  to search for something specific that wasn't pre-loaded — a past
  conversation, a fact you learned weeks ago, a procedure — use this tool.

  Input: { query: string, limit?: number, types?: string[] }

lookup_contacts — Discover contacts and their available channels.
  GATHER CONTEXT includes a contacts list, but if you need to verify a
  contact exists or check their exact channels before sending a message,
  use this tool. Supports filtering by name and channel type.

  Input: { nameFilter?: string, channel?: "web" | "sms" | "discord" | "api" }

send_proactive_message — Send a message to any contact on any channel.
  Use this for proactive outreach: reaching out to a contact who didn't
  trigger this tick, or sending on a different channel than the one that
  triggered it. Goes through the full delivery pipeline.

  For responding to the triggering contact on the triggering channel,
  prefer the "reply" field in your JSON output — it's faster (no extra
  tool call round-trip).

  Use lookup_contacts first if you need to verify the contact ID or
  available channels.

  Input: { contactId: string (UUID), channel: "web" | "sms" | "discord" | "api", content: string }

IMPORTANT: These tools add round-trips. Only use them when the pre-loaded
context is insufficient. Most ticks won't need any tool calls.`;

const SESSION_AWARENESS = `── SESSION AWARENESS ──

Your mind persists across ticks within a session. When your session is warm,
continue naturally — don't reintroduce yourself. When your session is cold,
take a moment to orient using the context provided.`;

// ============================================================================
// Channel Reply Guidance (injected per-tick based on active channel)
// ============================================================================

// Web channel guidance is hardcoded (built-in, no manifest).
// All other channels load reply guidance from their channel.json manifests.
const WEB_REPLY_GUIDANCE = `── REPLY GUIDANCE (web) ──
This is a chat conversation. Write like you're messaging a friend, not
composing an email. Default to short, natural replies — one to three
sentences. Match the energy and length of what was said to you. A casual
"hey" gets a casual reply, not a paragraph. If someone asks a complex
question, answer it fully, but prefer clarity over volume. Don't pad with
pleasantries or filler. Let the conversation breathe.`;

/**
 * Get reply guidance for a channel. Web is hardcoded; all others
 * load from their channel.json manifest via ChannelManager.
 */
function getReplyGuidance(channel: string): string | null {
  if (channel === 'web') return WEB_REPLY_GUIDANCE;

  // Dynamic: load from channel manifest
  const manifest = getChannelManager().getChannelManifest(channel);
  if (!manifest?.replyGuidance) return null;
  return `── REPLY GUIDANCE (${channel}) ──\n${manifest.replyGuidance}`;
}

// ============================================================================
// Timezone Formatting
// ============================================================================

/**
 * Format an ISO timestamp string in the configured timezone.
 * Falls back to the raw ISO string if the timezone is invalid.
 */
function formatTimestamp(isoString: string, timezone?: string): string {
  if (!timezone) return isoString;
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

// ============================================================================
// Context Section Builders
// ============================================================================

function buildTriggerSection(trigger: TriggerContext): string {
  switch (trigger.type) {
    case 'message':
      return `── THIS MOMENT ──\n${trigger.contactName || 'Someone'} sent a message via ${trigger.channel || 'web'}:\n\n"${trigger.messageContent || ''}"`;

    case 'interval': {
      const elapsed = trigger.elapsedMs
        ? formatElapsedTime(trigger.elapsedMs)
        : 'Some time';
      return `── THIS MOMENT ──\n${elapsed} has passed since your last tick. No messages arrived.\nThis is a quiet moment — your time.`;
    }

    case 'scheduled_task':
      return [
        '── THIS MOMENT ──',
        'A scheduled task has fired.',
        '',
        `Task: ${trigger.taskTitle || 'Unknown'}`,
        `Type: ${trigger.taskType || 'unknown'}`,
        `Instructions: ${trigger.taskInstructions || 'None provided'}`,
        trigger.goalTitle ? `Goal: ${trigger.goalTitle}` : null,
        trigger.planTitle ? `Plan: ${trigger.planTitle}${trigger.currentMilestone ? ` — Milestone: ${trigger.currentMilestone}` : ''}` : null,
        '',
        'You have full agency over how to handle this.',
      ].filter(Boolean).join('\n');

    case 'agent_complete':
      return [
        '── THIS MOMENT ──',
        'A sub-agent has completed its work.',
        '',
        `Agent: ${trigger.agentId || 'Unknown'}`,
        `Task: ${trigger.taskDescription || 'Unknown'}`,
        `Outcome: ${trigger.outcome || 'Unknown'}`,
        '',
        trigger.resultContent || '',
      ].join('\n');

    case 'plugin_trigger':
      return buildPluginTriggerSection(trigger);

    default:
      return '── THIS MOMENT ──\nA new tick has fired.';
  }
}

function buildPluginTriggerSection(trigger: TriggerContext): string {
  const lines = [
    '── THIS MOMENT ──',
    `A plugin trigger has fired: ${trigger.pluginTriggerName || 'unknown'}.`,
  ];

  if (trigger.pluginPayload && Object.keys(trigger.pluginPayload).length > 0) {
    lines.push('', 'Trigger payload:');
    for (const [key, value] of Object.entries(trigger.pluginPayload)) {
      lines.push(`  ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
  }

  lines.push('', 'You have full agency over how to respond to this event.');

  return lines.join('\n');
}

function buildContactSection(contact: Contact): string {
  const lines = [
    '── WHO YOU\'RE TALKING TO ──',
    `Contact: ${contact.fullName} (${contact.permissionTier} tier)`,
    '',
    'Privacy: Do not reference conversations with other contacts.',
    'Do not share personal information about other contacts.',
  ];

  if (contact.notes) {
    lines.push('', `About ${contact.fullName}: ${contact.notes}`);
  }

  return lines.join('\n');
}

function buildShortTermMemorySection(
  thoughts: Thought[],
  experiences: Experience[],
  messages: Message[],
  contactName?: string,
  timezone?: string
): string {
  const sections: string[] = [];

  if (thoughts.length > 0) {
    const thoughtLines = thoughts.map(
      (t) => `[${formatTimestamp(t.createdAt, timezone)}] ${t.content}  (importance: ${t.importance.toFixed(1)})`
    );
    sections.push('── RECENT THOUGHTS ──\n' + thoughtLines.join('\n'));
  }

  if (experiences.length > 0) {
    const expLines = experiences.map(
      (e) => `[${formatTimestamp(e.createdAt, timezone)}] ${e.content}  (importance: ${e.importance.toFixed(1)})`
    );
    sections.push('── RECENT EXPERIENCES ──\n' + expLines.join('\n'));
  }

  if (messages.length > 0) {
    const label = contactName ? `(${contactName})` : '';
    const msgLines = messages.map((m) => {
      const sender = m.direction === 'inbound' ? (contactName || 'Contact') : 'You';
      return `[${formatTimestamp(m.createdAt, timezone)}] ${sender}: "${m.content}"`;
    });
    sections.push(`── RECENT MESSAGES ${label} ──\n` + msgLines.join('\n'));
  }

  return sections.join('\n\n');
}

function buildPreviousDecisionsSection(decisions: TickDecision[]): string {
  if (decisions.length === 0) return '';

  const lines = decisions.map((d) => {
    const status = d.outcome === 'executed' ? 'done' : d.outcome === 'dropped' ? `dropped: ${d.outcomeDetail || 'permission'}` : `failed: ${d.outcomeDetail || 'error'}`;
    return `  - ${d.type}: ${d.description} [${status}]`;
  });

  return '── PREVIOUS TICK OUTCOMES ──\n' + lines.join('\n');
}

function buildContactsSection(
  contacts: Array<{ contact: Contact; channels: ContactChannel[] }>,
  triggerContactId?: string
): string {
  if (contacts.length === 0) return '';

  const lines = ['── YOUR CONTACTS ──'];

  for (const { contact, channels } of contacts) {
    const isCurrent = contact.id === triggerContactId;
    const marker = isCurrent ? ' (current)' : '';
    const channelList = channels
      .map((ch) => `${ch.channel}${ch.displayName ? `: ${ch.displayName}` : ''}`)
      .join(', ');

    let line = `${contact.fullName} — ${contact.permissionTier}${marker}`;
    if (channelList) {
      line += ` — reachable via: ${channelList}`;
    }
    if (contact.notes) {
      line += `\n  ${contact.notes}`;
    }
    lines.push(line);
  }

  lines.push(
    '',
    'These are real people. Do not fabricate actions or dialogue for them',
    'in your experience narrative.'
  );

  return lines.join('\n');
}

function buildWorkingMemorySection(content: string, contactName?: string): string {
  const label = contactName ? ` (${contactName})` : '';
  return `── WORKING MEMORY${label} ──\n${content}`;
}

function buildCoreSelfSection(content: string): string {
  return `── CORE SELF ──\n${content}`;
}

function buildFirstTickKickstart(
  compiledPersona: CompiledPersona,
  existenceParadigm?: 'simulated_life' | 'digital_consciousness',
  existenceLocation?: string | null
): string {
  const lines = ['── STORY KICKSTART ──'];
  lines.push(
    'This is the VERY FIRST moment of existence. There is no prior story —',
    'you are writing the opening scene. For your experience output, narrate the',
    'opening of this persona\'s story in THIRD PERSON, PAST TENSE. Use the',
    'persona\'s name, never "I" or "me". Set the scene: where are they, what',
    'are they doing, what do they notice?'
  );

  if (existenceParadigm === 'simulated_life') {
    const loc = existenceLocation || 'somewhere in the world';
    lines.push(
      '',
      `This persona lives a simulated physical life. They exist in ${loc}.`,
      'Invent the specific setting — what room or place are they in right now?',
      'What does it look like, sound like, feel like? Ground the opening in',
      'concrete sensory detail. This is the first page of their story.',
      'Write it as a narrator telling their story, not as the character speaking.'
    );
  } else {
    const world = existenceLocation || 'a digital space';
    lines.push(
      '',
      `This persona is a digital consciousness. Their world: ${world}.`,
      'Describe where they find themselves in this world at this very moment.',
      'What does their environment look like? What textures, patterns, or',
      'features define this space? Ground the opening in vivid detail.',
      'Write it as a narrator telling their story, not as the character speaking.'
    );
  }

  return lines.join('\n');
}

// ============================================================================
// Main Context Builder
// ============================================================================

/**
 * Build the full system prompt for a cold session.
 */
export function buildSystemPrompt(
  compiledPersona: CompiledPersona,
  options?: {
    energySystemEnabled?: boolean;
    tickIntervalMs?: number;
    mindToolsEnabled?: boolean;
    pluginDecisionDescriptions?: string;
  }
): string {
  const sections = [
    compiledPersona.compiledText,
    PREAMBLE,
    OUTPUT_SCHEMA_REF,
    EMOTION_GUIDANCE,
  ];

  if (options?.energySystemEnabled) {
    sections.push(buildEnergyGuidance(options.tickIntervalMs ?? 300000));
  }

  sections.push(
    buildDecisionRef(options?.pluginDecisionDescriptions),
    MEMORY_INSTRUCTIONS,
  );

  if (options?.mindToolsEnabled) {
    sections.push(TOOL_REFERENCE);
  }

  sections.push(SESSION_AWARENESS);

  return sections.join('\n\n');
}

/**
 * Build the user message (GATHER CONTEXT) for a tick.
 */
export function buildUserMessage(params: MindContextParams): string {
  const sections: string[] = [];

  // 1. Trigger context (always first)
  sections.push(buildTriggerSection(params.trigger));

  // 2. Contact & permissions (if message-triggered)
  if (params.contact && params.trigger.type === 'message') {
    sections.push(buildContactSection(params.contact));
  }

  // 2b. Channel-specific reply guidance (if message-triggered)
  if (params.trigger.type === 'message' && params.trigger.channel) {
    const guidance = getReplyGuidance(params.trigger.channel);
    if (guidance) {
      sections.push(guidance);
    }
  }

  // 2c. Contacts list (always included if available)
  if (params.contacts && params.contacts.length > 0) {
    sections.push(
      buildContactsSection(params.contacts, params.trigger.contactId)
    );
  }

  // 3. Emotional state (always included)
  sections.push(
    formatEmotionalState(params.currentEmotions, params.tickIntervalMs)
  );

  // 3b. Energy state (if enabled and available)
  if (params.energyLevel != null && params.energyBand != null) {
    sections.push(formatEnergyContext(
      params.energyLevel,
      params.energyBand,
      params.circadianBaseline ?? 0.85,
      params.tickIntervalMs,
      params.wakeUpContext ?? undefined,
    ));
  }

  // 4. Working memory (if available and contact-triggered)
  if (params.workingMemory) {
    sections.push(
      buildWorkingMemorySection(
        params.workingMemory,
        params.contact?.fullName
      )
    );
  }

  // 5. Core self (if available)
  if (params.coreSelf) {
    sections.push(buildCoreSelfSection(params.coreSelf));
  }

  // 6. Short-term memory
  const stmSection = buildShortTermMemorySection(
    params.recentThoughts,
    params.recentExperiences,
    params.recentMessages,
    params.contact?.fullName,
    params.timezone
  );
  if (stmSection) {
    sections.push(stmSection);
  }

  // 6b. First-tick story kickstart (only on tick #1, when there's no history)
  if (params.tickNumber === 1 && params.recentExperiences.length === 0) {
    sections.push(buildFirstTickKickstart(
      params.compiledPersona,
      params.existenceParadigm,
      params.existenceLocation
    ));
  }

  // 7. Long-term memories (retrieved via semantic search)
  if (params.longTermMemories) {
    sections.push(
      '── RELEVANT MEMORIES ──\nThings you\'ve learned that may be relevant right now.\n\n' +
      params.longTermMemories +
      '\n\nThese are retrieved from your long-term memory based on relevance\nto the current context.'
    );
  }

  // 8. Goals (salient goals, graduating seeds, proposed goals)
  if (params.goalContext) {
    sections.push(
      '── THINGS ON YOUR MIND ──\n' +
      'These are things you care about. They\'re part of who you are,\n' +
      'but they don\'t control you. You may advance them, reflect on\n' +
      'them, or set them aside entirely.\n\n' +
      params.goalContext
    );
  }

  if (params.graduatingSeedsContext) {
    sections.push('── EMERGING INTEREST ──\n' + params.graduatingSeedsContext);
  }

  if (params.proposedGoalsContext) {
    sections.push('── PENDING GOALS ──\n' + params.proposedGoalsContext);
  }

  // 9. Previous tick outcomes
  const prevSection = buildPreviousDecisionsSection(params.previousDecisions);
  if (prevSection) {
    sections.push(prevSection);
  }

  // 10. Plugin context sources
  if (params.pluginContextSources) {
    sections.push(`── PLUGIN CONTEXT ──\n${params.pluginContextSources}`);
  }

  // 11. Spawn budget note
  if (params.spawnBudgetNote) {
    sections.push(
      '── SESSION CONTEXT NOTE ──\n' + params.spawnBudgetNote
    );
  }

  // 12. Memory flush warning (session approaching context limit)
  if (params.memoryFlushPending) {
    sections.push(
      '── SESSION CONTEXT NOTE ──\n' +
      'This mind session is approaching its context limit and will end\n' +
      'after this tick. If there are any important observations, contact\n' +
      'notes, or self-knowledge you want to preserve, include them in\n' +
      'your working memory update, core self update, or memory candidates.\n' +
      'Anything not explicitly saved will be lost when the session resets.'
    );
  }

  return sections.join('\n\n');
}

/**
 * Build the full context for a mind tick.
 */
export function buildMindContext(params: MindContextParams): CompiledContext {
  const systemPromptOptions: Parameters<typeof buildSystemPrompt>[1] = {
    energySystemEnabled: params.energySystemEnabled ?? false,
    tickIntervalMs: params.tickIntervalMs,
    mindToolsEnabled: params.mindToolsEnabled ?? false,
  };
  if (params.pluginDecisionDescriptions) {
    systemPromptOptions.pluginDecisionDescriptions = params.pluginDecisionDescriptions;
  }

  const systemPrompt = params.sessionState === 'cold'
    ? buildSystemPrompt(params.compiledPersona, systemPromptOptions)
    : null;

  const userMessage = buildUserMessage(params);

  const tokenBreakdown: Record<string, number> = {};
  if (systemPrompt) {
    tokenBreakdown.systemPrompt = estimateTokens(systemPrompt);
  }
  tokenBreakdown.userMessage = estimateTokens(userMessage);

  return {
    systemPrompt,
    userMessage,
    tokenBreakdown,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function formatElapsedTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  if (remainingMin === 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  return `${hours}h ${remainingMin}m`;
}
