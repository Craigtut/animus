/**
 * Tool Definitions — pure data structures for Animus tools.
 *
 * No handlers, no side effects, no dependencies on backend infrastructure.
 * Both the backend (which implements handlers) and the frontend
 * (which may display available tools in the UI) need access to these.
 *
 * See docs/architecture/mcp-tools.md
 */

import { z } from 'zod';

/**
 * A tool definition without a handler.
 * Pure declaration of what the tool does and what input it expects.
 */
export interface AnimusToolDef<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Unique tool name (e.g., 'send_message') */
  name: string;

  /** Human-readable description for the LLM */
  description: string;

  /**
   * Zod schema for input validation.
   *
   * IMPORTANT: Must be a z.object() at the top level. The MCP protocol requires
   * tool input schemas to produce `{ type: "object" }` in JSON Schema. Using
   * z.discriminatedUnion(), z.union(), or other non-object types will silently
   * break MCP tool discovery (the entire MCP server's tools become invisible).
   */
  inputSchema: TInput;

  /**
   * Tool category for UI grouping and permission logic.
   */
  category: 'messaging' | 'memory' | 'progress' | 'system' | 'speech';
}

/**
 * send_message - Send a message to the triggering contact via the originating channel.
 */
export const sendMessageDef: AnimusToolDef = {
  name: 'send_message',
  description:
    'Send a message to the user who triggered this task. The message will be delivered through the same channel they used (SMS, Discord, web, etc.). Use this for progress updates, clarifying questions, or sharing intermediate findings. You speak as Animus.',
  inputSchema: z.object({
    content: z.string().describe('The message content to send to the user'),
    priority: z
      .enum(['normal', 'urgent'])
      .default('normal')
      .describe(
        'Message priority. Use "urgent" only for time-sensitive information'
      ),
    media: z.array(z.object({
      type: z.enum(['image', 'audio', 'video', 'file']).describe('Media type'),
      path: z.string().describe('Local file path to the media file'),
      filename: z.string().optional().describe('Display filename for the attachment'),
    })).optional().describe('Optional media attachments to include with the message'),
  }),
  category: 'messaging',
};

/**
 * update_progress - Report progress back to the orchestrator.
 */
export const updateProgressDef: AnimusToolDef = {
  name: 'update_progress',
  description:
    'Report your current progress on the task. This helps Animus track what you are working on and can inform the user if they ask about task status. Call this periodically during long tasks.',
  inputSchema: z.object({
    activity: z
      .string()
      .describe('Brief description of what you are currently doing'),
    percentComplete: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe('Estimated percentage complete (0-100), if estimable'),
  }),
  category: 'progress',
};

/**
 * read_memory - Access Animus's long-term memory (LanceDB). Read-only.
 */
export const readMemoryDef: AnimusToolDef = {
  name: 'read_memory',
  description:
    "Search long-term memory for relevant information. GATHER CONTEXT pre-loads recent and relevant memories each tick, but use this tool when you need something specific that wasn't pre-loaded: a past conversation, a fact learned weeks ago, a procedure, or a specific outcome. Returns memories ranked by relevance. Each call adds a round-trip, so only use it when the pre-loaded context is insufficient.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        'Natural language search query describing what you want to recall'
      ),
    limit: z
      .number()
      .min(1)
      .max(20)
      .default(5)
      .describe('Maximum number of memories to return'),
    types: z
      .array(z.enum(['fact', 'experience', 'procedure', 'outcome']))
      .optional()
      .describe('Filter by memory type. Omit to search all types'),
  }),
  category: 'memory',
};

/**
 * lookup_contacts - Discover contacts and their available communication channels.
 * Mind-only tool (not available to sub-agents).
 */
export const lookupContactsDef: AnimusToolDef = {
  name: 'lookup_contacts',
  description:
    'Look up contacts and their available communication channels. GATHER CONTEXT includes a contacts summary each tick, but use this tool when you need to verify a specific contact exists or check their exact channels before sending a proactive message. Returns contact names, permission tiers, and available channels.',
  inputSchema: z.object({
    nameFilter: z
      .string()
      .optional()
      .describe('Filter contacts by name (case-insensitive partial match)'),
    channel: z
      .enum(['web', 'sms', 'discord', 'api'])
      .optional()
      .describe('Only return contacts reachable on this channel'),
  }),
  category: 'system',
};

/**
 * send_proactive_message - Send a message to any contact on any channel.
 * Mind-only tool. Goes through ChannelRouter.sendOutbound() for full delivery.
 */
export const sendProactiveMessageDef: AnimusToolDef = {
  name: 'send_proactive_message',
  description:
    'Send a message to any contact on any of their available channels. This is the ONLY way to message a user on non-message ticks (interval, scheduled task, agent completion), and the way to reach out on a different channel than the one that triggered this tick. Use lookup_contacts first to verify the contact ID and available channels. Goes through the full delivery pipeline (channel adapter, message storage, event emission).',
  inputSchema: z.object({
    contactId: z.string().uuid().describe('The contact ID to message'),
    channel: z
      .enum(['web', 'sms', 'discord', 'api'])
      .describe('Channel to send through'),
    content: z.string().describe('Message content'),
    media: z.array(z.object({
      type: z.enum(['image', 'audio', 'video', 'file']).describe('Media type'),
      path: z.string().describe('Local file path to the media file'),
      filename: z.string().optional().describe('Display filename for the attachment'),
    })).optional().describe('Optional media attachments to include with the message'),
  }),
  category: 'messaging',
};

/**
 * send_media - Send media files to the triggering contact via the originating channel.
 * Mind-only tool. Files must already exist on disk (from plugin tools, sub-agent results, etc.).
 */
export const sendMediaDef: AnimusToolDef = {
  name: 'send_media',
  description:
    'Send media files (images, audio, video, documents) to the contact you are currently ' +
    'responding to, on the same channel they messaged you from. Files must already exist on ' +
    'disk — typically produced by a plugin tool, sub-agent, or other process. Optionally ' +
    'include a caption that will be sent alongside the media.',
  inputSchema: z.object({
    files: z.array(z.object({
      path: z.string().describe('Absolute local file path to the media file'),
      type: z.enum(['image', 'audio', 'video', 'file']).optional()
        .describe('Media type. Auto-detected from file extension if omitted.'),
    })).min(1).describe('Media files to send'),
    caption: z.string().optional()
      .describe('Optional caption/message sent alongside the media'),
  }),
  category: 'messaging',
};

/**
 * run_with_credentials - Execute a command with a plugin credential injected
 * as an environment variable. The credential is resolved from encrypted
 * storage and never exposed to the LLM.
 */
export const runWithCredentialsDef: AnimusToolDef = {
  name: 'run_with_credentials',
  description:
    'Execute a command with one or more credentials injected as environment variables. ' +
    'Credentials are resolved from encrypted storage and injected only into the ' +
    'subprocess; you never see the raw values. Supports two reference formats: ' +
    '"pluginName.configKey" for plugin credentials, or "vault:<id>" for password ' +
    'vault entries (use list_vault_entries to find vault IDs). ' +
    'For commands needing multiple secrets (e.g., an API key plus a token), use ' +
    'additionalCredentials to inject extra credential refs alongside the primary one. ' +
    'For non-secret configuration flags (e.g., backend selection, color mode), use ' +
    'extraEnv to set plain environment variables that are NOT redacted from output.',
  inputSchema: z.object({
    command: z.string().describe('The full command to execute'),
    credentialRef: z.string().describe(
      'Credential reference: "pluginName.configKey" (e.g., "nano-banana-pro.GEMINI_API_KEY") or "vault:<id>" for vault entries'
    ),
    envVar: z.string().describe(
      'Environment variable name to inject the credential as (e.g., "GEMINI_API_KEY")'
    ),
    additionalCredentials: z.array(z.object({
      credentialRef: z.string().describe('Credential reference (e.g., "trello.TRELLO_API_TOKEN")'),
      envVar: z.string().describe('Environment variable name to inject as'),
    })).optional().describe(
      'Additional credentials to inject. Use when a command needs multiple credentials (e.g., API key + token).'
    ),
    extraEnv: z.record(z.string()).optional().describe(
      'Additional non-secret environment variables to set for the subprocess (e.g., {"GOG_KEYRING_BACKEND": "file"}). These are NOT treated as secrets and will not be redacted from output.'
    ),
    cwd: z.string().optional().describe('Working directory. Defaults to project root.'),
  }),
  category: 'system',
};

/**
 * resolve_tool_approval - Resolve a pending tool approval request.
 * Mind-only tool. Used when the user approves or denies a tool usage
 * request via natural language conversation.
 */
export const resolveToolApprovalDef: AnimusToolDef = {
  name: 'resolve_tool_approval',
  description:
    "Resolve a pending tool approval request based on the user's response. " +
    'Use this when a user approves or denies a tool usage request via natural language. ' +
    'The request ID will be provided in the tick context under pending approval requests.',
  inputSchema: z.object({
    requestId: z.string().describe('The approval request ID from context'),
    approved: z
      .boolean()
      .describe('Whether the user approved the tool usage'),
  }),
  category: 'system',
};

/**
 * transcribe_audio - Transcribe an audio file to text using local STT.
 * Mind-only tool.
 */
export const transcribeAudioDef: AnimusToolDef = {
  name: 'transcribe_audio',
  description:
    'Transcribe an audio file to text using the local speech-to-text engine (Parakeet TDT v3). ' +
    'Supports WAV files directly. Other formats (WebM, MP3, etc.) require ffmpeg to be installed. ' +
    'Returns the transcribed text.',
  inputSchema: z.object({
    filePath: z
      .string()
      .describe('Absolute path to the audio file to transcribe'),
  }),
  category: 'speech',
};

/**
 * generate_speech - Synthesize text to speech using local TTS.
 * Mind-only tool. Pairs with send_media to deliver audio.
 */
export const generateSpeechDef: AnimusToolDef = {
  name: 'generate_speech',
  description:
    'Synthesize text into speech audio using the local text-to-speech engine (Pocket TTS). ' +
    'Returns the path to the generated WAV file in data/media/speech/. ' +
    'Use send_media to deliver the audio file to the user. ' +
    'By default uses the persona voice; optionally override with a specific voice ID.',
  inputSchema: z.object({
    text: z.string().min(1).describe('The text to synthesize into speech'),
    speed: z
      .number()
      .min(0.5)
      .max(2.0)
      .optional()
      .describe('Speech speed multiplier (default: 1.0)'),
    voiceId: z
      .string()
      .optional()
      .describe('Override the persona default voice. Use a built-in name (e.g., "alba") or a custom voice UUID.'),
  }),
  category: 'speech',
};

/**
 * list_vault_entries - List stored password vault entries (metadata only, no passwords).
 * Mind-only tool.
 */
export const listVaultEntriesDef: AnimusToolDef = {
  name: 'list_vault_entries',
  description:
    'List all entries in the password vault. Returns metadata for each entry: label, service, ' +
    'URL, identity (username/email), and a hint (last 4 characters of the password). ' +
    'Never returns actual passwords. Use this to discover what credentials are available ' +
    'before using run_with_credentials with a vault:<id> reference.',
  inputSchema: z.object({
    service: z
      .string()
      .optional()
      .describe('Filter entries by service name (case-insensitive partial match)'),
  }),
  category: 'system',
};

/**
 * send_voice_reply - Reply to the current conversation with a voice message.
 * Mind-only tool. Combines TTS + channel delivery + text storage.
 */
export const sendVoiceReplyDef: AnimusToolDef = {
  name: 'send_voice_reply',
  description:
    'Reply to the current conversation with a voice message. Synthesizes the text into ' +
    'speech audio and delivers it through the channel. The text is stored as message content ' +
    'in conversation history for future context. Use this when the user sent you a voice ' +
    'message and you want to reply in kind, or when a spoken response feels more natural ' +
    "than text. Write your text as natural speech: no emojis, markdown, URLs, or " +
    "anything that doesn't translate well to spoken word. " +
    'IMPORTANT: When you call send_voice_reply, do NOT also write a text reply in your ' +
    'natural language output. Your spoken text would be sent as a SEPARATE text message, ' +
    'duplicating your voice reply. After calling this tool, skip the reply phase entirely ' +
    'and go straight to record_cognitive_state.',
  inputSchema: z.object({
    text: z.string().min(1).describe(
      'The text to speak. Write as natural speech — no emojis, no markdown, no URLs.'
    ),
    speed: z.number().min(0.5).max(2.0).optional()
      .describe('Speech speed multiplier (default: 1.0)'),
    voiceId: z.string().optional()
      .describe('Override the persona default voice. Use a built-in name or custom voice UUID.'),
  }),
  category: 'speech',
};

/**
 * manage_vault_entry - Create, update, or delete password vault entries.
 * Mind-only tool. Passwords are system-generated (agents never choose them).
 */
export const manageVaultEntryDef: AnimusToolDef = {
  name: 'manage_vault_entry',
  description:
    'Create, update, or delete password vault entries. Passwords are always generated by the system ' +
    '(you never choose them). You can only update or delete entries you previously created.\n\n' +
    'Actions:\n' +
    '- create: Provide account metadata. A strong password is generated automatically. Returns the vault ref for use with run_with_credentials.\n' +
    '- update: Update metadata or regenerate the password for an agent-created entry.\n' +
    '- delete: Remove an agent-created entry (e.g., after a failed signup).',
  inputSchema: z.object({
    action: z.enum(['create', 'update', 'delete']).describe('Action to perform'),
    // Required for create:
    label: z.string().optional().describe('Short name for this credential (e.g., "GitHub account"). Required for create.'),
    service: z.string().optional().describe('Service name (e.g., "github.com"). Required for create.'),
    // Required for update/delete:
    id: z.string().optional().describe('Vault entry ID. Required for update and delete.'),
    // Optional metadata (create or update):
    url: z.string().optional().describe('Login URL for the service'),
    identity: z.string().optional().describe('Username or email used for this account'),
    notes: z.string().optional().describe('Usage notes for future reference'),
    // Password options (create or update with regeneratePassword):
    passwordLength: z.number().min(8).max(128).optional().describe('Password length (default: 32)'),
    excludeSymbols: z.boolean().optional().describe('Exclude special characters from password'),
    // Update-only:
    regeneratePassword: z.boolean().optional().describe('Generate a new password (update only)'),
  }),
  category: 'system',
};

/**
 * Central registry of all Animus tool definitions.
 * This is the single source of truth for what tools exist.
 * Handlers are attached separately in the backend.
 */
export const ANIMUS_TOOL_DEFS = {
  send_message: sendMessageDef,
  update_progress: updateProgressDef,
  read_memory: readMemoryDef,
  lookup_contacts: lookupContactsDef,
  send_proactive_message: sendProactiveMessageDef,
  send_media: sendMediaDef,
  run_with_credentials: runWithCredentialsDef,
  list_vault_entries: listVaultEntriesDef,
  manage_vault_entry: manageVaultEntryDef,
  resolve_tool_approval: resolveToolApprovalDef,
  transcribe_audio: transcribeAudioDef,
  generate_speech: generateSpeechDef,
  send_voice_reply: sendVoiceReplyDef,
} as const;

export type AnimusToolName = keyof typeof ANIMUS_TOOL_DEFS;

/**
 * Tools available to the mind session (main orchestrator).
 * These are the core tools the mind can invoke dynamically during a tick,
 * beyond what GATHER CONTEXT pre-loads.
 *
 * The mind uses `reply` for the common case (responding to triggering contact).
 * These tools handle cases beyond that:
 * - read_memory: dynamic memory search beyond pre-loaded context
 * - lookup_contacts: discover contacts and channels at call time
 * - send_proactive_message: send to any contact on any channel
 * - resolve_tool_approval: handle user responses to tool approval requests
 *
 * Excludes send_message (sub-agent only) and update_progress (sub-agent only).
 */
export const MIND_TOOL_NAMES: readonly AnimusToolName[] = [
  'read_memory', 'lookup_contacts', 'send_proactive_message', 'send_media', 'run_with_credentials', 'list_vault_entries',
  'manage_vault_entry', 'resolve_tool_approval', 'transcribe_audio', 'generate_speech', 'send_voice_reply',
] as const;
