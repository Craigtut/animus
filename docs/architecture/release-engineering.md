# Release Engineering

How Animus versions, builds, and ships desktop applications.

## Versioning Policy

### Lockstep Packages

These packages share the same version as the Tauri desktop app. They are internal, not published to npm independently, and bump together on every release:

| File | Format |
|------|--------|
| `package.json` (root) | `"version": "X.Y.Z"` |
| `packages/tauri/tauri.conf.json` | `"version": "X.Y.Z"` |
| `packages/tauri/Cargo.toml` | `version = "X.Y.Z"` |
| `packages/tts-native/Cargo.toml` | `version = "X.Y.Z"` |
| `packages/backend/package.json` | `"version": "X.Y.Z"` |
| `packages/frontend/package.json` | `"version": "X.Y.Z"` |
| `packages/agents/package.json` | `"version": "X.Y.Z"` |
| `packages/tts-native/package.json` | `"version": "X.Y.Z"` |

### Independent Packages

These have external consumers and version on their own schedule:

| Package | Purpose | Tag format |
|---------|---------|-----------|
| `@animus-labs/shared` | Types/schemas consumed by extensions | `shared-vX.Y.Z` |
| `@animus-labs/channel-sdk` | Types consumed by channel adapters | `channel-sdk-vX.Y.Z` |
| `anipack` | CLI packaging tool | `anipack-vX.Y.Z` |

### Semantic Versioning

While pre-1.0 (`0.x.y`):
- MINOR bump = new features or breaking changes
- PATCH bump = bug fixes and non-breaking improvements

After 1.0:
- MAJOR = breaking changes
- MINOR = new features (backwards compatible)
- PATCH = bug fixes

## Conventional Commits

All commits use the [Conventional Commits](https://www.conventionalcommits.org/) format. This enables automatic changelog generation.

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `style`

Scopes: `heartbeat`, `memory`, `agents`, `channels`, `plugins`, `contacts`, `goals`, `tasks`, `persona`, `frontend`, `backend`, `shared`, `tauri`, `api`, `db`, `auth`, `ci`, `release`

Multiple agents working in parallel on main will produce interleaved commits. This is expected and intentional. The changelog generator groups commits by type/scope, so the output is clean regardless of commit order.

## Scripts

### `npm run bump -- <patch|minor|major|X.Y.Z>`

Updates all 8 lockstep files. Supports `--dry-run`.

```bash
npm run bump -- --dry-run patch   # Preview changes
npm run bump -- minor             # 0.1.0 -> 0.2.0
npm run bump -- 1.0.0             # Explicit version
```

### `npm run release -- <patch|minor|major|X.Y.Z>`

Full release orchestration:

1. Verifies clean working directory and `main` branch
2. Bumps all lockstep versions
3. Generates changelog from conventional commits
4. Commits: `chore(release): vX.Y.Z`
5. Creates annotated tag: `vX.Y.Z`
6. Prints push instructions (does NOT auto-push)

```bash
npm run release -- patch
# Then: git push && git push origin v0.1.1
```

## CI Pipeline

### Continuous Integration (`.github/workflows/ci.yml`)

Runs on every push to `main` and on pull requests:
- Typecheck (`npm run typecheck`)
- Lint (`npm run lint`)
- Test (`npm run test:run`)

Uses `ubuntu-latest` with Node.js 24. Concurrent runs are cancelled when new commits are pushed.

### Release Build (`.github/workflows/release.yml`)

Triggered by pushing a tag matching `v*`. Runs two independent jobs in parallel: desktop app builds and Docker image builds.

#### Desktop Builds (`build-tauri`)

Builds the Tauri desktop app for three targets:

| Runner | Target | Notes |
|--------|--------|-------|
| `macos-latest` | `aarch64-apple-darwin` | Apple Silicon, native build |
| `macos-latest` | `x86_64-apple-darwin` | Intel Mac, cross-compiled on ARM runner |
| `windows-latest` | `x86_64-pc-windows-msvc` | Windows 64-bit |

Each job:
1. Checks out the tagged commit
2. Sets up Node.js 24 and Rust stable
3. Runs `npm ci`, `npm run build:prod`, `npm run prepare:tauri`
4. Builds via `tauri-apps/tauri-action@v0`
5. Uploads artifacts to a **draft** GitHub Release

The release is created as a draft so the maintainer can review artifacts, edit release notes, and publish manually.

#### Docker Image (`build-docker`)

Builds a multi-architecture Docker image and pushes to GitHub Container Registry (GHCR).

| Platform | Architecture |
|----------|-------------|
| `linux/amd64` | x86_64 servers, most cloud VMs |
| `linux/arm64` | ARM servers, Raspberry Pi, Apple Silicon VMs |

The job uses the standard Docker GitHub Actions toolkit:
1. `docker/setup-qemu-action` enables cross-platform builds via emulation
2. `docker/setup-buildx-action` creates a BuildKit builder with multi-arch support
3. `docker/login-action` authenticates to GHCR using the built-in `GITHUB_TOKEN`
4. `docker/metadata-action` generates tags from the Git tag (see tagging below)
5. `docker/build-push-action` builds and pushes with GitHub Actions layer caching

**Tagging strategy:**

| Tag pattern | Example | Purpose |
|-------------|---------|---------|
| `{{version}}` | `0.2.4` | Exact version pin |
| `{{major}}.{{minor}}` | `0.2` | Latest patch within a minor version |
| `sha-{{sha}}` | `sha-a04b872` | Immutable commit reference |

The `v` prefix from Git tags is stripped automatically (Docker convention). No `latest` tag is published; users should pin to a specific version.

**Pull the image:**

```bash
docker pull ghcr.io/craigtut/animus:0.2.4
```

**SDK licensing note:** The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) has a proprietary license and is excluded from the published Docker image. On first container startup, the SDK manager installs it at runtime via npm into the `/app/data/sdks/claude/` directory (persisted on the data volume). This is the same mechanism used by the desktop app.

### Cross-compilation

The macOS Intel build runs on an ARM runner. The `TAURI_TARGET_ARCH` environment variable tells `prepare-tauri.mjs` to download the x64 Node.js binary and keep x64 platform binaries (instead of defaulting to the host's arm64).

`TAURI_TARGET_PLATFORM` is also supported for future use but not currently needed since macOS targets build on macOS runners and Windows targets build on Windows runners.

## How to Cut a Release

1. Ensure `main` is clean and CI is passing
2. Run the release script:
   ```bash
   npm run release -- patch   # or minor, major, X.Y.Z
   ```
3. Review the generated `CHANGELOG.md` entry
4. Push:
   ```bash
   git push && git push origin vX.Y.Z
   ```
5. Wait for GitHub Actions to build all platforms (~15-20 min first run, faster with cache)
6. The Docker image is pushed to GHCR immediately (registries have no draft concept)
7. Go to GitHub Releases, review the draft, edit release notes if needed
8. Publish the release

## Code Signing (Future)

Currently, releases are unsigned:
- **macOS**: Users must right-click > Open to bypass Gatekeeper ("unidentified developer" warning)
- **Windows**: SmartScreen may warn about the installer

When ready to sign:
- macOS: Add Apple Developer ID certificate as GitHub Secrets, configure in `tauri.conf.json`
- Windows: Add Authenticode certificate as GitHub Secrets, configure signing in workflow

## Auto-Update Signing

Animus uses Tauri v2's built-in auto-updater to deliver updates to desktop installations. The updater checks for new versions by fetching a JSON manifest from GitHub Releases and verifies update integrity using Ed25519 signatures.

### How It Works

On each release build, `tauri-action` generates a `latest.json` manifest containing download URLs and Ed25519 signatures for each platform artifact. The app fetches this manifest from:

```
https://github.com/Craigtut/animus/releases/latest/download/latest.json
```

When an update is available, the app downloads the new version, verifies its Ed25519 signature against the public key embedded in `tauri.conf.json`, and installs it.

### Signing Keypair Setup (One-Time)

Generate the Ed25519 keypair:

```bash
npx tauri signer generate -w ~/.animus/keys/tauri-update.key
```

This creates two files: `~/.animus/keys/tauri-update.key` (private) and `~/.animus/keys/tauri-update.key.pub` (public). This keeps the Tauri update signing key alongside the existing plugin signing keys in `~/.animus/keys/`.

Configure the keys:

| Key | Where it goes |
|-----|---------------|
| Public key (`tauri-update.key.pub` contents) | `packages/tauri/tauri.conf.json` under `plugins.updater.pubkey` |
| Private key (`tauri-update.key` contents) | GitHub repo secret: `TAURI_SIGNING_PRIVATE_KEY` |
| Password (if set during generation) | GitHub repo secret: `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |

**CRITICAL**: Back up the private key securely. If lost, existing installations cannot verify updates from a new keypair and will be unable to auto-update.

### Update Lifecycle

1. The app checks for updates on launch, every 24 hours, and on manual trigger via the tray menu
2. If an update is found, it downloads silently in the background
3. The user is notified via an in-app toast with "Restart Now" / "Later" options
4. Users can disable auto-updates in Settings
5. On Windows, the installer uses "passive" mode (brief progress bar, no user interaction required)

### CI Integration

The release workflow (`release.yml`) passes `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as environment variables to `tauri-action`. The action automatically signs each platform artifact and generates the `latest.json` manifest with the corresponding signatures.

### Ed25519 vs. Apple Code Signing

These are two separate signing systems that serve different purposes:

| Signing type | Purpose | Required for |
|--------------|---------|-------------|
| Ed25519 (Tauri updater) | Verifies update integrity before installation | Auto-updates to work |
| Apple Developer ID | Satisfies Gatekeeper and notarization requirements | macOS distribution without security warnings |

Both are needed for a fully signed macOS release. Windows requires Ed25519 for updates and (optionally) Authenticode for SmartScreen trust.

## Independent Package Releases

For `@animus-labs/shared` and `@animus-labs/channel-sdk`:

1. Bump the version in the package's `package.json`
2. Update its changelog (if maintained separately)
3. Commit: `chore(shared): release v0.2.0`
4. Tag: `shared-v0.2.0`
5. Publish: `npm publish -w @animus-labs/shared`

These are manual for now. A dedicated workflow can be added when the publish cadence warrants it.
