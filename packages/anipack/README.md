# anipack

CLI tool for building, validating, signing, and inspecting `.anpk` packages for the Animus Engine.

`.anpk` is the distribution format for Animus plugins and channels — a signed ZIP archive containing a unified manifest, checksums, and all runtime files needed to install an extension.

## Installation

```bash
npm install -g anipack
```

Or run directly with npx:

```bash
npx anipack <command>
```

### Development (from the monorepo)

```bash
npm install
npm run build -w anipack
npm link -w anipack
anipack <command>
```

## Commands

### `anipack validate <directory>`

Validate a plugin or channel source directory without building.

Checks:
- Manifest exists (`plugin.json` or `channel.json`) and parses against the Zod schema
- Icon file exists (SVG or PNG) — required for distribution
- Config schema file is valid JSON (if referenced)
- Plugin component paths exist (skills, tools, context, hooks, decisions, triggers, agents)
- Channel adapter file exists
- Permissions summary

```bash
anipack validate ./plugins/weather

# Output:
#   Manifest:       plugin.json found
#   Package type:   plugin
#   Name:           weather
#   Version:        1.0.0
#   Icon:           ./icon.svg (SVG, valid)
#   Components:
#     skills:       ./skills/
#     tools:        none
#   Permissions:    network: unrestricted, fs: none
#
#   Validation passed.
```

### `anipack build <directory>`

Build an `.anpk` package from a plugin or channel source directory.

**Pipeline steps:**
1. Validate the source directory
2. Normalize the manifest (`plugin.json`/`channel.json` → unified `manifest.json`)
3. Compile TypeScript (if `tsconfig.json` exists)
4. Vendor production dependencies (`node_modules`)
5. Collect files into a staging directory (respects `.anipackignore`)
6. Generate SHA-256 checksums (`CHECKSUMS` file)
7. Create ZIP archive (`.anpk`)
8. Sign (if `--sign` flag provided)

```bash
# Basic build
anipack build ./plugins/weather

# Custom output path
anipack build ./plugins/weather --output ./dist/weather.anpk

# Build and sign in one step
anipack build ./channels/discord --sign --key ~/.animus/keys/animus-private.pem

# Skip vendoring (useful for plugins with no dependencies)
anipack build ./plugins/weather --no-vendor

# Skip TypeScript compilation
anipack build ./plugins/weather --no-compile

# Verbose output
anipack build ./plugins/weather -v
```

**Output:**
```
Building from ./plugins/weather...
  Validating manifest...  done
  Source:         /path/to/plugins/weather
  Type:           plugin
  Version:        1.0.0

  Collecting files...     3 files
  Computing checksums...  done
  Creating archive...     done

  Output:         ./weather-1.0.0.anpk
  Size:           2.1 KB
  Files:          3
  Signed:         no
  SHA-256:        fe2ba360...

  Build complete in 0.0s.
```

**File exclusions:** The following are excluded by default:
- Development files: `.git/`, `test/`, `__tests__/`, `tsconfig.json`, `*.config.*`
- Source manifests: `plugin.json`, `channel.json` (replaced by unified `manifest.json`)
- Environment files: `.env`, `.env.local`, `.env.production`
- Meta files: `README.md`, `CONTRIBUTING.md`, `.gitignore`, `package-lock.json`

Create a `.anipackignore` file (same syntax as `.gitignore`) to add custom exclusions.

### `anipack sign <package.anpk>`

Sign an existing `.anpk` package with an Ed25519 private key. Adds a `SIGNATURE` file to the archive containing the cryptographic signature, signer identity, and timestamp.

```bash
# Sign with a key file
anipack sign weather-1.0.0.anpk --key ~/.animus/keys/animus-private.pem

# Custom signer identity
anipack sign weather-1.0.0.anpk --key ./private.pem --signer "my-org"

# Key can also be provided as base64 (useful in CI)
anipack sign weather-1.0.0.anpk --key "base64:MC4CAQ..."
```

**Environment variable:** Set `ANIPACK_SIGNING_KEY` to avoid passing `--key` every time:

```bash
export ANIPACK_SIGNING_KEY=~/.animus/keys/animus-private.pem
anipack build ./plugins/weather --sign
```

### `anipack inspect <package.anpk>`

Inspect an `.anpk` package without installing. Shows manifest details, verifies the signature and checksums, and lists permissions.

```bash
anipack inspect weather-1.0.0.anpk
```

**Output:**
```
Inspecting weather-1.0.0.anpk...

  Package Type:   plugin
  Name:           weather
  Display Name:   Weather
  Version:        1.0.0
  Description:    Get current weather and forecasts...
  Author:         animus-community
  License:        MIT
  Format Version: 1

  Signature:
    Status:       VALID
    Signed by:    my-org
    Signed at:    2026-02-23T02:44:47.588Z

  Checksums:
    Status:       3/3 files verified

  Permissions:
    Network:      unrestricted
    Filesystem:   none
    Contacts:     no
    Memory:       none

  Components:
    skills:       ./skills/
    tools:        none

  Files (5):
    CHECKSUMS     (263 B)
    SIGNATURE     (395 B)
    icon.svg      (686 B)
    manifest.json (569 B)
    skills/weather/SKILL.md (1.0 KB)

  Archive Size:   2.5 KB
```

**Options:**

```bash
# Output as JSON (for scripting)
anipack inspect weather.anpk --json

# Show full file listing with sizes (for large packages)
anipack inspect discord.anpk --files

# Print the raw manifest.json
anipack inspect weather.anpk --manifest

# Only verify signature and checksums (exit code 0/1)
anipack inspect weather.anpk --verify-only
```

### `anipack keygen`

Generate an Ed25519 keypair for package signing.

```bash
# Generate to ./keys/ directory
anipack keygen

# Custom output directory
anipack keygen --output ~/.animus/keys

# Print keys to stdout (for piping)
anipack keygen --stdout
```

**Output files:**
- `animus-private.pem` — Private key (mode `0600`, keep secure)
- `animus-public.pem` — Public key (embed in engine source)

## Package Format (.anpk)

An `.anpk` file is a ZIP archive with this structure:

```
weather-1.0.0.anpk (ZIP)
├── manifest.json       # Unified package manifest (required)
├── CHECKSUMS           # SHA-256 hashes for all files (required)
├── SIGNATURE           # Ed25519 signature (optional)
├── icon.svg            # Package icon (required)
├── skills/             # Plugin components
│   └── weather/
│       └── SKILL.md
└── node_modules/       # Vendored dependencies (if any)
```

### manifest.json

The unified manifest is a superset of `plugin.json` and `channel.json`, with a `packageType` discriminator:

```json
{
  "formatVersion": 1,
  "packageType": "plugin",
  "name": "weather",
  "displayName": "Weather",
  "version": "1.0.0",
  "description": "...",
  "author": { "name": "animus-community" },
  "icon": "./icon.svg",
  "permissions": { "network": true },
  "components": { "skills": "./skills/" },
  "distribution": {
    "buildDate": "2026-02-23T...",
    "buildTool": "anipack/0.1.0"
  }
}
```

### CHECKSUMS

Each line: `sha256:<hex-digest> <relative-path>`

```
sha256:a1b2c3... icon.svg
sha256:d4e5f6... manifest.json
sha256:789abc... skills/weather/SKILL.md
```

### SIGNATURE

JSON file with Ed25519 signature:

```json
{
  "formatVersion": 1,
  "algorithm": "ed25519",
  "publicKey": "<base64-encoded-public-key>",
  "signature": "<base64-encoded-signature>",
  "payload": "sha256:<archive-hash>",
  "signedAt": "2026-02-23T...",
  "signedBy": "my-org"
}
```

## Security Model

The `.anpk` format uses a 4-layer verification chain:

1. **Format check** -- Valid ZIP with `manifest.json` and `CHECKSUMS` at root
2. **Signature verification** -- Ed25519 signature verified at install time
3. **Manifest validation** -- Parsed and validated against the package schema
4. **Checksum verification** -- SHA-256 of every file checked against `CHECKSUMS`

## CI/CD Usage

```yaml
# GitHub Actions example
- name: Build and sign package
  run: |
    npx anipack build ./plugins/weather \
      --sign \
      --key "base64:${{ secrets.SIGNING_KEY }}" \
      --signer "your-org-name" \
      --output ./dist/weather.anpk

- name: Verify package
  run: npx anipack inspect ./dist/weather.anpk --verify-only
```
