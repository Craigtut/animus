/**
 * Discord Channel Adapter (v2)
 *
 * Connects to Discord via discord.js as a bot.
 * Receives messages, responds in channels/DMs/threads.
 * Runs in an isolated child process.
 */

import {
  Client, GatewayIntentBits, Partials, Options,
  EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
  AttachmentBuilder, MessageFlags, Events,
  ChannelType as DjsChannelType,
} from 'discord.js';
import type { Message as DjsMessage, Interaction, ButtonInteraction } from 'discord.js';
import type {
  AdapterContext,
  ChannelAdapter,
} from '@animus/channel-sdk';

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

  // --- discord.js client ---

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildPresences,
    ],
    partials: [Partials.Channel],
    makeCache: Options.cacheWithLimits({
      MessageManager: 50,
      GuildMemberManager: 0,
      PresenceManager: 0,
      UserManager: 0,
      GuildEmojiManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
    }),
  });

  // --- Message text splitting (Discord 2000 char limit) ---

  function splitText(content: string): string[] {
    if (content.length <= 2000) return [content];

    const chunks: string[] = [];
    let remaining = content;
    while (remaining.length > 0) {
      if (remaining.length <= 2000) {
        chunks.push(remaining);
        break;
      }
      let splitIdx = remaining.lastIndexOf('\n', 2000);
      if (splitIdx <= 0) splitIdx = 2000;
      chunks.push(remaining.substring(0, splitIdx));
      remaining = remaining.substring(splitIdx);
      if (remaining.startsWith('\n')) remaining = remaining.substring(1);
    }
    return chunks;
  }

  // --- Event handlers ---

  client.once(Events.ClientReady, (readyClient) => {
    ctx.log.info(`Logged in as ${readyClient.user.tag} (${readyClient.user.id})`);
  });

  client.on(Events.MessageCreate, async (message: DjsMessage) => {
    try {
      await handleMessage(message);
    } catch (err) {
      ctx.log.error(`Error handling message: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      await handleInteraction(interaction);
    } catch (err) {
      ctx.log.error(`Error handling interaction: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  client.on(Events.PresenceUpdate, (_oldPresence, newPresence) => {
    if (!newPresence?.user || newPresence.user.bot) return;
    // discord.js includes 'invisible' which maps to 'offline' in our model
    const status = newPresence.status === 'invisible' ? 'offline' as const : newPresence.status;
    const activity = newPresence.activities[0];
    ctx.reportPresence({
      identifier: newPresence.userId,
      status,
      statusText: activity?.state ?? undefined,
      activity: activity?.name ?? undefined,
    });
  });

  // --- Message handling ---

  async function handleMessage(message: DjsMessage): Promise<void> {
    if (message.author.bot) return;

    const isDM = !message.guildId;
    const isThread =
      message.channel.type === DjsChannelType.PublicThread ||
      message.channel.type === DjsChannelType.PrivateThread ||
      message.channel.type === DjsChannelType.AnnouncementThread;

    // Check DM permission
    if (isDM && !allowDMs) return;

    // Check guild restriction
    if (!isDM && allowedGuildIds.length > 0) {
      if (!allowedGuildIds.includes(message.guildId!)) return;
    }

    // In server channels (not DMs, not threads), check if bot is mentioned
    if (!isDM && !isThread && requireMention && client.user) {
      if (!message.mentions.has(client.user.id)) return;
    }

    // Extract content, stripping the bot mention if present
    let content = message.content || '';
    if (client.user) {
      content = content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    }

    // Collect media attachments
    const media: Array<{
      type: 'image' | 'audio' | 'video' | 'file';
      mimeType: string;
      url: string;
      filename?: string;
    }> = [];

    for (const att of message.attachments.values()) {
      let type: 'image' | 'audio' | 'video' | 'file' = 'file';
      const ct = att.contentType || '';
      if (ct.startsWith('image/')) type = 'image';
      else if (ct.startsWith('audio/')) type = 'audio';
      else if (ct.startsWith('video/')) type = 'video';

      media.push({
        type,
        mimeType: ct || 'application/octet-stream',
        url: att.url,
        filename: att.name ?? undefined,
      });
    }

    // Skip if no content and no attachments
    if (!content && media.length === 0) return;

    // Download media through the engine
    for (const m of media) {
      try {
        const downloadParams: Parameters<typeof ctx.downloadMedia>[0] = {
          url: m.url,
          mimeType: m.mimeType,
        };
        if (m.filename) downloadParams.filename = m.filename;
        const result = await ctx.downloadMedia(downloadParams);
        m.url = result.localPath;
      } catch (err) {
        ctx.log.error(
          `Failed to download attachment: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Conversation scoping: channel_id for DMs, server channels, and threads
    const conversationId = message.channelId;

    const incoming: Parameters<typeof ctx.reportIncoming>[0] = {
      identifier: message.author.id,
      content,
      conversationId,
      metadata: {
        messageId: message.id,
        channelId: message.channelId,
        guildId: message.guildId ?? null,
        isDM,
        isThread,
        authorUsername: message.author.username,
      },
    };
    if (media.length > 0) incoming.media = media;
    ctx.reportIncoming(incoming);
  }

  // --- Interaction handling (tool approval buttons) ---

  async function handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    if (!customId) return;

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

    // Acknowledge — remove buttons after click
    try {
      await interaction.update({ components: [] });
    } catch (err) {
      ctx.log.error(`Failed to acknowledge interaction: ${err instanceof Error ? err.message : String(err)}`);
    }

    const userId = interaction.user.id;
    const channelId = interaction.channelId;

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
      await client.login(botToken);
      ctx.log.info('Discord adapter started');
    },

    async stop(): Promise<void> {
      client.destroy();
      ctx.log.info('Discord adapter stopped');
    },

    async performAction(action: { type: string; [key: string]: unknown }): Promise<void> {
      switch (action.type) {
        case 'typing_indicator': {
          const channelId = action['channelId'] as string;
          if (!channelId) return;
          const channel = await client.channels.fetch(channelId);
          if (channel?.isTextBased() && 'sendTyping' in channel) {
            await (channel as any).sendTyping();
          }
          break;
        }
        case 'add_reaction': {
          const channelId = action['channelId'] as string;
          const messageId = action['messageId'] as string;
          const emoji = action['emoji'] as string;
          if (!channelId || !messageId || !emoji) return;
          const channel = await client.channels.fetch(channelId);
          if (channel?.isTextBased() && 'messages' in channel) {
            const msg = await (channel as any).messages.fetch(messageId);
            await msg.react(emoji);
          }
          break;
        }
        case 'send_voice_message': {
          const channelId = action['channelId'] as string;
          const oggBase64 = action['audioData'] as string;
          const durationSecs = action['durationSecs'] as number;
          const waveform = action['waveform'] as string;
          if (!channelId || !oggBase64) return;
          const oggBuffer = Buffer.from(oggBase64, 'base64');
          const form = new FormData();
          form.append('payload_json', JSON.stringify({
            flags: MessageFlags.IsVoiceMessage,
            attachments: [{ id: 0, filename: 'voice-message.ogg', duration_secs: durationSecs, waveform }],
          }));
          form.append('files[0]', new Blob([oggBuffer], { type: 'audio/ogg' }), 'voice-message.ogg');
          await client.rest.post(`/channels/${channelId}/messages`, { body: form, passThroughBody: true } as any);
          break;
        }
      }
    },

    async send(
      contactId: string,
      content: string,
      metadata?: Record<string, unknown>
    ): Promise<void> {
      const channelId = metadata?.['channelId'] as string | undefined;
      const media = metadata?.['media'] as
        | Array<{ type: string; data: string; mimeType: string; filename?: string }>
        | undefined;

      const messageType = metadata?.['message_type'] as string | undefined;
      const approvalRequests = metadata?.['approval_requests'] as ApprovalRequestMeta[] | undefined;

      // Determine target channel
      let targetChannel: any;
      if (channelId) {
        targetChannel = await client.channels.fetch(channelId);
        if (!targetChannel?.isTextBased()) {
          ctx.log.error(`Channel ${channelId} is not text-based`);
          return;
        }
      } else {
        // Fallback: DM the user directly
        const contact = await ctx.resolveContact(contactId);
        if (!contact) {
          ctx.log.error(`Cannot send: contact ${contactId} not found`);
          return;
        }
        const user = await client.users.fetch(contact.identifier);
        targetChannel = await user.createDM();
      }

      // Handle tool approval requests — send as embed with buttons
      if (messageType === 'tool_approval_request' && approvalRequests && approvalRequests.length > 0) {
        for (const approval of approvalRequests) {
          try {
            const embed = new EmbedBuilder()
              .setTitle('Tool Approval Required')
              .setDescription(approval.triggerSummary)
              .setColor(0xf59e0b)
              .addFields(
                { name: 'Tool', value: approval.toolDisplayName, inline: true },
                { name: 'Source', value: approval.toolSource, inline: true },
              )
              .setFooter({ text: `Expires: ${approval.expiresAt}` });

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`tool_approve_once:${approval.requestId}`)
                .setLabel('Allow Once')
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`tool_deny:${approval.requestId}`)
                .setLabel('Deny')
                .setStyle(ButtonStyle.Danger),
            );

            await targetChannel.send({ embeds: [embed], components: [row] });
            ctx.log.debug(`Approval embed sent for tool "${approval.toolName}" in channel ${targetChannel.id}`);
          } catch (err) {
            ctx.log.error(`Failed to send approval embed: ${err instanceof Error ? err.message : String(err)}`);
            // Fall back to plain text
            for (const chunk of splitText(content)) {
              await targetChannel.send(chunk);
            }
          }
        }
        return;
      }

      // Send with or without media
      if (media && media.length > 0) {
        const attachments = media.map((m, i) => {
          const buffer = Buffer.from(m.data, 'base64');
          return new AttachmentBuilder(buffer, { name: m.filename ?? `attachment-${i}` });
        });

        const textContent = content.length > 2000 ? content.substring(0, 2000) : content;
        await targetChannel.send({ content: textContent, files: attachments });
        ctx.log.debug(`Message with ${media.length} attachment(s) sent to channel ${targetChannel.id}`);
      } else {
        const chunks = splitText(content);
        for (const chunk of chunks) {
          await targetChannel.send(chunk);
        }
        ctx.log.debug(`Message sent to channel ${targetChannel.id}`);
      }
    },
  };
}
