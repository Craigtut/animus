# gogcli Authentication

## Prerequisites

1. A Google Cloud project with OAuth2 credentials (Desktop app type)
2. Required Google APIs enabled in the Cloud Console

## Setup Flow

### Step 1: Store OAuth Client Credentials

```bash
# Download client_secret JSON from Google Cloud Console > APIs & Services > Credentials
gog auth credentials ~/Downloads/client_secret_*.json
```

Multiple clients can be stored:
```bash
gog --client work auth credentials ~/path/to/work-credentials.json
gog --client personal auth credentials ~/path/to/personal-credentials.json
```

### Step 2: Authorize an Account

**Standard flow** (opens browser automatically):
```bash
gog auth add you@gmail.com
```

**With specific services only** (least-privilege):
```bash
gog auth add you@gmail.com --services gmail,calendar,drive
gog auth add you@gmail.com --services user --readonly
```

**Manual flow** (no browser auto-open — useful for headless/remote):
```bash
gog auth add you@gmail.com --services user --manual
# 1. CLI prints an authorization URL
# 2. Open the URL in any browser (can be on a different machine)
# 3. Complete Google sign-in and consent
# 4. Copy the full redirect URL from the browser address bar
# 5. Paste it back into the terminal
```

**Split remote flow** (for SSH/remote servers):
```bash
# On the remote server (step 1 — generates the auth URL):
gog auth add you@gmail.com --services user --remote --step 1
# Copy the printed URL

# Open that URL in your local browser, complete sign-in
# Copy the callback URL from the browser

# On the remote server (step 2 — complete auth):
gog auth add you@gmail.com --services user --remote --step 2 --auth-url 'http://127.0.0.1:PORT/oauth2/callback?code=...&state=...'
```

### Step 3: Verify

```bash
gog auth status
gog auth list
gog auth list --check   # Validates tokens are still working
```

## Service Scopes

Control which Google APIs the token can access:

| Flag | Services |
|------|----------|
| `--services gmail` | Gmail only |
| `--services calendar` | Calendar only |
| `--services drive` | Drive only |
| `--services gmail,calendar,drive` | Multiple services |
| `--services user` | Basic profile (People API) |
| `--readonly` | Read-only access (combine with --services) |
| `--drive-scope full` | Full Drive access (default) |
| `--drive-scope readonly` | Read-only Drive |
| `--drive-scope file` | Per-file access only |
| `--force-consent` | Force re-consent (useful to add new scopes) |

## Account Management

```bash
# List all accounts
gog auth list --json

# Set aliases for convenience
gog auth alias set work work@company.com
gog auth alias set personal me@gmail.com

# Use alias
gog --account work gmail search "is:unread"

# Set default via env
export GOG_ACCOUNT=work@company.com

# Remove an account
gog auth remove old@example.com

# Manage tokens
gog auth tokens          # Show token info
gog auth manage          # Interactive token management
```

## Service Accounts (Google Workspace only)

For domain-wide delegation without user interaction:

```bash
# Set up service account
gog auth service-account set admin@company.com --key ~/service-account-key.json

# Check status
gog auth service-account status admin@company.com

# Remove
gog auth service-account unset admin@company.com
```

Prerequisites:
1. Service account created in Google Cloud Console
2. Domain-wide delegation enabled
3. Scopes allowlisted in Google Workspace Admin Console

## Keyring Backends

Credentials are stored securely:

```bash
# Check current backend
gog auth keyring

# macOS: uses Keychain (default)
# Linux: uses system keyring (libsecret)
# Fallback: encrypted file

# Force file backend (useful for headless servers)
export GOG_KEYRING_BACKEND=file
export GOG_KEYRING_PASSWORD="your-secure-password"
```

## Re-Authentication

If tokens expire or scopes need updating:
```bash
# Re-auth with broader scopes
gog auth add you@gmail.com --services gmail,calendar,drive,docs,sheets --force-consent

# Check if tokens are valid
gog auth list --check
```

## Agent Automation Notes

For automated/agent use:
- Use `--no-input` flag on all commands to prevent interactive prompts
- The `--manual` and `--remote --step 1/2` flows enable auth without a local browser
- Service accounts bypass user interaction entirely (Workspace only)
- File keyring backend (`GOG_KEYRING_BACKEND=file`) avoids OS keychain GUI prompts
- Set `GOG_ACCOUNT` env var to avoid `--account` on every command
