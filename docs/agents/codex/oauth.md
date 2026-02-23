# Codex OAuth Device Code Flow: Research & Proxy Design

> **Purpose**: Design document for proxying the Codex CLI OAuth device code flow through Animus's web UI
> **Status**: Research complete
> **Last Updated**: 2026-02-08

## Table of Contents

1. [Overview](#overview)
2. [OpenAI OAuth Infrastructure](#openai-oauth-infrastructure)
3. [Device Code Flow: Complete Specification](#device-code-flow-complete-specification)
4. [Token Lifecycle](#token-lifecycle)
5. [auth.json Format](#authjson-format)
6. [Differences from RFC 8628](#differences-from-rfc-8628)
7. [Animus Proxy Architecture](#animus-proxy-architecture)
8. [Implementation Plan](#implementation-plan)

---

## Overview

The Codex CLI authenticates users via ChatGPT OAuth, allowing access to OpenAI models through a ChatGPT Plus/Pro/Team/Enterprise subscription (no API key required). The CLI supports two OAuth flows:

1. **Browser-based PKCE flow** (default) -- opens a local HTTP server on `localhost:1455` and redirects through the browser
2. **Device code flow** (headless) -- displays a user code and verification URL; user authenticates on any device

For Animus, we need the **device code flow** because the server runs headless and must proxy authentication through the web UI.

### Prerequisites

The user must enable "Device code authentication for Codex" in their ChatGPT security settings (personal account) or have their workspace admin enable it (workspace accounts). Without this, the device code endpoints return HTTP 404.

---

## OpenAI OAuth Infrastructure

### Endpoints

| Purpose | URL |
|---------|-----|
| Authorization (browser flow) | `https://auth.openai.com/oauth/authorize` |
| Token exchange | `https://auth.openai.com/oauth/token` |
| Device code: request user code | `https://auth.openai.com/api/accounts/deviceauth/usercode` |
| Device code: poll for auth code | `https://auth.openai.com/api/accounts/deviceauth/token` |
| Device code: user verification | `https://auth.openai.com/codex/device` |

### Client Configuration

| Parameter | Value |
|-----------|-------|
| Client ID | `app_EMoamEEZ73f0CkXaXp7hrann` |
| Scopes | `openid profile email offline_access` |
| Redirect URI (browser flow) | `http://localhost:1455/auth/callback` |
| PKCE Method | S256 |

**Important**: This is a **public client** (no client_secret). The same client_id is used by all Codex CLI installations and third-party integrations.

### Additional Authorization Parameters

These are sent during the browser OAuth flow and may not be required for device code, but are part of the Codex CLI identity:

```
codex_cli_simplified_flow=true
id_token_add_organizations=true
originator=codex_cli_rs
```

---

## Device Code Flow: Complete Specification

The device code flow is a **modified** version of RFC 8628. OpenAI uses a custom two-phase approach rather than the standard single-step device authorization grant.

### Phase 1: Request User Code

**Endpoint**: `POST https://auth.openai.com/api/accounts/deviceauth/usercode`

**Request**:
```http
POST /api/accounts/deviceauth/usercode HTTP/1.1
Host: auth.openai.com
Content-Type: application/json

{
  "client_id": "app_EMoamEEZ73f0CkXaXp7hrann"
}
```

**Response** (200 OK):
```json
{
  "device_auth_id": "da_xxxxxxxxxxxxxxxx",
  "user_code": "ABCD-EFGH",
  "interval": 5
}
```

| Field | Type | Description |
|-------|------|-------------|
| `device_auth_id` | string | Unique identifier for this device auth session |
| `user_code` | string | Code the user enters in the browser (format: `XXXX-XXXX`) |
| `interval` | number (from string) | Polling interval in seconds (typically 5) |

**Error** (404):
Device code login is not enabled for this user/workspace. The user needs to enable it in ChatGPT security settings.

### Phase 2: User Authenticates in Browser

The user navigates to `https://auth.openai.com/codex/device` and enters the `user_code`. They sign in with their ChatGPT account and authorize the device.

### Phase 3: Poll for Authorization Code

**Endpoint**: `POST https://auth.openai.com/api/accounts/deviceauth/token`

**Request**:
```http
POST /api/accounts/deviceauth/token HTTP/1.1
Host: auth.openai.com
Content-Type: application/json

{
  "device_auth_id": "da_xxxxxxxxxxxxxxxx",
  "user_code": "ABCD-EFGH"
}
```

**Polling Behavior**:
- Poll every `interval` seconds (typically 5s)
- Maximum timeout: **15 minutes** (900 seconds)
- HTTP 403 = authorization pending (keep polling)
- HTTP 404 = device code login not enabled (stop)
- HTTP 2xx = success (proceed to token exchange)

**Success Response** (200 OK):
```json
{
  "authorization_code": "ac_xxxxxxxxxxxxxxxx",
  "code_challenge": "base64url_encoded_challenge",
  "code_verifier": "base64url_encoded_verifier"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `authorization_code` | string | OAuth authorization code for token exchange |
| `code_challenge` | string | PKCE code challenge (S256) |
| `code_verifier` | string | PKCE code verifier (server-generated for device flow) |

**Key difference from standard device code flow**: The server returns an `authorization_code` plus PKCE parameters, NOT the tokens directly. This must be exchanged at the standard token endpoint.

### Phase 4: Exchange Authorization Code for Tokens

**Endpoint**: `POST https://auth.openai.com/oauth/token`

**Request**:
```http
POST /oauth/token HTTP/1.1
Host: auth.openai.com
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id=app_EMoamEEZ73f0CkXaXp7hrann
&code=ac_xxxxxxxxxxxxxxxx
&code_verifier=base64url_encoded_verifier
&redirect_uri=http://localhost:1455/auth/callback
```

**Note**: The `redirect_uri` is required even in device code flow -- it must match the registered redirect URI for the client.

**Response** (200 OK):
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "refresh_token": "rt_xxxxxxxxxxxxxxxx",
  "id_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

| Field | Type | Description |
|-------|------|-------------|
| `access_token` | string (JWT) | Bearer token for API requests (~1 hour lifetime) |
| `refresh_token` | string | Long-lived token for obtaining new access tokens |
| `id_token` | string (JWT) | OpenID Connect identity token |
| `token_type` | string | Always "Bearer" |
| `expires_in` | number | Access token lifetime in seconds (typically 3600) |

---

## Token Lifecycle

### Access Token

- **Format**: JWT (RS256 signed)
- **Lifetime**: ~1 hour (3600 seconds)
- **Usage**: `Authorization: Bearer <access_token>` header on API requests
- **Custom Claims** (in JWT payload):
  ```json
  {
    "https://api.openai.com/auth": {
      "chatgpt_account_id": "acct_xxxxxxxx",
      "organization_id": "org_xxxxxxxx",
      "project_id": "proj_xxxxxxxx"
    }
  }
  ```
- The `chatgpt_account_id` is extracted and sent as the `Chatgpt-Account-Id` header on API requests

### Refresh Token

- **Format**: Opaque string prefixed with `rt_`
- **Lifetime**: Long-lived (weeks/months), but single-use (rotated on each refresh)
- **Rotation**: Each refresh returns a new `refresh_token`. The old one is immediately invalidated. Using an already-used refresh token will fail with an error requiring re-authentication.

### Token Refresh Flow

**Endpoint**: `POST https://auth.openai.com/oauth/token`

**Request**:
```http
POST /oauth/token HTTP/1.1
Host: auth.openai.com
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&client_id=app_EMoamEEZ73f0CkXaXp7hrann
&refresh_token=rt_xxxxxxxxxxxxxxxx
```

**Response**: Same format as initial token exchange (new `access_token`, new `refresh_token`, etc.)

### Refresh Strategy

- Codex CLI refreshes proactively when the access token expires within **5 minutes**
- Refresh tokens themselves are refreshed approximately every **8 days** (varies)
- If a refresh token has been used (token rotation), the old refresh token is invalidated -- this is a known source of errors in the Codex CLI

---

## auth.json Format

### Codex CLI Native Format (~/.codex/auth.json)

```json
{
  "auth_mode": "chatgpt",
  "tokens": {
    "access_token": "eyJhbGciOiJSUzI1NiIs...",
    "refresh_token": "rt_xxxxxxxxxxxxxxxx",
    "id_token": "eyJhbGciOiJSUzI1NiIs...",
    "expires_at": "2026-02-08T23:59:59Z"
  },
  "last_refresh": "2026-02-08T22:59:59Z"
}
```

The file is created with `0600` permissions (owner read/write only).

### Storage Options (cli_auth_credentials_store config)

| Value | Location | Notes |
|-------|----------|-------|
| `file` | `~/.codex/auth.json` | Plaintext, treat like a password |
| `keyring` | OS credential store | macOS Keychain, Windows Credential Manager, etc. |
| `auto` | OS store with file fallback | Default behavior |

### For Animus

We will NOT use `~/.codex/auth.json`. Instead, we store tokens encrypted in `system.db` and write a temporary `auth.json` to a per-session directory before spawning Codex SDK sessions. Alternatively, we can set `CODEX_HOME` to point to a directory where we've written the auth file.

---

## Differences from RFC 8628

OpenAI's device code flow deviates from the standard [RFC 8628 Device Authorization Grant](https://tools.ietf.org/html/rfc8628) in several significant ways:

| Aspect | RFC 8628 | OpenAI Codex |
|--------|----------|--------------|
| Device authorization endpoint | `/device_authorization` | `/api/accounts/deviceauth/usercode` |
| Request body | `client_id`, `scope` | `client_id` only |
| Response | `device_code`, `user_code`, `verification_uri`, `interval`, `expires_in` | `device_auth_id`, `user_code`, `interval` |
| Token polling endpoint | Standard token endpoint | Separate `/api/accounts/deviceauth/token` endpoint |
| Polling request | `grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=X` | `{ device_auth_id, user_code }` (JSON) |
| Polling response (pending) | `{"error": "authorization_pending"}` | HTTP 403 (no body) |
| Polling response (success) | Tokens directly | `authorization_code` + PKCE params |
| Token acquisition | Direct from polling | **Two-step**: polling returns auth code, then standard token exchange |
| Slow down signal | `{"error": "slow_down"}` | Not observed |
| Expiry communication | `expires_in` in device code response | Not in response (hardcoded 15 min) |

### Key Implications for Implementation

1. **Two-step token acquisition**: Unlike RFC 8628 where polling returns tokens directly, OpenAI returns an `authorization_code` + PKCE values that must be exchanged at `/oauth/token`
2. **No scopes in device auth request**: Scopes are apparently inferred from the client_id
3. **HTTP status codes for pending**: Uses HTTP 403 instead of the standard `authorization_pending` error response
4. **Server-generated PKCE**: The code_verifier comes FROM the server in the polling response, rather than being generated by the client (unusual but necessary since the device flow doesn't have a redirect)

---

## Animus Proxy Architecture

### Flow Diagram

```
┌──────────┐     ┌──────────┐     ┌──────────────────┐     ┌──────────────┐
│ Frontend  │     │ Backend  │     │ auth.openai.com  │     │ User Browser │
│ (React)   │     │ (Fastify)│     │                  │     │ (separate)   │
└─────┬─────┘     └─────┬────┘     └────────┬─────────┘     └──────┬───────┘
      │                  │                    │                      │
      │ 1. initiate      │                    │                      │
      │ codexAuth ───────>│                    │                      │
      │                  │ 2. POST /deviceauth/usercode              │
      │                  │───────────────────>│                      │
      │                  │ 3. {device_auth_id,│                      │
      │                  │    user_code,       │                      │
      │  4. {userCode,   │    interval}        │                      │
      │     verifyUrl} <──│<───────────────────│                      │
      │                  │                    │                      │
      │ [Display code    │                    │                      │
      │  and URL to user]│                    │  5. User visits URL  │
      │                  │                    │<─────────────────────│
      │                  │                    │  6. User enters code │
      │                  │                    │<─────────────────────│
      │                  │                    │  7. User authorizes  │
      │                  │                    │<─────────────────────│
      │                  │                    │                      │
      │                  │ 8. Poll /deviceauth/token (every 5s)     │
      │                  │───────────────────>│                      │
      │                  │ 9. 403 (pending)   │                      │
      │                  │<───────────────────│                      │
      │                  │    ... repeat ...   │                      │
      │                  │───────────────────>│                      │
      │                  │ 10. 200 {auth_code,│                      │
      │                  │     code_verifier}  │                      │
      │                  │<───────────────────│                      │
      │                  │                    │                      │
      │                  │ 11. POST /oauth/token                    │
      │                  │    (exchange auth code)                   │
      │                  │───────────────────>│                      │
      │                  │ 12. {access_token, │                      │
      │                  │     refresh_token}  │                      │
      │                  │<───────────────────│                      │
      │                  │                    │                      │
      │ 13. {status:     │ [Encrypt & store   │                      │
      │     "success"}  <──│  in system.db]    │                      │
      │                  │                    │                      │
```

### tRPC Procedures

#### `codexAuth.initiate` (Mutation)

Starts the device code flow. Returns the user code and verification URL.

```typescript
// Input: none
// Output:
interface InitiateResponse {
  userCode: string;        // e.g., "ABCD-EFGH"
  verificationUrl: string; // "https://auth.openai.com/codex/device"
  expiresIn: number;       // 900 (seconds)
  sessionId: string;       // Internal tracking ID
}
```

**Backend logic**:
1. POST to `/api/accounts/deviceauth/usercode` with client_id
2. Store `device_auth_id`, `user_code`, `interval` in memory (or a short-lived DB row)
3. Start background polling loop
4. Return user code and URL to frontend

#### `codexAuth.status` (Subscription)

Real-time status updates via WebSocket subscription.

```typescript
// Input: { sessionId: string }
// Output (streamed):
type AuthStatus =
  | { status: 'pending'; elapsed: number }
  | { status: 'success' }
  | { status: 'error'; message: string }
  | { status: 'expired' }
```

**Backend logic**:
- Emits `pending` status on each poll cycle
- Emits `success` when token exchange completes
- Emits `error` on failures (404 = not enabled, network errors)
- Emits `expired` after 15 minutes

#### `codexAuth.cancel` (Mutation)

Cancels an in-progress authentication.

```typescript
// Input: { sessionId: string }
// Output: { cancelled: boolean }
```

#### `codexAuth.checkStatus` (Query)

Check if Codex OAuth credentials are already stored.

```typescript
// Input: none
// Output:
interface CredentialStatus {
  authenticated: boolean;
  expiresAt: string | null;    // ISO 8601
  accountId: string | null;    // ChatGPT account ID from JWT
  needsRefresh: boolean;
}
```

#### `codexAuth.logout` (Mutation)

Remove stored Codex credentials.

```typescript
// Input: none
// Output: { success: boolean }
```

### Frontend UX

#### Settings > Agents > Codex section

**Not authenticated state**:
```
┌─────────────────────────────────────────────┐
│  Codex Authentication                       │
│                                             │
│  Sign in with your ChatGPT account to use   │
│  Codex models with your subscription.       │
│                                             │
│  [Sign in with ChatGPT]                     │
│                                             │
│  ℹ You must enable "Device code             │
│    authentication" in your ChatGPT          │
│    security settings first.                 │
└─────────────────────────────────────────────┘
```

**Awaiting authorization state**:
```
┌─────────────────────────────────────────────┐
│  Codex Authentication                       │
│                                             │
│  1. Open this link in your browser:         │
│     https://auth.openai.com/codex/device    │
│                                             │
│  2. Enter this code:                        │
│     ┌─────────────────┐                     │
│     │   ABCD-EFGH     │  [Copy]             │
│     └─────────────────┘                     │
│                                             │
│  Waiting for authorization...  ◠            │
│  Expires in 14:32                           │
│                                             │
│  [Cancel]                                   │
└─────────────────────────────────────────────┘
```

**Authenticated state**:
```
┌─────────────────────────────────────────────┐
│  Codex Authentication                 ✓     │
│                                             │
│  Signed in via ChatGPT                      │
│  Token expires: Feb 9, 2026 at 3:00 PM     │
│  (auto-refreshes)                           │
│                                             │
│  [Sign out]                                 │
└─────────────────────────────────────────────┘
```

### Token Storage

Tokens are stored **encrypted** in `system.db`:

```sql
-- In system.db, within the api_keys or a new credentials table
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,          -- 'codex'
  credential_type TEXT NOT NULL,   -- 'oauth'
  encrypted_data TEXT NOT NULL,    -- AES-256-GCM encrypted JSON
  metadata TEXT,                   -- JSON: { accountId, expiresAt }
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

The `encrypted_data` contains the full token set:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "rt_...",
  "id_token": "eyJ...",
  "expires_at": 1738972800000,
  "chatgpt_account_id": "acct_xxx"
}
```

Encryption uses the existing `IEncryptionService` (AES-256-GCM, key from `ANIMUS_ENCRYPTION_KEY`).

### Codex Session Integration

When spawning a Codex SDK session, the backend:

1. Reads encrypted credentials from `system.db`
2. Checks if access token needs refresh (expires within 5 min)
3. If needed, refreshes via `POST /oauth/token` with `grant_type=refresh_token`
4. Writes a temporary `auth.json` to a session-specific directory
5. Sets `CODEX_HOME` env var to that directory when spawning the Codex subprocess
6. Cleans up the temporary directory after the session ends

```typescript
// Pseudo-code for session setup
async function prepareCodexAuth(sessionDir: string): Promise<void> {
  const creds = await getDecryptedCredentials('codex');

  if (shouldRefreshToken(creds.expires_at)) {
    const refreshed = await refreshCodexToken(creds.refresh_token);
    await storeEncryptedCredentials('codex', refreshed);
    creds = refreshed;
  }

  const authJson = {
    auth_mode: 'chatgpt',
    tokens: {
      access_token: creds.access_token,
      refresh_token: creds.refresh_token,
      id_token: creds.id_token,
      expires_at: new Date(creds.expires_at).toISOString(),
    },
    last_refresh: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(sessionDir, 'auth.json'),
    JSON.stringify(authJson),
    { mode: 0o600 }
  );
}
```

### Error Handling

| Error | Cause | Frontend Display |
|-------|-------|-----------------|
| 404 on usercode request | Device code not enabled | "Please enable device code authentication in your ChatGPT security settings" |
| 15-minute timeout | User didn't complete auth | "Authentication timed out. Please try again." |
| 403 on token exchange | Account issue | "Authentication failed. Please check your ChatGPT subscription." |
| Refresh token already used | Race condition / stale token | "Session expired. Please sign in again." |
| Network error | Connectivity | "Could not reach OpenAI authentication servers." |

---

## Implementation Plan

### Phase 1: Core OAuth Module (backend)

Create `packages/backend/src/auth/codex-oauth.ts`:

```typescript
const OPENAI_AUTH_BASE = 'https://auth.openai.com';
const OPENAI_API_BASE = `${OPENAI_AUTH_BASE}/api/accounts`;
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEVICE_CODE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const VERIFICATION_URL = `${OPENAI_AUTH_BASE}/codex/device`;

interface DeviceCodeSession {
  deviceAuthId: string;
  userCode: string;
  interval: number;       // seconds
  startedAt: number;      // Date.now()
  abortController: AbortController;
}

// 1. Request user code
async function requestDeviceCode(): Promise<DeviceCodeSession>

// 2. Poll for authorization code (runs in background)
async function pollForAuthCode(session: DeviceCodeSession): Promise<AuthCodeResult>

// 3. Exchange authorization code for tokens
async function exchangeCodeForTokens(authCode: string, codeVerifier: string): Promise<OAuthTokens>

// 4. Refresh access token
async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens>

// 5. Extract account ID from JWT
function extractAccountId(accessToken: string): string
```

### Phase 2: Credential Storage (backend)

Add to `packages/backend/src/db/stores/system-store.ts`:
- `storeCodexCredentials(tokens: EncryptedTokens): void`
- `getCodexCredentials(): DecryptedTokens | null`
- `deleteCodexCredentials(): void`

### Phase 3: tRPC Router (backend)

Create `packages/backend/src/api/routers/codex-auth.ts`:
- `codexAuth.initiate` -- mutation
- `codexAuth.status` -- subscription
- `codexAuth.cancel` -- mutation
- `codexAuth.checkStatus` -- query
- `codexAuth.logout` -- mutation

### Phase 4: Frontend (settings page)

Add Codex authentication section to settings UI with the three states shown above.

### Phase 5: Session Integration

Update the Codex adapter in `@animus-labs/agents` to:
- Check for stored credentials before session creation
- Write temporary auth.json for each session
- Handle token refresh transparently
- Clean up temporary files

---

## References

- [OpenAI Codex Auth Docs](https://developers.openai.com/codex/auth/)
- [Codex CLI Source: device_code_auth.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs)
- [OpenCode Codex Auth Plugin (TypeScript reference)](https://github.com/numman-ali/opencode-openai-codex-auth)
- [OpenCode Device Auth (TypeScript reference)](https://github.com/tumf/opencode-openai-device-auth)
- [OpenCode Issue #3281: Enable User Sign-in with Codex ChatGPT Accounts via OAuth](https://github.com/anomalyco/opencode/issues/3281)
- [Codex Issue #2798: Support remote/headless OAuth sign-in](https://github.com/openai/codex/issues/2798)
- [Codex Issue #3820: Enable headless authentication](https://github.com/openai/codex/issues/3820)
- [Codex Issue #9253: Device code auth workspace admin requirement](https://github.com/openai/codex/issues/9253)
- [Codex Issue #9634: Refresh token already used](https://github.com/openai/codex/issues/9634)
- [RFC 8628: OAuth 2.0 Device Authorization Grant](https://tools.ietf.org/html/rfc8628)
