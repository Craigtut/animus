# Runtime SDK Installation Architecture

> **Status**: Planned
> **Created**: 2026-03-07
> **Affects**: Tauri desktop app, Docker image, prepare-tauri.mjs, Claude adapter, frontend onboarding

## Problem

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) and the Claude Code CLI it wraps are proprietary software. Anthropic's license states: "You must not redistribute the software without permission." The Codex SDK (`@openai/codex-sdk`) is Apache-2.0 and has no such restriction.

Currently, the Tauri desktop app bundles the Claude Agent SDK inside `resources/node_modules/` as part of the production build. This constitutes redistribution of proprietary software in the built `.dmg` and `.msi` installers. The Docker image has the same issue if published as a pre-built image.

### What's Allowed

- **Using the SDK as a dependency** (end users install from npm): permitted under Anthropic's Commercial Terms
- **Bundling/redistributing the SDK** inside a distributed application: not permitted without explicit permission
- **Codex SDK bundling**: fully permitted (Apache-2.0)

## Solution: Runtime Installation

Instead of bundling the Claude Agent SDK at build time, install it at runtime on the user's machine the first time they launch the app. The user installs the SDK themselves from the official npm registry onto their own machine; we provide the tooling to make this seamless.

### Why This Works Legally

- The SDK is never included in our distributed application bundle
- The npm registry serves the package directly to the end user
- This is functionally identical to a user running `npm install` in their terminal
- This is the intended use case that Anthropic's Commercial Terms permit

## Architecture

### Build-Time Changes

#### 1. Bundle npm alongside Node.js (`prepare-tauri.mjs`)

The `downloadNodeBinary()` function currently extracts only the `node` binary from the Node.js tarball (line 119: `tar -xf ... "bin/node"`). Expand this to also extract:

- `bin/npm` (symlink/script)
- `bin/npx` (symlink/script)
- `lib/node_modules/npm/` (the npm package itself, ~10-15MB)

These are already present in the official Node.js distribution tarball. No additional download needed.

#### 2. Exclude Claude Agent SDK from bundle (`prepare-tauri.mjs`)

In the `writeResourcePackageJson()` step, remove `@anthropic-ai/claude-agent-sdk` from the dependencies written to `resources/package.json`. This prevents it from being installed during `npm install --omit=dev` in the resources directory.

The verification step (step 10) should be updated to no longer check for `resources/node_modules/@anthropic-ai/claude-agent-sdk/cli.js`.

#### 3. Codex SDK stays bundled

No changes needed for `@openai/codex-sdk`. Apache-2.0 permits redistribution.

### Runtime Installation Flow

#### SDK Manager Service (new: `packages/backend/src/services/sdk-manager.ts`)

A new backend service responsible for runtime SDK installation and version management.

```typescript
interface SdkInstallStatus {
  installed: boolean;
  version: string | null;
  installPath: string;
  installing: boolean;
  progress: number;      // 0-100
  error: string | null;
}

interface SdkManager {
  getStatus(sdk: 'claude-agent-sdk'): SdkInstallStatus;
  install(sdk: 'claude-agent-sdk', version?: string): AsyncGenerator<SdkInstallProgress>;
  uninstall(sdk: 'claude-agent-sdk'): Promise<void>;
  getInstallPath(sdk: 'claude-agent-sdk'): string;
}
```

**Install location**: `data/sdks/claude/` (inside the user's data directory, which is already gitignored and backed up with `.animus` archives).

**Install mechanism**: Spawn the bundled npm binary:

```typescript
const npmPath = resolveNpmBinary(); // From bundled Node.js distribution
await execAsync(`${npmPath} install @anthropic-ai/claude-agent-sdk@^0.1.29 --no-fund --no-audit`, {
  cwd: path.join(dataDir, 'sdks', 'claude'),
  env: { ...process.env, PATH: `${nodeBinDir}:${process.env.PATH}` }
});
```

**Version pinning**: The target SDK version should be stored in a config constant, not hardcoded in multiple places. The version constraint should use a caret range (`^0.1.29`) to allow compatible patch updates while preventing unexpected breaking changes.

#### Claude Adapter Changes (`packages/agents/src/adapters/claude.ts`)

The `loadSDK()` method (line 357) currently does:

```typescript
const module = await import('@anthropic-ai/claude-agent-sdk');
```

This needs to resolve from the runtime install path when the SDK isn't in the standard `node_modules`:

```typescript
private async loadSDK(): Promise<ClaudeSDK> {
  if (this.sdk) return this.sdk;

  try {
    // Try standard node_modules first (works in dev, Docker with npm install)
    const module = await import('@anthropic-ai/claude-agent-sdk');
    this.sdk = module as unknown as ClaudeSDK;
    return this.sdk;
  } catch {
    // Fall back to runtime install path (Tauri production)
    const runtimePath = this.getRuntimeSdkPath();
    if (!runtimePath) {
      throw new AgentError({
        code: 'SDK_NOT_INSTALLED',
        message: 'Claude Agent SDK is not installed. Complete setup to install it.',
        category: 'invalid_input',
        severity: 'fatal',
        provider: 'claude',
      });
    }
    const module = await import(
      pathToFileURL(join(runtimePath, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'index.js')).href
    );
    this.sdk = module as unknown as ClaudeSDK;
    return this.sdk;
  }
}
```

The adapter should accept an optional `sdkPath` in its constructor options so the backend can inject the runtime install path.

#### CLI Paths Update (`packages/backend/src/lib/cli-paths.ts`)

The `resolveClaudeCliPaths()` function uses `createRequire` to find the SDK. It needs a fallback path for the runtime install location:

1. Try `createRequire` resolution (standard `node_modules`)
2. If not found, check `data/sdks/claude/node_modules/@anthropic-ai/claude-agent-sdk/`
3. Cache the result as before

### Frontend: First-Launch Installation Screen

Before the user reaches onboarding, the app checks if required SDKs are installed. If not, it shows a setup/installation screen.

#### Installation Screen Design

A full-screen, minimal loading experience. No progress bar showing exact download percentages. Instead, a simple animated indicator (breathing dot, subtle spinner, or gentle pulse) with rotating text phrases that reflect Animus's personality.

The phrases should:
- Feel warm and personal, not technical
- Reference the idea of preparing, waking up, getting ready
- Never mention specific package names or technical details
- Rotate every few seconds with a gentle crossfade

The screen should feel like Animus is coming to life for the first time, not like a software installer.

#### tRPC Endpoints

```typescript
// Router: sdk
sdkRouter = router({
  // Check installation status
  status: publicProcedure
    .input(z.object({ sdk: z.literal('claude-agent-sdk') }))
    .query(({ input }) => sdkManager.getStatus(input.sdk)),

  // Start installation (returns immediately, emits progress via subscription)
  install: publicProcedure
    .input(z.object({ sdk: z.literal('claude-agent-sdk'), version: z.string().optional() }))
    .mutation(({ input }) => sdkManager.startInstall(input.sdk, input.version)),

  // Real-time installation progress
  onInstallProgress: publicProcedure
    .input(z.object({ sdk: z.literal('claude-agent-sdk') }))
    .subscription(({ input }) => {
      return observable<SdkInstallProgress>((emit) => {
        // Emit progress events
      });
    }),
});
```

### Docker Considerations

For Docker builds, the Claude Agent SDK continues to be installed via `npm install` during image build (the Dockerfile runs `npm install` which pulls it from npm). This is acceptable because:

- The user is building the image themselves (running `docker build`)
- The user's own `npm install` fetches the SDK from the registry
- We are not distributing a pre-built image with the SDK inside

If we ever publish pre-built Docker images, the SDK would need to be excluded from those images and installed at container startup, similar to the Tauri approach.

#### Dockerfile Change

Add a note in the Dockerfile clarifying this distinction:

```dockerfile
# NOTE: npm install fetches the Claude Agent SDK from the npm registry.
# This is a user-initiated install, not redistribution.
# If publishing pre-built images, exclude the SDK and install at runtime.
```

### Dev Mode

No changes. In development, `npm install` in the monorepo root installs the SDK into `node_modules/` as normal. The adapter's `loadSDK()` finds it via the standard `import()` path.

## Migration Path

### For Existing Users

Users upgrading from a version that bundled the SDK to the runtime-install version:

1. On first launch after update, the app detects the SDK is missing from the new bundle
2. The installation screen appears automatically
3. SDK installs to `data/sdks/claude/` (~30 seconds)
4. User continues to onboarding or main app as normal
5. Existing credentials and settings are preserved (stored in `system.db`, not tied to SDK location)

### Rollback

If the runtime install fails (no internet, npm registry down, etc.):

- The app should show a clear error with retry option
- Users can still use Codex (bundled) as an alternative provider
- The error message should suggest checking internet connectivity
- A manual install path should be documented: "Run `npm install @anthropic-ai/claude-agent-sdk` in `<data-dir>/sdks/claude/`"

## SDK Update Strategy

The SDK version should be checked on app startup (not every launch, but periodically):

1. Compare installed version against the target version constant
2. If a newer compatible version is available, install it silently in the background
3. The new version takes effect on the next agent session (not mid-session)
4. Version updates should be logged but not interrupt the user

## File Changes Summary

| File | Change |
|------|--------|
| `scripts/prepare-tauri.mjs` | Extract npm/npx alongside node; exclude Claude SDK from resources |
| `packages/backend/src/services/sdk-manager.ts` | New service for runtime SDK installation |
| `packages/backend/src/lib/cli-paths.ts` | Add fallback resolution for runtime SDK path |
| `packages/agents/src/adapters/claude.ts` | `loadSDK()` fallback to runtime path |
| `packages/backend/src/api/routers/sdk.ts` | New tRPC router for SDK management |
| `packages/frontend/src/pages/Setup.tsx` | New first-launch installation screen |
| `packages/frontend/src/App.tsx` | Route to setup screen when SDK not installed |
| `Dockerfile` | Add clarifying comment (no functional change) |
| `docs/agents/sdk-cli-architecture.md` | Update deployment mode table |

## Security Considerations

- The npm registry is the only download source (no third-party mirrors)
- Package integrity is verified by npm's built-in checksum verification
- The install runs in a sandboxed directory (`data/sdks/`) with no access to system-wide `node_modules`
- No `postinstall` scripts from the SDK should have elevated permissions (the SDK doesn't use postinstall scripts)

## Open Questions

1. **npm bundle size**: Exact size of npm + npx + lib/node_modules/npm/ from the Node.js distribution needs measurement. Estimated 10-15MB.
2. **Offline installs**: Should we support a "bring your own SDK" path where users can manually place the SDK package? (Likely yes, via the standard `node_modules` resolution that `loadSDK()` tries first.)
3. **SDK version drift**: How aggressively should we update the runtime-installed SDK? Conservative (only on app updates) vs. aggressive (check npm registry periodically).
