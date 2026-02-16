---
name: google-suite
description: >
  Google Suite CLI via gogcli (gog). Use when the user asks about Gmail, email,
  Google Calendar, events, scheduling, Google Drive, files, Docs, Sheets,
  Slides, Google Tasks, Contacts, Google Chat, or any Google Workspace service.
  Handles search, send, create, read, update, delete across all Google services.
  Also use for "check my email", "what's on my calendar", "find a file",
  "send an email", "create a doc", "add a task", "message someone on chat".
  Also use when user asks to "connect Google" or "set up Google".
allowed-tools: Bash Read run_with_credentials
---

# Google Suite CLI (gogcli)

`gog` is a CLI for Google services. JSON-first output, multi-account, least-privilege auth.

## First-Time Setup (Agent-Guided)

Before using any Google commands, you MUST verify setup is complete. Run through these checks in order. If any step fails, guide the user through it conversationally.

### Step 1: Check if gogcli is installed

```bash
which gog || echo "NOT_INSTALLED"
```

If not installed, tell the user:
- **macOS**: `brew install steipete/tap/gogcli`
- **Linux (Arch)**: `yay -S gogcli`
- **Docker**: Should be pre-installed in the image. If not, this needs to be added to the Dockerfile.

Wait for the user to confirm installation before proceeding.

### Step 2: Initialize keyring and plugin config

Check if the plugin config has a keyring password set. If not, generate one and save it:

```
run_with_credentials({
  command: "gog auth status --no-input",
  credentialRef: "google-suite.GOG_KEYRING_PASSWORD",
  envVar: "GOG_KEYRING_PASSWORD",
  extraEnv: { "GOG_KEYRING_BACKEND": "file", "GOG_COLOR": "never" }
})
```

If the credential ref fails (not configured yet), ask the user to go to **Settings > Plugins > Google Suite > Configure** and set a keyring password (any strong random string). This password encrypts gogcli's token storage on disk.

### Step 3: Register OAuth client credentials

Check if OAuth credentials are registered:

```
run_with_credentials({
  command: "gog auth credentials list --json --no-input",
  credentialRef: "google-suite.GOG_KEYRING_PASSWORD",
  envVar: "GOG_KEYRING_PASSWORD",
  extraEnv: { "GOG_KEYRING_BACKEND": "file", "GOG_COLOR": "never" }
})
```

If no credentials are registered, the user needs to provide a Google OAuth client:

1. Tell the user: "To connect Google services, you need OAuth credentials from Google Cloud Console. This is a one-time setup."
2. Walk them through:
   - Go to https://console.cloud.google.com/
   - Create a new project (or use existing)
   - Go to APIs & Services > Credentials
   - Create OAuth 2.0 Client ID (type: Desktop app)
   - Download the JSON file
3. Ask the user for the path to the downloaded `client_secret_*.json` file
4. Register it:

```
run_with_credentials({
  command: "gog auth credentials /path/to/client_secret.json --no-input",
  credentialRef: "google-suite.GOG_KEYRING_PASSWORD",
  envVar: "GOG_KEYRING_PASSWORD",
  extraEnv: { "GOG_KEYRING_BACKEND": "file", "GOG_COLOR": "never" }
})
```

Also remind them to enable the APIs they need (Gmail API, Calendar API, Drive API, etc.) in the Cloud Console under APIs & Services > Library.

### Step 4: Authenticate a Google account

Check if any accounts are authenticated:

```
run_with_credentials({
  command: "gog auth list --check --json --no-input",
  credentialRef: "google-suite.GOG_KEYRING_PASSWORD",
  envVar: "GOG_KEYRING_PASSWORD",
  extraEnv: { "GOG_KEYRING_BACKEND": "file", "GOG_COLOR": "never" }
})
```

If no accounts or tokens are expired, run the auth flow. Ask the user for their Google email, then:

**Use the split remote flow** (works in all environments — Tauri, Docker, bare Node):

```
run_with_credentials({
  command: "gog auth add user@gmail.com --remote --step 1 --services gmail,calendar,drive,docs,sheets,tasks,contacts --no-input",
  credentialRef: "google-suite.GOG_KEYRING_PASSWORD",
  envVar: "GOG_KEYRING_PASSWORD",
  extraEnv: { "GOG_KEYRING_BACKEND": "file", "GOG_COLOR": "never" }
})
```

This outputs an authorization URL. Send it to the user with these instructions:

> "Please open this link in your browser and sign in with your Google account:
>
> [URL]
>
> After you approve the permissions, your browser will redirect to a page that won't load — that's completely normal. Copy the **entire URL** from your browser's address bar (it starts with `http://127.0.0.1:...`) and paste it here."

When the user pastes the callback URL, complete the auth:

```
run_with_credentials({
  command: "gog auth add user@gmail.com --remote --step 2 --auth-url 'PASTED_URL_HERE' --no-input",
  credentialRef: "google-suite.GOG_KEYRING_PASSWORD",
  envVar: "GOG_KEYRING_PASSWORD",
  extraEnv: { "GOG_KEYRING_BACKEND": "file", "GOG_COLOR": "never" }
})
```

Confirm success: "Google connected! I can now access your Gmail, Calendar, Drive, and more."

**Note:** The state from step 1 is cached for ~10 minutes. If it expires, re-run step 1.

### Setup Complete

After all steps pass, Google commands work indefinitely. Tokens auto-refresh. The user should never need to re-authenticate unless they revoke access from Google or change their password.

---

## Running Commands

All `gog` commands MUST be run via `run_with_credentials` to inject the keyring password:

```
run_with_credentials({
  command: "gog gmail search 'is:unread' --max 5 --json --no-input",
  credentialRef: "google-suite.GOG_KEYRING_PASSWORD",
  envVar: "GOG_KEYRING_PASSWORD",
  extraEnv: {
    "GOG_KEYRING_BACKEND": "file",
    "GOG_JSON": "1",
    "GOG_COLOR": "never"
  }
})
```

If `GOG_ACCOUNT` is configured in the plugin config, also inject it:
```
run_with_credentials({
  command: "gog calendar events primary --today --json --no-input",
  credentialRef: "google-suite.GOG_KEYRING_PASSWORD",
  envVar: "GOG_KEYRING_PASSWORD",
  extraEnv: {
    "GOG_KEYRING_BACKEND": "file",
    "GOG_ACCOUNT": "<from plugin config>",
    "GOG_JSON": "1",
    "GOG_COLOR": "never"
  }
})
```

**Always include `--no-input --json`** on every command.

## Quick Reference: Most Common Commands

### Gmail

```bash
# Search (supports full Gmail search syntax)
gog gmail search "is:unread" --max 10 --json
gog gmail search "from:alice@example.com subject:invoice newer_than:7d" --max 5 --json
gog gmail search "has:attachment filename:pdf" --max 10 --json

# Read a thread
gog gmail thread get <threadId> --json

# Send email
gog gmail send --to recipient@example.com --subject "Hello" --body "Message body"
gog gmail send --to a@b.com --cc c@d.com --subject "Hi" --body-file ./message.txt

# Reply to a thread
gog gmail send --reply-to-message-id <messageId> --quote --to a@b.com --subject "Re: Hi" --body "My reply"

# Labels
gog gmail labels list --json
gog gmail thread modify <threadId> --add STARRED --remove INBOX

# Drafts
gog gmail drafts list --json
gog gmail drafts create --to a@b.com --subject "Draft" --body "Content"
gog gmail drafts send <draftId>
```

### Calendar

```bash
# View events
gog calendar events primary --today --json
gog calendar events primary --tomorrow --json
gog calendar events primary --week --json
gog calendar events primary --days 3 --json
gog calendar events primary --from today --to friday --json
gog calendar events --all --today --json          # All calendars

# Search events
gog calendar search "meeting" --today --json
gog calendar search "standup" --days 7 --json

# Create event
gog calendar create primary --summary "Meeting" --from 2025-01-15T10:00:00Z --to 2025-01-15T11:00:00Z
gog calendar create primary --summary "Team Sync" \
  --from 2025-01-15T14:00:00Z --to 2025-01-15T15:00:00Z \
  --attendees "alice@example.com,bob@example.com" \
  --location "Zoom" --send-updates all

# Update/delete
gog calendar update primary <eventId> --summary "New Title" --send-updates all
gog calendar delete primary <eventId> --force

# Respond to invite
gog calendar respond primary <eventId> --status accepted
gog calendar respond primary <eventId> --status declined

# Check conflicts
gog calendar conflicts --calendars "primary,work@example.com" --today --json

# Free/busy
gog calendar freebusy --calendars "primary" --from 2025-01-15T00:00:00Z --to 2025-01-16T00:00:00Z --json

# Current time
gog time now --json
```

### Drive

```bash
# List/search files
gog drive ls --max 20 --json
gog drive search "invoice" --max 20 --json
gog drive search "mimeType = 'application/pdf'" --raw-query --json

# Get file info
gog drive get <fileId> --json

# Upload/download
gog drive upload ./file.pdf --parent <folderId>
gog drive download <fileId> --out ./downloaded.pdf
gog drive download <fileId> --format pdf --out ./exported.pdf

# Create folder
gog drive mkdir "New Folder" --parent <parentFolderId>

# Share
gog drive share <fileId> --to user --email user@example.com --role reader
gog drive share <fileId> --to user --email user@example.com --role writer

# Move/rename
gog drive move <fileId> --parent <destinationFolderId>
gog drive rename <fileId> "New Name"
```

### Docs

```bash
gog docs cat <docId> --max-bytes 10000
gog docs info <docId> --json
gog docs create "My Document"
gog docs create "My Doc" --file ./content.md
gog docs write <docId> --replace --markdown --file ./updated.md
gog docs find-replace <docId> "old text" "new text"
gog docs export <docId> --format pdf --out ./doc.pdf
```

### Sheets

```bash
gog sheets get <spreadsheetId> 'Sheet1!A1:B10' --json
gog sheets metadata <spreadsheetId> --json
gog sheets update <spreadsheetId> 'A1' 'val1|val2,val3|val4'
gog sheets update <spreadsheetId> 'A1' --values-json '[["a","b"],["c","d"]]'
gog sheets append <spreadsheetId> 'Sheet1!A:C' 'new|row|data'
gog sheets create "My Spreadsheet" --sheets "Sheet1,Sheet2"
gog sheets export <spreadsheetId> --format xlsx --out ./sheet.xlsx
```

### Tasks

```bash
gog tasks lists --json
gog tasks list <tasklistId> --max 50 --json
gog tasks add <tasklistId> --title "Buy groceries"
gog tasks add <tasklistId> --title "Weekly review" --due 2025-02-01 --repeat weekly
gog tasks done <tasklistId> <taskId>
gog tasks undo <tasklistId> <taskId>
gog tasks update <tasklistId> <taskId> --title "Updated title"
gog tasks delete <tasklistId> <taskId>
```

### Contacts

```bash
gog contacts search "Alice" --max 10 --json
gog contacts list --max 50 --json
gog contacts get user@example.com --json
gog contacts create --given "John" --family "Doe" --email "john@example.com" --phone "+1234567890"
gog contacts update people/<resourceName> --given "Jane" --email "jane@example.com"
gog contacts directory search "Jane" --max 50 --json
```

### Chat (Google Workspace)

```bash
gog chat spaces list --json
gog chat messages send spaces/<spaceId> --text "Hello team!"
gog chat messages send spaces/<spaceId> --text "Reply" --thread spaces/<spaceId>/threads/<threadId>
gog chat dm send user@company.com --text "Hey!"
gog chat messages list spaces/<spaceId> --max 10 --json
gog chat messages list spaces/<spaceId> --unread --json
```

## Output Formats

| Flag | Format | Use Case |
|------|--------|----------|
| `--json` | JSON to stdout | Always use this for parsing |
| `--plain` | Tab-separated | Piping to other tools |
| _(none)_ | Human-friendly tables | Direct display to user |

## Error Handling

- **Not authenticated**: Run the setup flow (Step 4 above)
- **Token expired**: `gog auth add <email> --force-consent` with the same flow
- **Rate limited**: Google API quotas → wait and retry
- **Permission denied**: Missing scope → re-auth with additional `--services`
- **Not found**: Invalid ID → search/list first to find correct IDs

## Tips

- Use `--max` to limit results and avoid overwhelming output
- Thread IDs from Gmail search can be used with `gog gmail thread get`
- Calendar `primary` is the user's main calendar; `gog calendar calendars --json` lists others
- Drive file IDs are in the URL: `docs.google.com/document/d/<fileId>/edit`
- For recurring events, use `--rrule` with standard RRULE syntax

For deeper reference on each service, see the `references/` directory.
