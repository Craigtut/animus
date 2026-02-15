# Discord Channel

Connect Animus to Discord as a bot. Responds in server channels, DMs, and threads.

## Setup

### 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name, and create it
3. Copy the **Application ID** from the General Information page — you'll need it for configuration

### 2. Create the Bot

1. Go to the **Bot** section in the left sidebar
2. Click **Reset Token** (or **Add Bot** if it doesn't exist yet) and copy the **Bot Token** — this is the only time you'll see it
3. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** — required for reading message text

### 3. Set Bot Permissions

Under the **Bot** section, set the bot permissions. At minimum Animus needs:

- **Send Messages**
- **Read Message History**
- **View Channels**

If you want Animus to participate in threads, also enable:

- **Send Messages in Threads**
- **Read Message History** (in threads)

### 4. Generate an Invite Link

1. Go to the **OAuth2** section in the left sidebar
2. Under **OAuth2 URL Generator**, select the `bot` scope
3. Select the permissions from step 3
4. Copy the generated URL and open it in your browser to add the bot to your server

### 5. Install in Animus

1. Open Animus and go to **Settings > Channels**
2. Click **Install Channel** and enter the path to this directory
3. Open the channel's configuration and fill in:
   - **Bot Token** — the token from step 2
   - **Application ID** — the application ID from step 1
4. Enable the channel

## Configuration

| Field | Required | Description |
|-------|----------|-------------|
| Bot Token | Yes | Bot token from the Discord Developer Portal |
| Application ID | Yes | Application ID from the Developer Portal |
| Allowed Server IDs | No | Restrict the bot to specific servers. Leave empty to respond in all servers the bot is in. |
| Allow Direct Messages | No | Whether the bot responds to DMs (default: on) |
| Require @mention | No | When on, the bot only responds in server channels when mentioned. Always responds in DMs and threads. (default: on) |

## How It Works

- Connects to Discord via the Gateway WebSocket (no `discord.js` dependency)
- In server channels, the bot only responds when @mentioned (configurable)
- In DMs and threads, the bot responds to all messages
- Messages from other bots are ignored
- Long replies (over 2000 characters) are automatically split at line boundaries
- Media attachments (images, audio, video, files) are downloaded and forwarded to Animus
- Contacts are identified by their Discord user ID (snowflake)

## Troubleshooting

**Bot comes online but doesn't respond to messages**
- Make sure **Message Content Intent** is enabled in the Developer Portal (Bot section > Privileged Gateway Intents)
- If `Require @mention` is on, you need to @mention the bot in server channels
- Check if `Allowed Server IDs` is restricting the bot to a different server

**Bot doesn't appear online**
- Verify the bot token is correct
- Check the channel status in Animus — if it shows an error, the token may be invalid

**"Missing Access" or permission errors**
- Re-invite the bot with the correct permissions using a new OAuth2 URL
- Make sure the bot's role has access to the channels you want it to read
