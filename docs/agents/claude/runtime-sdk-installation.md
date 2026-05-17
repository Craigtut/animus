# Runtime SDK Installation Architecture

> **Status**: Retired historical reference. Animus production runtime now uses Cortex. The desktop app and Docker image do not bundle npm for SDK installation, do not install the Claude Agent SDK at runtime, and do not include the retired subprocess SDK stack in production artifacts.

## Historical Context

Earlier designs considered installing `@anthropic-ai/claude-agent-sdk` dynamically at runtime to avoid redistributing Anthropic's proprietary SDK inside the desktop bundle. That approach was not retained.

The current product no longer uses the `@animus-labs/agents` subprocess SDK stack as an active runtime component. Cortex is the active provider and agent runtime.

## Current Build Behavior

- Tauri production packaging copies the backend, local runtime workspace packages, speech binaries, and third-party production dependencies needed by Cortex.
- Docker production builds install only the workspaces needed by the runtime image and do not copy or build `packages/agents`.
- The retired Claude Agent SDK, Codex SDK, and OpenCode SDK packages are not part of the production runtime payload.
- There is no backend SDK manager service that installs Claude Agent SDK at startup or first launch.
- There is no first-launch SDK installation screen.

## Source Retention

`packages/agents` remains in the repository as dormant reference code for possible future plugin-style reintroduction. Reintroducing it would require a new architecture review, explicit packaging decisions, and updated licensing analysis.
