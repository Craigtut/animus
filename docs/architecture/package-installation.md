# Engine Package Installation

> Architecture document for how the Animus Engine installs, verifies, manages, updates, and rolls back `.anpk` packages. Covers the install flow, rollback capability, update checking, config migration, and the future AI self-install system.

## Overview

The Animus Engine gains a new installation pathway alongside the existing directory-based method: installing from `.anpk` package files. This document specifies how the engine handles the complete lifecycle of packaged plugins and channels — from initial installation through updates and rollback.

### Installation Methods

| Method | Source | Security | Use Case |
|--------|--------|----------|----------|
| **Directory path** (existing) | Local filesystem | Manifest validation + adapter checksum only | Development, local testing |
| **Package file** (new) | `.anpk` uploaded via UI | Full verification (signature + checksums + permissions consent) | Production, manual distribution |
| **Store download** (new) | Animus Store CDN | Full verification + archive checksum from store | Store-based distribution |
| **AI-initiated** (future) | Animus Store via MCP tools | Full verification + explicit user approval | Autonomous capability acquisition |

All methods ultimately register the package in the same database tables (`plugins` or `channel_packages` in `system.db`) and use the same `PluginManager` / `ChannelManager` for lifecycle management.

---

## File System Layout

```
~/.animus/
├── packages/                       # Extracted package contents
│   ├── weather/                    # Plugin: extracted from weather-1.0.0.anpk
│   │   ├── manifest.json
│   │   ├── CHECKSUMS
│   │   ├── icon.svg
│   │   ├── skills/weather/SKILL.md
│   │   └── ...
│   ├── twilio-sms/                 # Channel: extracted from twilio-sms-1.0.0.anpk
│   │   ├── manifest.json
│   │   ├── CHECKSUMS
│   │   ├── adapter.js
│   │   └── ...
│   └── .cache/                     # Cached .anpk files for rollback
│       ├── weather-1.0.0.anpk
│       ├── weather-0.9.0.anpk     # Previous version (for rollback)
│       ├── twilio-sms-1.0.0.anpk
│       └── ...
└── keys/                           # Public keys for signature verification
    └── animus-labs.pub             # Animus Labs Ed25519 public key
```

**Note**: The `~/.animus/keys/` directory holds public keys. The primary Animus Labs public key is also embedded in the engine source code at `packages/shared/src/keys/animus-labs.pub`. The filesystem copy is a fallback and can be updated independently of engine releases (for key rotation scenarios).

---

## Installation Flow

### `installFromPackage(filePath: string, options?: InstallOptions)`

New method added to both `PluginManager` and `ChannelManager`. This is the primary entry point for `.anpk` installation.

```typescript
interface InstallOptions {
  source: 'local' | 'store';           // Where the package came from
  storeChecksum?: string;              // Archive checksum provided by the store
  licenseKey?: string;                 // For paid packages
  skipPermissionsConsent?: boolean;    // For AI-initiated installs (always false in practice)
}
```

### Step-by-Step Flow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: FORMAT VALIDATION                                    │
│                                                              │
│ Input: path to .anpk file                                    │
│                                                              │
│ 1. Verify file exists and is readable                        │
│ 2. Verify file is a valid ZIP archive                        │
│ 3. Verify manifest.json exists at archive root               │
│ 4. Verify CHECKSUMS exists at archive root                   │
│                                                              │
│ Failure → PackageFormatError("Invalid package format: ...")   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: ARCHIVE CHECKSUM (store downloads only)              │
│                                                              │
│ If source === 'store' && storeChecksum provided:             │
│   1. Compute SHA-256 of entire .anpk file                    │
│   2. Compare to storeChecksum                                │
│   3. Mismatch → DownloadIntegrityError                       │
│                                                              │
│ Purpose: Detect corrupted/tampered downloads                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: SIGNATURE VERIFICATION                               │
│                                                              │
│ 1. Check for SIGNATURE file in archive                       │
│    ├── Found:                                                │
│    │   a. Parse SIGNATURE JSON                               │
│    │   b. Load Animus Labs public key                        │
│    │   c. Compute SHA-256 of archive (excluding SIGNATURE)   │
│    │   d. Verify Ed25519 signature                           │
│    │   e. FAIL → SignatureVerificationError                  │
│    │   f. PASS → Record signedBy identity                    │
│    └── Not found:                                            │
│        a. Show warning dialog to user                        │
│        b. "This package is not signed..."                    │
│        c. User must click "Install Anyway" to proceed        │
│        d. Cancel → abort installation                        │
│        e. Record source as 'local'                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: MANIFEST VALIDATION                                  │
│                                                              │
│ 1. Extract manifest.json from archive (without full extract) │
│ 2. Parse JSON                                                │
│ 3. Determine packageType ("plugin" or "channel")             │
│ 4. Validate against appropriate Zod schema:                  │
│    - Plugin: PluginManifestSchema                            │
│    - Channel: channelManifestSchema                          │
│ 5. Check formatVersion is supported (currently: 1)           │
│ 6. Check engineVersion compatibility (if specified)          │
│                                                              │
│ Failure → ManifestValidationError("...")                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: CONFLICT CHECK                                       │
│                                                              │
│ 1. Check if package with this name is already installed      │
│    ├── Same version → AlreadyInstalledError                  │
│    └── Different version → Treat as update (see Update Flow) │
│ 2. For channels: check if channelType is already registered  │
│    └── Conflict → ChannelTypeConflictError                   │
│ 3. For plugins with decision types: check name collisions    │
│                                                              │
│ If treating as update → jump to Update Flow                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 6: LICENSE VALIDATION (paid packages only)              │
│                                                              │
│ If manifest.store.pricing.model === 'paid':                  │
│   1. Check for grandfathering (beta installs)                │
│      └── If previously installed before BETA_END_DATE → skip │
│   2. Prompt user for license key (if not provided)           │
│   3. Validate against Polar.sh API:                          │
│      POST /v1/customer-portal/license-keys/validate          │
│      { key, organization_id }                                │
│   4. Check result.status === 'granted'                       │
│   5. FAIL → LicenseValidationError                           │
│   6. Store license key hash in database (not the key itself) │
│                                                              │
│ If source === 'local' and pricing is paid → warn but allow   │
│ (supports offline / development scenarios)                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 7: PERMISSIONS CONSENT                                  │
│                                                              │
│ 1. Extract permissions from manifest                         │
│ 2. Display consent dialog to user:                           │
│    ┌─────────────────────────────────────────────┐          │
│    │ Install "Weather" v1.0.0?                   │          │
│    │ by Animus Labs (signed)                     │          │
│    │                                             │          │
│    │ This plugin requests:                       │          │
│    │ · Tools: bash                               │          │
│    │ · Network: none                             │          │
│    │ · Filesystem: read-only                     │          │
│    │ · Contacts: no access                       │          │
│    │ · Memory: read-only                         │          │
│    │                                             │          │
│    │ [Cancel]                     [Install]      │          │
│    └─────────────────────────────────────────────┘          │
│ 3. User clicks Install → proceed                            │
│ 4. User clicks Cancel → abort                               │
│ 5. Store consented permissions in database                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 8: EXTRACTION                                           │
│                                                              │
│ 1. Create directory: ~/.animus/packages/{name}/              │
│ 2. Extract all files from archive                            │
│ 3. Exclude SIGNATURE (verification metadata, not runtime)    │
│ 4. Set appropriate file permissions (644 for files, 755 for  │
│    executables like adapter.js and scripts)                   │
│                                                              │
│ Failure → clean up partial extraction, report error          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 9: CHECKSUM VERIFICATION                                │
│                                                              │
│ 1. Read CHECKSUMS from extracted directory                    │
│ 2. For each entry:                                           │
│    a. Compute SHA-256 of the extracted file                   │
│    b. Compare to declared hash                                │
│    c. Mismatch → ChecksumVerificationError                   │
│ 3. Check for unexpected files (not in CHECKSUMS)             │
│    a. Extra files → IntegrityError                           │
│ 4. All pass → proceed                                        │
│                                                              │
│ Failure → delete all extracted files, report error           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 10: REGISTRATION                                        │
│                                                              │
│ 1. Insert into database:                                     │
│    - plugins table (if plugin) or channel_packages (channel) │
│    - path: absolute path to ~/.animus/packages/{name}/       │
│    - source: 'store' or 'local'                              │
│    - version: from manifest                                  │
│    - enabled: false (not yet enabled)                        │
│    - consented_permissions: JSON blob                        │
│ 2. Cache .anpk in ~/.animus/packages/.cache/{name}-{v}.anpk │
│ 3. Emit 'plugin:installed' or 'channel:installed' event      │
│                                                              │
│ Package is now installed but disabled.                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 11: CONFIGURATION                                       │
│                                                              │
│ If configSchema exists with required fields:                  │
│   1. Show configuration form in Settings UI                   │
│   2. User fills in required fields                            │
│   3. Secrets encrypted with AES-256-GCM                      │
│   4. Config stored in database                                │
│   5. Package remains disabled until config is complete         │
│                                                              │
│ If no config needed or config provided:                       │
│   → Proceed to enable                                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 12: ENABLE                                              │
│                                                              │
│ Delegates to existing enable flow:                            │
│   Plugin: PluginManager.enable(name)                         │
│     → Load components, deploy skills, start triggers, etc.   │
│   Channel: ChannelManager.enable(name)                       │
│     → Fork child process with --permission flags              │
│                                                              │
│ Package is now active. Hot-swap: no engine restart needed.    │
└─────────────────────────────────────────────────────────────┘
```

---

## Update Flow

### Update Detection

The engine periodically checks the store for updates to installed packages:

```typescript
class StoreClient {
  private checkInterval: NodeJS.Timer;

  startUpdateChecking(intervalMs: number = 24 * 60 * 60 * 1000) {
    this.checkInterval = setInterval(() => this.checkForUpdates(), intervalMs);
  }

  async checkForUpdates(): Promise<UpdateInfo[]> {
    // Gather all store-installed packages
    const installed = [
      ...pluginManager.getInstalledPlugins().filter(p => p.source === 'store'),
      ...channelManager.getInstalledChannels().filter(c => c.source === 'store'),
    ];

    // Batch check against store API
    const response = await fetch(`${STORE_URL}/api/v1/updates/check`, {
      method: 'POST',
      body: JSON.stringify({
        engineVersion: ENGINE_VERSION,
        installed: installed.map(p => ({ name: p.name, version: p.version })),
      }),
    });

    return response.json().updates;
  }
}
```

**Update check frequency**: Every 24 hours (configurable). The check is lightweight — a single POST request with package names and versions.

### Update Execution

When the user initiates an update:

```
1. Download new .anpk from store CDN
2. Verify archive checksum (from store API)
3. Run full install flow (signature → manifest → permissions)
4. If new permissions requested → show consent dialog for NEW permissions only
5. Disable current version (if enabled)
6. Move current extracted directory to a temporary location
7. Extract new version to ~/.animus/packages/{name}/
8. Verify checksums
9. Migrate configuration (see Config Migration below)
10. Update database record (version, path, checksum)
11. Cache new .anpk in .cache/
12. Keep old .anpk in .cache/ (for rollback)
13. Re-enable with new version
14. If enable fails → rollback to previous version
15. Clean up temporary directory
```

### Config Migration

When a package update changes the config schema:

```typescript
function migrateConfig(
  oldConfig: Record<string, unknown>,
  oldSchema: ConfigSchema,
  newSchema: ConfigSchema,
): { config: Record<string, unknown>; needsInput: ConfigField[] } {
  const result: Record<string, unknown> = {};
  const needsInput: ConfigField[] = [];

  for (const field of newSchema.fields) {
    if (field.key in oldConfig) {
      // Field exists in old config → carry forward
      result[field.key] = oldConfig[field.key];
    } else if (field.required) {
      // New required field → user must provide
      needsInput.push(field);
    } else if (field.default !== undefined) {
      // New optional field with default → use default
      result[field.key] = field.default;
    }
    // New optional field without default → omit (undefined)
  }

  // Fields in oldConfig but NOT in newSchema → silently dropped
  // (they were removed in the new version)

  return { config: result, needsInput };
}
```

**Behavior**:
1. Fields that exist in both old and new schemas → carried forward unchanged
2. New required fields → user prompted to fill them before the update completes
3. New optional fields with defaults → defaults applied automatically
4. New optional fields without defaults → omitted
5. Removed fields → silently dropped (no user action needed)

If the user is prompted for new required fields and cancels → update aborts, old version remains active.

---

## Rollback Flow

### How Rollback Works

Previous `.anpk` files are cached in `~/.animus/packages/.cache/`. Rollback re-installs from cache.

```
1. User clicks "Rollback" in Settings (or via tRPC API)
2. Engine finds previous version in .cache/:
   ~/.animus/packages/.cache/{name}-{previousVersion}.anpk
3. Disable current version
4. Delete current extracted directory
5. Re-run install flow from cached .anpk (skip permissions consent — already granted)
6. Re-apply existing config (no migration needed — reverting to known-good schema)
7. Re-enable
8. Update database record to previous version
9. Remove the rolled-back-from version's .anpk from cache (optional)
```

### Cache Management

```typescript
interface PackageCachePolicy {
  maxVersionsPerPackage: 2;    // Keep current + previous
  maxCacheSizeMB: 500;         // Total cache size limit
  cleanupOnUninstall: true;    // Remove cache when package uninstalled
}
```

**Cache cleanup rules**:
- Keep at most 2 versions per package (current + rollback target)
- When a third version is installed, delete the oldest cached version
- Total cache size capped at 500 MB (configurable)
- When a package is uninstalled, its cached `.anpk` files are also deleted
- Users can manually clear the cache via Settings

### Database Tracking

```sql
-- New columns added to plugins / channel_packages tables
previous_version TEXT,           -- Version rolled back from (null if no rollback available)
cached_versions TEXT,            -- JSON array of cached version strings
```

### UI Presentation

In Settings, packages with a rollback available show:

```
┌──────────────────────────────────────────────────────┐
│ [icon] Weather                          v1.1.0       │
│        Get current weather and forecasts             │
│                                                      │
│ [Disable]  [Configure]  [Rollback to v1.0.0]  [×]  │
└──────────────────────────────────────────────────────┘
```

The "Rollback" button only appears when a previous version exists in cache.

---

## Store Browser Integration

### Settings UI Changes

The Settings page gains a new section for browsing the store:

```
Settings
├── General
├── Persona
├── Channels
│   ├── Installed Channels (existing)
│   └── Browse Store → opens store browser panel
├── Plugins
│   ├── Installed Plugins (existing)
│   └── Browse Store → opens store browser panel
└── About
```

### Store Browser Component

An embedded view within the Settings page that queries the store API:

```typescript
// Frontend: store-browser component
function StoreBrowser({ packageType }: { packageType: 'plugin' | 'channel' }) {
  const [query, setQuery] = useState('');
  const [packages, setPackages] = useState<StorePackage[]>([]);

  // Fetch from engine backend, which proxies to store API
  const { data } = trpc.store.browse.useQuery({ q: query, type: packageType });

  return (
    <div>
      <SearchInput value={query} onChange={setQuery} />
      <PackageGrid packages={data?.packages} onInstall={handleInstall} />
    </div>
  );
}
```

### Engine Backend Proxy

The engine proxies store API requests rather than having the frontend call the store directly. This:
- Adds engine version context to requests
- Handles license key validation server-side
- Manages download and verification in the backend
- Keeps the store URL configurable (for self-hosted stores, future)

```typescript
// Backend tRPC router
export const storeRouter = router({
  browse: publicProcedure
    .input(z.object({ q: z.string().optional(), type: z.string().optional() }))
    .query(async ({ input }) => {
      const response = await storeClient.browse(input);
      return response;
    }),

  install: protectedProcedure
    .input(z.object({ name: z.string(), version: z.string(), licenseKey: z.string().optional() }))
    .mutation(async ({ input }) => {
      // 1. Get download URL from store
      const download = await storeClient.getDownload(input.name, input.version);

      // 2. Download .anpk to temp directory
      const tempPath = await storeClient.downloadPackage(download.url, download.checksum);

      // 3. Install via PluginManager or ChannelManager
      const manifest = await packageInstaller.install(tempPath, {
        source: 'store',
        storeChecksum: download.checksum,
        licenseKey: input.licenseKey,
      });

      return manifest;
    }),

  checkUpdates: publicProcedure
    .query(async () => {
      return storeClient.checkForUpdates();
    }),
});
```

### Update Badges

Installed packages with available updates show a badge:

```
┌──────────────────────────────────────────────────────┐
│ [icon] Weather                          v1.0.0       │
│        Get current weather and forecasts             │
│                                                      │
│ ⬆ Update available: v1.1.0                          │
│   "Added 5-day forecast support"                     │
│                                                      │
│ [Update]  [Disable]  [Configure]                [×] │
└──────────────────────────────────────────────────────┘
```

---

## AI Self-Management (Phase 4)

### MCP Tools

The engine exposes package management capabilities as MCP tools that the agent can invoke:

#### `browse_packages`

```typescript
{
  name: "browse_packages",
  description: "Search the Animus Store for available plugins and channels",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      type: { type: "string", enum: ["plugin", "channel"], description: "Package type filter" }
    }
  }
}
```

**Returns**: List of matching packages with name, description, version, pricing.

#### `install_package`

```typescript
{
  name: "install_package",
  description: "Install a plugin or channel from the Animus Store. Requires user approval.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Package name to install" },
      reason: { type: "string", description: "Why you want to install this package" }
    },
    required: ["name", "reason"]
  }
}
```

**Behavior**: The tool presents the user with an approval dialog that includes the agent's reason for wanting the package, the package permissions, and Install/Cancel buttons. The agent cannot bypass this approval.

#### `uninstall_package`

```typescript
{
  name: "uninstall_package",
  description: "Uninstall a plugin or channel. Requires user approval.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Package name to uninstall" },
      reason: { type: "string", description: "Why you want to uninstall this package" }
    },
    required: ["name", "reason"]
  }
}
```

### Capability Discovery

The agent can proactively suggest packages when it encounters requests it can't fulfill:

```
User: "What's the weather like today?"

Agent thinking: "I don't have weather capabilities. Let me check if there's a package for this."

Agent: "I don't currently have weather capabilities, but I found a Weather plugin
        in the store that would let me check forecasts for you. It's free and only
        needs bash tool access with read-only filesystem permissions.
        Would you like me to install it?"

User: "Sure!"

→ Agent calls install_package(name: "weather", reason: "User asked about weather")
→ Approval dialog shown to user
→ User approves
→ Package downloaded, verified, installed, enabled
→ Next tick: agent has the weather skill available
```

### Safety Constraints

- All AI-initiated installs require explicit user approval via dialog
- The agent cannot modify or bypass the permissions consent flow
- The agent cannot install unsigned packages
- The agent cannot install packages that request permissions beyond what the user has globally configured
- All AI install/uninstall actions are logged to `agent_logs.db`
- The user can disable AI self-management entirely via a Settings toggle

---

## Error Handling

### Error Types

```typescript
class PackageInstallError extends Error {
  constructor(
    message: string,
    public code: PackageErrorCode,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}

enum PackageErrorCode {
  INVALID_FORMAT = 'INVALID_FORMAT',
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  SIGNATURE_MISSING = 'SIGNATURE_MISSING',
  CHECKSUM_MISMATCH = 'CHECKSUM_MISMATCH',
  DOWNLOAD_INTEGRITY = 'DOWNLOAD_INTEGRITY',
  MANIFEST_INVALID = 'MANIFEST_INVALID',
  ENGINE_INCOMPATIBLE = 'ENGINE_INCOMPATIBLE',
  FORMAT_VERSION_UNSUPPORTED = 'FORMAT_VERSION_UNSUPPORTED',
  ALREADY_INSTALLED = 'ALREADY_INSTALLED',
  CHANNEL_TYPE_CONFLICT = 'CHANNEL_TYPE_CONFLICT',
  LICENSE_INVALID = 'LICENSE_INVALID',
  PERMISSIONS_DENIED = 'PERMISSIONS_DENIED',
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  DISK_SPACE = 'DISK_SPACE',
  NETWORK_ERROR = 'NETWORK_ERROR',
}
```

### User-Facing Error Messages

Each error code maps to a clear, actionable message:

| Code | Message |
|------|---------|
| `INVALID_FORMAT` | "This file is not a valid Animus package. Make sure you're uploading a .anpk file." |
| `SIGNATURE_INVALID` | "This package's signature is invalid. It may have been tampered with. Do not install packages from untrusted sources." |
| `CHECKSUM_MISMATCH` | "One or more files in this package have been modified. The package may be corrupted." |
| `ENGINE_INCOMPATIBLE` | "This package requires Animus Engine {version} or later. You're running {currentVersion}. Please update the engine first." |
| `LICENSE_INVALID` | "The license key is invalid or has been revoked. Please check your purchase confirmation for the correct key." |
| `ALREADY_INSTALLED` | "This version of {name} is already installed." |

---

## Database Changes

### New/Modified Columns

```sql
-- plugins table: new columns
ALTER TABLE plugins ADD COLUMN consented_permissions TEXT;    -- JSON permissions blob
ALTER TABLE plugins ADD COLUMN previous_version TEXT;         -- For rollback
ALTER TABLE plugins ADD COLUMN cached_versions TEXT;          -- JSON array of cached versions
ALTER TABLE plugins ADD COLUMN signature_status TEXT;         -- 'signed' | 'unsigned'
ALTER TABLE plugins ADD COLUMN signed_by TEXT;                -- Signer identity
ALTER TABLE plugins ADD COLUMN license_key_hash TEXT;         -- SHA-256 of license key (paid only)
ALTER TABLE plugins ADD COLUMN format_version INTEGER;       -- Package format version

-- channel_packages table: same columns
ALTER TABLE channel_packages ADD COLUMN consented_permissions TEXT;
ALTER TABLE channel_packages ADD COLUMN previous_version TEXT;
ALTER TABLE channel_packages ADD COLUMN cached_versions TEXT;
ALTER TABLE channel_packages ADD COLUMN signature_status TEXT;
ALTER TABLE channel_packages ADD COLUMN signed_by TEXT;
ALTER TABLE channel_packages ADD COLUMN license_key_hash TEXT;
ALTER TABLE channel_packages ADD COLUMN format_version INTEGER;
```

### Source Values

The `source` column gains new values:

| Value | Meaning |
|-------|---------|
| `built-in` | Ships with the engine (existing) |
| `local` | Installed from local directory path (existing) |
| `git` | Cloned from git repo (existing, not yet implemented) |
| `npm` | Installed from npm (existing, not yet implemented) |
| `store` | Downloaded from Animus Store (new) |
| `package` | Installed from uploaded .anpk file (new) |

---

## tRPC API Changes

### New Procedures

```typescript
// Plugin router additions
plugins.installFromPackage: protectedProcedure
  .input(z.object({ filePath: z.string() }))
  .mutation(/* install .anpk from uploaded file */),

plugins.checkUpdates: publicProcedure
  .query(/* check store for updates to installed plugins */),

plugins.update: protectedProcedure
  .input(z.object({ name: z.string(), version: z.string() }))
  .mutation(/* download and install update from store */),

plugins.rollback: protectedProcedure
  .input(z.object({ name: z.string() }))
  .mutation(/* rollback to previous cached version */),

// Channel router additions (same pattern)
channels.installFromPackage: protectedProcedure
  .input(z.object({ filePath: z.string() }))
  .mutation(/* install .anpk from uploaded file */),

channels.checkUpdates: publicProcedure
  .query(/* check store for updates */),

channels.update: protectedProcedure
  .input(z.object({ name: z.string(), version: z.string() }))
  .mutation(/* download and install update */),

channels.rollback: protectedProcedure
  .input(z.object({ name: z.string() }))
  .mutation(/* rollback to previous version */),

// Store router (new)
store.browse: publicProcedure
  .input(z.object({ q: z.string().optional(), type: z.string().optional() }))
  .query(/* proxy browse request to store API */),

store.getPackage: publicProcedure
  .input(z.object({ name: z.string() }))
  .query(/* get package details from store */),

store.install: protectedProcedure
  .input(z.object({ name: z.string(), version: z.string(), licenseKey: z.string().optional() }))
  .mutation(/* download from store and install */),
```

---

## Implementation Notes

### File Upload in Tauri vs. Web

- **Web (browser)**: File input element, file read via FileReader API, uploaded to backend via tRPC mutation
- **Tauri (desktop)**: Native file dialog via `@tauri-apps/api/dialog`, file path passed directly to backend (no upload needed — backend reads from local path)

### Package Extraction Library

Use `yauzl` (async ZIP extraction) or `unzipper` for Node.js. Both handle large archives efficiently without loading the entire file into memory.

### Concurrent Installation

Only one package can be installed at a time (serialized via a mutex in `PluginManager` / `ChannelManager`). This prevents race conditions during file extraction and database registration.

### Disk Space Check

Before extraction, estimate required space (uncompressed size from ZIP headers) and verify sufficient disk space is available. Fail early with a clear `DISK_SPACE` error rather than failing mid-extraction.

---

## Related Documents

- [Plugin System Architecture](plugin-system.md)
- [Channel System Architecture](channel-packages.md)
- [Credential Passing](credential-passing.md)
