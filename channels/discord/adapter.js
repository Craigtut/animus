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
};
// Gateway intents bitmask
// GUILDS (1<<0) | GUILD_MESSAGES (1<<9) | DIRECT_MESSAGES (1<<12) | MESSAGE_CONTENT (1<<15)
const GATEWAY_INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);
const API_BASE = 'https://discord.com/api/v10';
export default function createAdapter(ctx) {
    const botToken = ctx.config['botToken'];
    const allowedGuildIds = ctx.config['allowedGuildIds'] ?? [];
    const allowDMs = ctx.config['allowDMs'] ?? true;
    const requireMention = ctx.config['requireMention'] ?? true;
    let running = false;
    let botUserId = null;
    // Gateway state
    let ws = null;
    let heartbeatInterval = null;
    let lastSequence = null;
    let sessionId = null;
    let resumeGatewayUrl = null;
    let reconnectTimer = null;
    // --- Discord REST helpers ---
    async function discordFetch(endpoint, options = {}) {
        const resp = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers: {
                Authorization: `Bot ${botToken}`,
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });
        if (!resp.ok) {
            const body = await resp.text();
            throw new Error(`Discord API ${resp.status}: ${body}`);
        }
        // Some endpoints return 204 No Content
        if (resp.status === 204)
            return null;
        return resp.json();
    }
    async function sendDiscordMessage(channelId, content) {
        // Discord enforces a 2000 character limit per message
        if (content.length <= 2000) {
            await discordFetch(`/channels/${channelId}/messages`, {
                method: 'POST',
                body: JSON.stringify({ content }),
            });
            return;
        }
        // Split long messages at line boundaries when possible
        const chunks = [];
        let remaining = content;
        while (remaining.length > 0) {
            if (remaining.length <= 2000) {
                chunks.push(remaining);
                break;
            }
            // Try to split at a newline within the limit
            let splitIdx = remaining.lastIndexOf('\n', 2000);
            if (splitIdx <= 0)
                splitIdx = 2000;
            chunks.push(remaining.substring(0, splitIdx));
            remaining = remaining.substring(splitIdx);
            // Trim leading newline from next chunk
            if (remaining.startsWith('\n'))
                remaining = remaining.substring(1);
        }
        for (const chunk of chunks) {
            await discordFetch(`/channels/${channelId}/messages`, {
                method: 'POST',
                body: JSON.stringify({ content: chunk }),
            });
        }
    }
    // --- Gateway WebSocket ---
    function clearGatewayTimers() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    }
    function connectGateway() {
        if (!running)
            return;
        const url = resumeGatewayUrl ?? 'wss://gateway.discord.gg/?v=10&encoding=json';
        ctx.log.debug(`Connecting to gateway: ${url}`);
        try {
            ws = new WebSocket(url);
        }
        catch (err) {
            ctx.log.error(`Failed to create WebSocket: ${err instanceof Error ? err.message : String(err)}`);
            scheduleReconnect();
            return;
        }
        ws.addEventListener('open', () => {
            ctx.log.info('Gateway WebSocket connected');
            // If we have a session, attempt resume
            if (sessionId && lastSequence !== null && ws) {
                ws.send(JSON.stringify({
                    op: GatewayOp.Resume,
                    d: {
                        token: botToken,
                        session_id: sessionId,
                        seq: lastSequence,
                    },
                }));
            }
        });
        ws.addEventListener('message', (event) => {
            try {
                const data = typeof event.data === 'string' ? event.data : String(event.data);
                const payload = JSON.parse(data);
                handleGatewayPayload(payload);
            }
            catch (err) {
                ctx.log.error(`Failed to parse gateway message: ${err instanceof Error ? err.message : String(err)}`);
            }
        });
        ws.addEventListener('close', (event) => {
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
    function scheduleReconnect() {
        if (!running || reconnectTimer)
            return;
        const delay = 5000;
        ctx.log.info(`Reconnecting to gateway in ${delay}ms`);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectGateway();
        }, delay);
    }
    function sendHeartbeat() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: GatewayOp.Heartbeat, d: lastSequence }));
        }
    }
    function handleGatewayPayload(payload) {
        const { op, d, s, t } = payload;
        if (s !== null)
            lastSequence = s;
        switch (op) {
            case GatewayOp.Hello: {
                const interval = d.heartbeat_interval;
                // Send first heartbeat after a jittered delay per Discord docs
                const jitter = Math.random();
                setTimeout(() => sendHeartbeat(), interval * jitter);
                heartbeatInterval = setInterval(() => sendHeartbeat(), interval);
                // Send Identify if this is a fresh connection (not a resume)
                if (!sessionId && ws) {
                    ws.send(JSON.stringify({
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
                    }));
                }
                break;
            }
            case GatewayOp.HeartbeatAck:
                // All good
                break;
            case GatewayOp.Dispatch:
                if (t)
                    handleDispatch(t, d);
                break;
            case GatewayOp.Reconnect:
                ctx.log.info('Gateway requested reconnect');
                ws?.close(4000, 'Reconnect requested');
                break;
            case GatewayOp.InvalidSession: {
                const resumable = d;
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
    function handleDispatch(eventName, data) {
        switch (eventName) {
            case 'READY':
                botUserId = data.user.id;
                sessionId = data.session_id;
                resumeGatewayUrl = data.resume_gateway_url;
                ctx.log.info(`Logged in as ${data.user.username}#${data.user.discriminator} (${botUserId})`);
                break;
            case 'RESUMED':
                ctx.log.info('Gateway session resumed');
                break;
            case 'MESSAGE_CREATE':
                handleMessage(data).catch(err => ctx.log.error(`Error handling message: ${err instanceof Error ? err.message : String(err)}`));
                break;
        }
    }
    async function handleMessage(message) {
        // Ignore messages from bots (including ourselves)
        if (message.author.bot)
            return;
        const isDM = !message.guild_id;
        // Discord channel types: 10 = ANNOUNCEMENT_THREAD, 11 = PUBLIC_THREAD, 12 = PRIVATE_THREAD
        const channelType = message.channel?.type;
        const isThread = channelType === 10 || channelType === 11 || channelType === 12;
        // Check DM permission
        if (isDM && !allowDMs)
            return;
        // Check guild restriction
        if (!isDM && allowedGuildIds.length > 0) {
            if (!allowedGuildIds.includes(message.guild_id))
                return;
        }
        // In server channels (not DMs, not threads), check if bot is mentioned
        if (!isDM && !isThread && requireMention && botUserId) {
            const mentioned = message.mentions?.some((m) => m.id === botUserId);
            if (!mentioned)
                return;
        }
        // Extract content, stripping the bot mention if present
        let content = message.content || '';
        if (botUserId) {
            content = content.replace(new RegExp(`<@!?${botUserId}>`, 'g'), '').trim();
        }
        // Collect media attachments
        const media = [];
        if (message.attachments && Array.isArray(message.attachments)) {
            for (const att of message.attachments) {
                let type = 'file';
                const ct = att.content_type || '';
                if (ct.startsWith('image/'))
                    type = 'image';
                else if (ct.startsWith('audio/'))
                    type = 'audio';
                else if (ct.startsWith('video/'))
                    type = 'video';
                media.push({
                    type,
                    mimeType: ct || 'application/octet-stream',
                    url: att.url,
                    filename: att.filename,
                });
            }
        }
        // Skip if no content and no attachments
        if (!content && media.length === 0)
            return;
        // Download media through the engine (main process handles filesystem writes)
        for (const m of media) {
            try {
                const downloadParams = {
                    url: m.url,
                    mimeType: m.mimeType,
                };
                if (m.filename)
                    downloadParams.filename = m.filename;
                const result = await ctx.downloadMedia(downloadParams);
                // Update media entry with local path from engine
                m.url = result.localPath;
            }
            catch (err) {
                ctx.log.error(`Failed to download attachment: ${err instanceof Error ? err.message : String(err)}`);
                // Keep original URL as fallback
            }
        }
        // Conversation scoping: channel_id for DMs, server channels, and threads
        const conversationId = message.channel_id;
        const incoming = {
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
        if (media.length > 0)
            incoming.media = media;
        ctx.reportIncoming(incoming);
    }
    // --- Adapter interface ---
    return {
        async start() {
            running = true;
            connectGateway();
            ctx.log.info('Discord adapter starting — connecting to gateway');
        },
        async stop() {
            running = false;
            clearGatewayTimers();
            if (ws) {
                ws.close(1000, 'Adapter stopping');
                ws = null;
            }
            ctx.log.info('Discord adapter stopped');
        },
        async send(contactId, content, metadata) {
            // Prefer channelId from metadata (reply in the same channel the message came from)
            const channelId = metadata?.['channelId'];
            if (channelId) {
                await sendDiscordMessage(channelId, content);
                ctx.log.debug(`Message sent to channel ${channelId}`);
                return;
            }
            // Fallback: DM the user directly
            const contact = await ctx.resolveContact(contactId);
            if (!contact) {
                ctx.log.error(`Cannot send: contact ${contactId} not found`);
                return;
            }
            // Create or fetch the DM channel
            const dm = (await discordFetch('/users/@me/channels', {
                method: 'POST',
                body: JSON.stringify({ recipient_id: contact.identifier }),
            }));
            await sendDiscordMessage(dm.id, content);
            ctx.log.debug(`DM sent to user ${contact.identifier}`);
        },
    };
}
