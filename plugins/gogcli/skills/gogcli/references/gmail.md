# Gmail — Full Reference

## Search

Full Gmail search syntax is supported:

```bash
# Basic searches
gog gmail search "is:unread" --max 10 --json
gog gmail search "is:starred" --max 10 --json
gog gmail search "in:sent" --max 10 --json
gog gmail search "from:alice@example.com" --max 5 --json
gog gmail search "to:bob@example.com newer_than:7d" --max 10 --json

# Complex queries
gog gmail search "from:alice@example.com subject:invoice newer_than:30d has:attachment" --max 5 --json
gog gmail search "filename:pdf larger:1M" --max 10 --json
gog gmail search "{from:alice from:bob} subject:project" --max 10 --json   # OR syntax

# Message-level search (vs thread-level default)
gog gmail messages search "is:unread" --max 5 --json
gog gmail messages search "from:alice" --include-body --max 3 --json
```

## Reading Messages

```bash
# Get full thread
gog gmail thread get <threadId> --json

# Get single message
gog gmail get <messageId> --json
gog gmail get <messageId> --format metadata --json   # Headers only

# Download attachments from a thread
gog gmail thread get <threadId> --download --out-dir ./attachments

# Get specific attachment
gog gmail attachment <messageId> <attachmentId> --out ./file.bin

# Get Gmail URL for a thread
gog gmail url <threadId>
```

## Sending Email

```bash
# Plain text
gog gmail send --to a@b.com --subject "Hello" --body "Plain text message"

# HTML email with plain text fallback
gog gmail send --to a@b.com --subject "Report" --body "Plain fallback" --body-html "<h1>Report</h1><p>Details...</p>"

# From file
gog gmail send --to a@b.com --subject "Report" --body-file ./message.txt

# From stdin
echo "Message body" | gog gmail send --to a@b.com --subject "Hello" --body-file -

# With CC/BCC
gog gmail send --to a@b.com --cc c@d.com --bcc e@f.com --subject "Hi" --body "Hello"

# Reply to existing message
gog gmail send --reply-to-message-id <messageId> --quote --to a@b.com --subject "Re: Hi" --body "My reply"

# With email tracking
gog gmail send --to a@b.com --subject "Proposal" --body-html "<p>See attached</p>" --track
```

## Drafts

```bash
gog gmail drafts list --json
gog gmail drafts create --to a@b.com --subject "Draft" --body "Content"
gog gmail drafts update <draftId> --subject "Updated Draft" --body "New content"
gog gmail drafts send <draftId>
```

## Labels

```bash
gog gmail labels list --json
gog gmail labels get INBOX --json
gog gmail labels create "My Custom Label"
gog gmail labels delete <labelIdOrName>

# Modify thread labels
gog gmail thread modify <threadId> --add STARRED --remove INBOX
gog gmail labels modify <threadId> --add "My Label" --remove UNREAD
```

## Batch Operations

```bash
# Delete multiple messages
gog gmail batch delete <msgId1> <msgId2> <msgId3>

# Modify multiple messages
gog gmail batch modify <msgId1> <msgId2> --add STARRED --remove INBOX
```

## Filters

```bash
gog gmail filters list --json
gog gmail filters create --from 'noreply@example.com' --add-label 'Notifications'
gog gmail filters delete <filterId>
```

## Settings

```bash
# Auto-forwarding
gog gmail autoforward get --json
gog gmail autoforward enable --email forward@example.com
gog gmail autoforward disable

# Send-as aliases
gog gmail sendas list --json
gog gmail sendas create --email alias@example.com

# Vacation responder
gog gmail vacation get --json
gog gmail vacation enable --subject "Out of office" --message "I'll be back on Monday"
gog gmail vacation disable

# Delegates
gog gmail delegates list --json
gog gmail delegates add --email delegate@example.com
gog gmail delegates remove --email delegate@example.com
```

## Gmail Watch (Pub/Sub Push Notifications)

```bash
# Start watching for changes
gog gmail watch start --topic projects/<project>/topics/<topic> --label INBOX

# Start a local webhook server for push notifications
gog gmail watch serve --bind 127.0.0.1 --token <shared-secret> --hook-url http://127.0.0.1:18789/hooks/agent

# With spam/trash filtering
gog gmail watch serve --bind 127.0.0.1 --token <shared> --exclude-labels SPAM,TRASH --hook-url <url>

# Get history since a point
gog gmail history --since <historyId> --json
```

## Email Tracking

```bash
# Setup tracking (requires Cloudflare Worker)
gog gmail track setup --worker-url https://gog-email-tracker.<acct>.workers.dev

# Check opens
gog gmail track opens <tracking_id>
gog gmail track opens --to recipient@example.com
gog gmail track status
```
