/**
 * Discord Channel Adapter
 *
 * Connects to Discord via the Gateway WebSocket as a bot.
 * Receives messages, responds in channels/DMs/threads.
 * Runs in an isolated child process.
 *
 * Uses Discord REST API + Gateway directly — no discord.js dependency.
 * Node.js 24 built-in fetch and WebSocket are used.
 */

import type {
  AdapterContext,
  ChannelAdapter,
  RouteRequest,
  RouteResponse,
} from '@animus/channel-sdk';

// Discord Gateway opcodes
const GatewayOp = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
} as const;

// Gateway intents bitmask
// GUILDS (1<<0) | GUILD_MESSAGES (1<<9) | DIRECT_MESSAGES (1<<12) | MESSAGE_CONTENT (1<<15)
const GATEWAY_INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);

const API_BASE = 'https://discord.com/api/v10';

// ============================================================================
// Tool Approval Types (metadata-based, no import needed)
// ============================================================================

interface ApprovalRequestMeta {
  requestId: string;
  toolName: string;
  toolDisplayName: string;
  toolSource: string;
  triggerSummary: string;
  expiresAt: string;
}

export default function createAdapter(ctx: AdapterContext): ChannelAdapter {
  const botToken = ctx.config['botToken'] as string;
  const allowedGuildIds =
    (ctx.config['allowedGuildIds'] as string[] | undefined) ?? [];
  const allowDMs = (ctx.config['allowDMs'] as boolean | undefined) ?? true;
  const requireMention =
    (ctx.config['requireMention'] as boolean | undefined) ?? true;

  let running = false;
  let botUserId: string | null = null;

  // Gateway state
  let ws: WebSocket | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let lastSequence: number | null = null;
  let sessionId: string | null = null;
  let resumeGatewayUrl: string | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Discord REST helpers ---

  async function discordFetch(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<unknown> {
    const resp = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> | undefined),
      },
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Discord API ${resp.status}: ${body}`);
    }
    // Some endpoints return 204 No Content
    if (resp.status === 204) return null;
    return resp.json();
  }

  async function sendDiscordMessage(
    channelId: string,
    content: string
  ): Promise<void> {
    // Discord enforces a 2000 character limit per message
    if (content.length <= 2000) {
      await discordFetch(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      return;
    }

    // Split long messages at line boundaries when possible
    const chunks: string[] = [];
    let remaining = content;
    while (remaining.length > 0) {
      if (remaining.length <= 2000) {
        chunks.push(remaining);
        break;
      }
      // Try to split at a newline within the limit
      let splitIdx = remaining.lastIndexOf('\n', 2000);
      if (splitIdx <= 0) splitIdx = 2000;
      chunks.push(remaining.substring(0, splitIdx));
      remaining = remaining.substring(splitIdx);
      // Trim leading newline from next chunk
      if (remaining.startsWith('\n')) remaining = remaining.substring(1);
    }

    for (const chunk of chunks) {
      await discordFetch(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: chunk }),
      });
    }
  }

  /**
   * Send a message with media attachments via multipart/form-data.
   * Discord supports up to 10 attachments per message.
   */
  async function sendDiscordMessageWithMedia(
    channelId: string,
    content: string,
    media: Array<{ type: string; data: string; mimeType: string; filename?: string }>
  ): Promise<void> {
    const form = new FormData();

    // Build the payload_json with attachment references
    const attachments = media.map((m, i) => ({
      id: i,
      filename: m.filename ?? `attachment-${i}`,
    }));
    const payloadJson = JSON.stringify({
      content: content.length > 2000 ? content.substring(0, 2000) : content,
      attachments,
    });
    form.append('payload_json', payloadJson);

    // Append each file as a numbered field
    for (let i = 0; i < media.length; i++) {
      const m = media[i]!;
      const buffer = Buffer.from(m.data, 'base64');
      const blob = new Blob([buffer], { type: m.mimeType });
      const filename = m.filename ?? `attachment-${i}`;
      form.append(`files[${i}]`, blob, filename);
    }

    const resp = await fetch(`${API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
      },
      body: form,
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Discord API ${resp.status}: ${body}`);
    }
  }

  /**
   * Send a tool approval request as a Discord embed with action buttons.
   */
  async function sendApprovalEmbed(
    channelId: string,
    approval: ApprovalRequestMeta
  ): Promise<void> {
    const embed = {
      title: 'Tool Approval Required',
      description: approval.triggerSummary,
      color: 0xf59e0b, // amber
      fields: [
        {
          name: 'Tool',
          value: approval.toolDisplayName,
          inline: true,
        },
        {
          name: 'Source',
          value: approval.toolSource,
          inline: true,
        },
      ],
      footer: {
        text: `Expires: ${approval.expiresAt}`,
      },
    };

    const components = [
      {
        type: 1, // ACTION_ROW
        components: [
          {
            type: 2, // BUTTON
            style: 3, // SUCCESS (green)
            label: 'Allow Once',
            custom_id: `tool_approve_once:${approval.requestId}`,
          },
          {
            type: 2,
            style: 4, // DANGER (red)
            label: 'Deny',
            custom_id: `tool_deny:${approval.requestId}`,
          },
        ],
      },
    ];

    await discordFetch(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ embeds: [embed], components }),
    });
  }

  // --- Gateway WebSocket ---

  function clearGatewayTimers(): void {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function connectGateway(): void {
    if (!running) return;

    const url =
      resumeGatewayUrl ?? 'wss://gateway.discord.gg/?v=10&encoding=json';

    ctx.log.debug(`Connecting to gateway: ${url}`);

    try {
      ws = new WebSocket(url);
    } catch (err) {
      ctx.log.error(
        `Failed to create WebSocket: ${err instanceof Error ? err.message : String(err)}`
      );
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      ctx.log.info('Gateway WebSocket connected');

      // If we have a session, attempt resume
      if (sessionId && lastSequence !== null && ws) {
        ws.send(
          JSON.stringify({
            op: GatewayOp.Resume,
            d: {
              token: botToken,
              session_id: sessionId,
              seq: lastSequence,
            },
          })
        );
      }
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const data =
          typeof event.data === 'string' ? event.data : String(event.data);
        const payload = JSON.parse(data);
        handleGatewayPayload(payload);
      } catch (err) {
        ctx.log.error(
          `Failed to parse gateway message: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });

    ws.addEventListener('close', (event: { code: number; reason: string }) => {
      ctx.log.warn(`Gateway closed: code=${event.code} reason=${event.reason}`);
      clearGatewayTimers();
      ws = null;
      if (running) {
        scheduleReconnect();
      }
    });

    ws.addEventListener('error', () => {
      // The close event fires after error, so reconnect is handled there
      ctx.log.error('Gateway WebSocket error');
    });
  }

  function scheduleReconnect(): void {
    if (!running || reconnectTimer) return;
    const delay = 5000;
    ctx.log.info(`Reconnecting to gateway in ${delay}ms`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectGateway();
    }, delay);
  }

  function sendHeartbeat(): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op: GatewayOp.Heartbeat, d: lastSequence }));
    }
  }

  function handleGatewayPayload(payload: {
    op: number;
    d: any;
    s: number | null;
    t: string | null;
  }): void {
    const { op, d, s, t } = payload;

    if (s !== null) lastSequence = s;

    switch (op) {
      case GatewayOp.Hello: {
        const interval = d.heartbeat_interval as number;
        // Send first heartbeat after a jittered delay per Discord docs
        const jitter = Math.random();
        setTimeout(() => sendHeartbeat(), interval * jitter);
        heartbeatInterval = setInterval(() => sendHeartbeat(), interval);

        // Send Identify if this is a fresh connection (not a resume)
        if (!sessionId && ws) {
          ws.send(
            JSON.stringify({
              op: GatewayOp.Identify,
              d: {
                token: botToken,
                intents: GATEWAY_INTENTS,
                properties: {
                  os: 'linux',
                  browser: 'animus',
                  device: 'animus',
                },
              },
            })
          );
        }
        break;
      }

      case GatewayOp.HeartbeatAck:
        // All good
        break;

      case GatewayOp.Dispatch:
        if (t) handleDispatch(t, d);
        break;

      case GatewayOp.Reconnect:
        ctx.log.info('Gateway requested reconnect');
        ws?.close(4000, 'Reconnect requested');
        break;

      case GatewayOp.InvalidSession: {
        const resumable = d as boolean;
        ctx.log.warn(`Invalid session (resumable=${resumable})`);
        if (!resumable) {
          sessionId = null;
          lastSequence = null;
          resumeGatewayUrl = null;
        }
        // Close and reconnect after a random delay (1-5s per Discord docs)
        const delay = 1000 + Math.random() * 4000;
        ws?.close(4000, 'Invalid session');
        if (running) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectGateway();
          }, delay);
        }
        break;
      }
    }
  }

  function handleDispatch(eventName: string, data: any): void {
    switch (eventName) {
      case 'READY':
        botUserId = data.user.id;
        sessionId = data.session_id;
        resumeGatewayUrl = data.resume_gateway_url;
        ctx.log.info(
          `Logged in as ${data.user.username}#${data.user.discriminator} (${botUserId})`
        );
        break;

      case 'RESUMED':
        ctx.log.info('Gateway session resumed');
        break;

      case 'MESSAGE_CREATE':
        handleMessage(data).catch(err =>
          ctx.log.error(`Error handling message: ${err instanceof Error ? err.message : String(err)}`)
        );
        break;

      case 'INTERACTION_CREATE':
        handleInteraction(data).catch(err =>
          ctx.log.error(`Error handling interaction: ${err instanceof Error ? err.message : String(err)}`)
        );
        break;
    }
  }

  async function handleMessage(message: any): Promise<void> {
    // Ignore messages from bots (including ourselves)
    if (message.author.bot) return;

    const isDM = !message.guild_id;
    // Discord channel types: 10 = ANNOUNCEMENT_THREAD, 11 = PUBLIC_THREAD, 12 = PRIVATE_THREAD
    const channelType = message.channel?.type;
    const isThread = channelType === 10 || channelType === 11 || channelType === 12;

    // Check DM permission
    if (isDM && !allowDMs) return;

    // Check guild restriction
    if (!isDM && allowedGuildIds.length > 0) {
      if (!allowedGuildIds.includes(message.guild_id)) return;
    }

    // In server channels (not DMs, not threads), check if bot is mentioned
    if (!isDM && !isThread && requireMention && botUserId) {
      const mentioned = (message.mentions as any[])?.some(
        (m: any) => m.id === botUserId
      );
      if (!mentioned) return;
    }

    // Extract content, stripping the bot mention if present
    let content = (message.content as string) || '';
    if (botUserId) {
      content = content.replace(new RegExp(`<@!?${botUserId}>`, 'g'), '').trim();
    }

    // Collect media attachments
    const media: Array<{
      type: 'image' | 'audio' | 'video' | 'file';
      mimeType: string;
      url: string;
      filename?: string;
    }> = [];

    if (message.attachments && Array.isArray(message.attachments)) {
      for (const att of message.attachments) {
        let type: 'image' | 'audio' | 'video' | 'file' = 'file';
        const ct = (att.content_type as string) || '';
        if (ct.startsWith('image/')) type = 'image';
        else if (ct.startsWith('audio/')) type = 'audio';
        else if (ct.startsWith('video/')) type = 'video';

        media.push({
          type,
          mimeType: ct || 'application/octet-stream',
          url: att.url,
          filename: att.filename,
        });
      }
    }

    // Skip if no content and no attachments
    if (!content && media.length === 0) return;

    // Download media through the engine (main process handles filesystem writes)
    for (const m of media) {
      try {
        const downloadParams: Parameters<typeof ctx.downloadMedia>[0] = {
          url: m.url,
          mimeType: m.mimeType,
        };
        if (m.filename) downloadParams.filename = m.filename;
        const result = await ctx.downloadMedia(downloadParams);
        // Update media entry with local path from engine
        m.url = result.localPath;
      } catch (err) {
        ctx.log.error(
          `Failed to download attachment: ${err instanceof Error ? err.message : String(err)}`
        );
        // Keep original URL as fallback
      }
    }

    // Conversation scoping: channel_id for DMs, server channels, and threads
    const conversationId = message.channel_id as string;

    const incoming: Parameters<typeof ctx.reportIncoming>[0] = {
      identifier: message.author.id,
      content,
      conversationId,
      metadata: {
        messageId: message.id,
        channelId: message.channel_id,
        guildId: message.guild_id ?? null,
        isDM,
        isThread,
        authorUsername: message.author.username,
      },
    };
    if (media.length > 0) incoming.media = media;
    ctx.reportIncoming(incoming);
  }

  /**
   * Handle button interactions (tool approval responses).
   */
  async function handleInteraction(interaction: any): Promise<void> {
    // Only handle component interactions (type 3 = MESSAGE_COMPONENT)
    if (interaction.type !== 3) return;

    const customId = interaction.data?.custom_id as string | undefined;
    if (!customId) return;

    // Parse tool approval button custom_id
    let action: 'approve' | 'deny' | null = null;
    let requestId: string | null = null;

    if (customId.startsWith('tool_approve_once:')) {
      action = 'approve';
      requestId = customId.substring('tool_approve_once:'.length);
    } else if (customId.startsWith('tool_deny:')) {
      action = 'deny';
      requestId = customId.substring('tool_deny:'.length);
    }

    if (!action || !requestId) return;

    // Acknowledge the interaction immediately (deferred update)
    try {
      await discordFetch(`/interactions/${interaction.id}/${interaction.token}/callback`, {
        method: 'POST',
        body: JSON.stringify({
          type: 7, // UPDATE_MESSAGE
          data: {
            embeds: interaction.message?.embeds ?? [],
            components: [], // Remove buttons after click
          },
        }),
      });
    } catch (err) {
      ctx.log.error(`Failed to acknowledge interaction: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Report the approval/denial to the engine as an incoming message
    const userId = interaction.member?.user?.id ?? interaction.user?.id ?? 'unknown';
    const channelId = interaction.channel_id as string;

    const content = action === 'approve'
      ? `Approved tool request ${requestId}`
      : `Denied tool request ${requestId}`;

    ctx.reportIncoming({
      identifier: userId,
      content,
      conversationId: channelId,
      metadata: {
        type: 'tool_approval_response',
        requestId,
        approved: action === 'approve',
        channelId,
        interactionId: interaction.id,
      },
    });
  }

  // --- Adapter interface ---

  return {
    async start(): Promise<void> {
      running = true;
      connectGateway();
      ctx.log.info('Discord adapter starting — connecting to gateway');
    },

    async stop(): Promise<void> {
      running = false;
      clearGatewayTimers();
      if (ws) {
        ws.close(1000, 'Adapter stopping');
        ws = null;
      }
      ctx.log.info('Discord adapter stopped');
    },

    async send(
      contactId: string,
      content: string,
      metadata?: Record<string, unknown>
    ): Promise<void> {
      // Prefer channelId from metadata (reply in the same channel the message came from)
      const channelId = metadata?.['channelId'] as string | undefined;
      const media = metadata?.['media'] as
        | Array<{ type: string; data: string; mimeType: string; filename?: string }>
        | undefined;

      // Check for tool approval request metadata
      const messageType = metadata?.['message_type'] as string | undefined;
      const approvalRequests = metadata?.['approval_requests'] as ApprovalRequestMeta[] | undefined;

      // Determine target channel
      let targetChannelId: string;
      if (channelId) {
        targetChannelId = channelId;
      } else {
        // Fallback: DM the user directly
        const contact = await ctx.resolveContact(contactId);
        if (!contact) {
          ctx.log.error(`Cannot send: contact ${contactId} not found`);
          return;
        }
        const dm = (await discordFetch('/users/@me/channels', {
          method: 'POST',
          body: JSON.stringify({ recipient_id: contact.identifier }),
        })) as { id: string };
        targetChannelId = dm.id;
      }

      // Handle tool approval requests — send as embed with buttons
      if (messageType === 'tool_approval_request' && approvalRequests && approvalRequests.length > 0) {
        for (const approval of approvalRequests) {
          try {
            await sendApprovalEmbed(targetChannelId, approval);
            ctx.log.debug(`Approval embed sent for tool "${approval.toolName}" in channel ${targetChannelId}`);
          } catch (err) {
            ctx.log.error(`Failed to send approval embed: ${err instanceof Error ? err.message : String(err)}`);
            // Fall back to plain text
            await sendDiscordMessage(targetChannelId, content);
          }
        }
        return;
      }

      // Send with or without media
      if (media && media.length > 0) {
        await sendDiscordMessageWithMedia(targetChannelId, content, media);
        ctx.log.debug(`Message with ${media.length} attachment(s) sent to channel ${targetChannelId}`);
      } else {
        await sendDiscordMessage(targetChannelId, content);
        ctx.log.debug(`Message sent to channel ${targetChannelId}`);
      }
    },
  };
}
