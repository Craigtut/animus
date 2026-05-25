# Self-Managed Environment

**STATUS**: Implemented (v1, 2026-05-25). Layers 1–3 landed; Docker reconciliation (phase 6) and the optional Settings surface (phase 7) remain.
**Created**: 2026-05-25
**Supersedes / generalizes**: `docs/research/docker-agent-environment.md` (Docker-only predecessor)
**Problem**: The entity inside Animus cannot reliably find, install, or persist the command-line tooling it needs to do real work, and the failure is platform-specific and silent.

---

## Problem Statement

An agent running inside the **production macOS desktop app** reported that `npm` was installed on the machine but "the shell needs the right PATH": the binary existed, but the entity could not see it. This is not a one-off. It is the visible symptom of a deeper gap: **Animus has no working environment of its own.** It borrows whatever environment the operating system handed the app at launch, and every shell command lives or dies by that snapshot.

The acute failure is the classic macOS GUI-launch PATH problem, but the right fix is not "hardcode Homebrew's path for one developer's machine." The right fix follows from what Animus is.

### Why this is a first-class concern, not a bug fix

Animus is built to *become* over time: it accumulates a self through memory, skills, and lived experience rather than resetting to zero every interaction. A working environment, the tools it has found, installed, and learned where to reach for, is the **system-level analog of memory**. It is the entity's workshop. Right now that workshop is wiped on every launch and never extends. Solving this generically gives the entity the ability to build up its own capability over time and keep it, which is consistent with the product thesis.

### The ideal experience (non-developer owner)

A non-developer asks their Animus to do something that needs tooling. Animus tries, finds the tool missing, and instead of erroring out at the user, it quietly sets up its own toolchain (no admin rights, no Homebrew dependency, installed into its own data directory), records where it put things, and continues. Next week the tool is just there. The owner never thinks about PATH. The entity has built a little more of its workshop, and that capability persists like a memory does.

---

## The Problem Across Platforms

The acute "tool is invisible" failure is **macOS-specific**, but the persistence gap exists everywhere.

| Runtime | Launch environment | Acute "tool invisible" risk | Persistence gap |
|---------|-------------------|------------------------------|-----------------|
| **macOS desktop (Tauri)** | Finder/Dock launch gives a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`). The login shell profile (`.zshrc`/`.zprofile`) is **not** sourced, so Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`) and version managers are absent. | **High** | High |
| **Windows desktop (Tauri)** | GUI apps inherit PATH from the registry (system + user `Environment`), so installer-added tools are usually visible. Gaps: post-login PATH edits aren't seen until re-login; version managers vary. | **Low** | Medium |
| **Docker / Linux** | Fully controlled: we build the image and set PATH. Tools the agent installs at runtime land in the ephemeral container layer and are lost on upgrade. | **None** | High (the original `docker-agent-environment.md` problem) |
| **Dev / standalone (`npm run dev`)** | Inherits the developer's full login-shell PATH. Works today, which is exactly why the desktop bug never reproduces in dev. | **None** | N/A |

Two compounding layers cause the macOS failure specifically:

1. **The Tauri shell hands the Node sidecar a minimal PATH.** `packages/tauri/src/main.rs` (~line 428) reads `std::env::var("PATH")` (minimal under Dock launch), prepends only the *bundled* node directory so the sidecar can find its own node, then passes that to the sidecar via `.env("PATH", &path_env)`. It never adds Homebrew/local bin.
2. **Cortex's bash tool does not recover the PATH either.** `cortex-mono/.../tools/bash/index.ts` (`selectUnixShell()`) always spawns with `['-c']`, a non-login, non-interactive shell, so `.zshrc`/`.zprofile` are never sourced. It then passes a sanitized copy of `process.env` (which carries the minimal PATH forward) to the spawned command.

Chain: Dock launch → minimal PATH → Tauri adds only bundled node → sidecar inherits minimal PATH → Cortex `-c` shell doesn't source the profile → the entity runs commands with a PATH that has no `npm`. The binary genuinely exists; the entity just cannot see it.

---

## Architecture: Three Layers

### Layer 1 — A sane PATH floor (per-platform launch environment)

Seed the launch environment with the standard tool locations so that tools the owner *already has* are visible on day one.

- **macOS (Tauri):** in `main.rs`, after reading the base PATH, prepend the common locations when they exist on disk, gated to macOS:
  ```rust
  #[cfg(target_os = "macos")]
  for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
      if Path::new(dir).exists() && !path_env.split(':').any(|p| p == dir) {
          path_env = format!("{dir}:{path_env}");
      }
  }
  ```
- **Windows:** no floor needed (registry PATH is already inherited).
- **Docker:** the image controls PATH; the floor is the Dockerfile.
- **Dev:** inherits the login shell; nothing to do.

This is a strict improvement and unblocks owners who already have tooling. It does **not** solve the persistence/self-extension goal on its own; that is Layer 2.

> **Hardcoded dirs miss version managers** (nvm, asdf, fnm, Volta) that install under `~/.nvm`, `~/.asdf`, etc. The thorough alternative is to resolve the owner's real PATH once at startup by running their login shell (`$SHELL -lic 'echo $PATH'`, the approach `fix-path-for-shells`/VS Code use) and merge it. More robust, slightly slower startup, must avoid trusting arbitrary profile output. **Decision: do the hardcoded floor now; evaluate login-shell resolution as a Layer-1 enhancement.** Either way, Layer 2 covers the version-manager case because the entity can register those paths itself.

### Layer 2 — A persistent, self-owned environment overlay

The core of the design. Animus gets a persistent environment it owns and extends, stored in its data directory and merged into the process environment at startup. Because Cortex's bash tool rebuilds its sanitized env from `process.env` on **every** command, mutating `process.env` at runtime makes a newly registered path effective for the *very next* command, and persisting it to disk makes it survive restarts.

**Storage** (under the existing `DATA_DIR`; reconciles the reserved `workspace/` dir and the Docker proposal's `agent-env/`):

```
$ANIMUS_DATA_DIR/
  agent-env/
    bin/                 # downloaded/standalone binaries + symlinks
    tools/               # self-contained toolchains (e.g. node, installed sudo-free)
    environment.json     # the overlay manifest (see below)
```

**Overlay manifest** (`environment.json`) — the entity's own "shell profile," declarative and inspectable:

```json
{
  "version": 1,
  "path_additions": ["/opt/homebrew/bin", "${AGENT_ENV}/tools/node/bin"],
  "env_vars": { "FOO_HOME": "${AGENT_ENV}/tools/foo" },
  "tools": {
    "node": { "version": "24.x", "bin": "${AGENT_ENV}/tools/node/bin",
              "source": "https://nodejs.org/dist/...", "sha256": "...",
              "installed_at": "2026-05-25T..." }
  }
}
```

**Lifecycle:**
- **Startup merge:** backend reads `environment.json`, resolves `${AGENT_ENV}`, and merges `path_additions` into `process.env.PATH` (de-duplicated, cross-platform separator via `node:path`) and `env_vars` into `process.env` (subject to the denylist below).
- **Runtime mutation:** when the entity registers a path or installs a tool, the backend updates `process.env` live **and** writes `environment.json`. Effective immediately and persistent.
- **Cross-platform:** PATH separator (`:` vs `;`), path normalization, and per-OS standard dirs all handled in backend code. The same overlay mechanism serves macOS, Windows, Docker, and dev. The Docker entrypoint in `docker-agent-environment.md` becomes one consumer of this model (it can pre-seed `path_additions` rather than exporting env vars in a shell script).

> **Interaction with Cortex's `safe-env` denylist (important).** Cortex's bash tool sanitizes the environment and **strips** `NODE_OPTIONS`, `NODE_PATH`, `PYTHONPATH`, `LD_*`, `DYLD_*`, `BASH_ENV`, etc. for security, but **keeps `PATH`**. Therefore:
> - PATH-based tooling (the `npm`/`node` case, downloaded binaries) works cleanly through the overlay.
> - Library-resolution vars (`PYTHONPATH`, `NODE_PATH`) set in the overlay will **not** reach commands the bash tool spawns. So the self-managed environment must prefer **PATH-discoverable, self-contained installs** (e.g. a node toolchain whose `bin` is on PATH; pip installs via venv/shims rather than `PYTHONPATH`).
> - If propagating an allowlisted set of additional vars to spawned commands proves necessary, the correct fix is a **general-purpose** consumer-provided base-env hook in Cortex (never Animus-specific logic in cortex-mono), per the boundary rule. Tracked as an open question.

### Layer 3 — Agent-facing capability

Three pieces let the entity actually use and extend its environment.

1. **An environment tool** (core Animus MCP tool, defined in `@animus-labs/shared`, handler in `packages/backend/src/tools/handlers/`). Operations: list the current environment / registered tools; add a directory to PATH; set/unset an allowlisted env var; record an installed tool. Each mutating op updates `process.env` and persists `environment.json`. Risk tier **sensitive** (same as `bash`/`run_with_credentials`), so it routes through the existing approval flow by default. See Security.

2. **A bootstrap skill** (`SKILL.md`, skills-first per the plugin philosophy). Teaches the entity the *procedure*: detect whether a tool exists and where (`which`/`where`, common locations); when missing, install **sudo-free into `agent-env/tools/`** (e.g. fetch the official node tarball for the right arch+OS, verify checksum, extract); then register the new `bin` via the environment tool. Because skills load on demand (progressive disclosure), this costs nothing on ordinary ticks and only enters context when the entity is doing tooling/dev work.

3. **Minimal per-tick context** (via `context-builder.ts`, the same injection path as trust-ramp observations). One compact, token-conservative block that makes the entity aware it owns an environment and what is currently in it, without probing. Rendered only when there is something to say (e.g. omit the tool list when empty). Target well under ~50 tokens. Example:
   ```
   ── ENVIRONMENT ──
   You maintain your own toolchain (node 24, ripgrep). Extend it with the
   environment tool; see the bootstrap skill to install missing tools.
   ```
   Depth lives in the skill, not the tick. This matches the owner's instinct: minimal always-on awareness, full procedure on demand.

---

## Security

Giving an entity the power to rewrite its own PATH, download binaries, and execute them is genuinely sensitive and must be designed around, not discovered later.

### Threat model

Animus is self-hosted and single-user; the entity acts for its owner. The dominant threat is **prompt injection**: the entity reads messages, web content, and tool output, so a malicious actor could try to talk it into installing malware ("install this tool from this URL") or hijacking a command ("add this directory to your PATH" pointing at a trojaned `npm`). Because the overlay **persists**, a one-time injection would otherwise become a permanent backdoor.

### Mitigations

- **Confinement is a feature.** Sudo-free; installs land only in `agent-env/tools/`; no system-wide changes. On Docker, container isolation + no Docker socket + optional read-only app mount (per `docker-agent-environment.md`). A compromise stays inside Animus's sandbox.
- **Source allowlist + checksum/signature verification.** Bootstrap installs only from known-good origins (e.g. official node dist) with hash verification, never arbitrary attacker-supplied URLs.
- **Reuse the existing tool-permission / trust-tier system.** The environment tool is **sensitive** tier → default `ask`, gated by the two-tick approval flow. The deterministic approval interceptor (not LLM-interpreted) keeps the entity from approving its own installs. First-time installs surface to the owner; the trust ramp can graduate routine operations later.
- **Enforce the env denylist in the overlay.** The overlay must refuse to set the same dangerous vars Cortex's `safe-env` strips (`DYLD_INSERT_LIBRARIES`, `LD_PRELOAD`, `NODE_OPTIONS`, …). Otherwise the overlay becomes a bypass for the very protections safe-env provides. PATH additions are validated/normalized; prepend order is controlled.
- **Audit + inspectable + resettable.** Every change is logged via the backend logger and recorded in `environment.json` with timestamps. The overlay is a plain file the owner can read and reset (`rm -rf agent-env/` rebuilds clean), and is a natural Settings surface ("what your Animus has installed").

---

## Cortex Boundary Compliance

Per `CLAUDE.md`, Animus-specific logic never goes into cortex-mono. This design respects that: the overlay file, the startup merge, the runtime-mutation `process.env` writes, and the environment tool all live in the **backend**. Cortex's bash tool needs **zero** changes, it simply inherits the richer `process.env` we hand it. The only scenario that would touch Cortex is propagating allowlisted non-PATH env vars to spawned commands, which would be added as a **general-purpose** consumer-provided base-env hook, not Animus-specific behavior.

---

## Implementation Phases

1. **Layer 1 floor (macOS).** `main.rs` PATH augmentation, macOS-gated. Small, strict improvement, unblocks current testing. *(May ship ahead of the rest.)*
2. **Layer 2 overlay.** `agent-env/` layout, `environment.json` schema (Zod, in shared), startup merge + runtime mutation in the backend (store + service per backend-architecture patterns), cross-platform PATH handling, denylist enforcement.
3. **Layer 3a environment tool.** Shared definition + backend handler + permission seeding (sensitive tier).
4. **Layer 3b bootstrap skill.** `SKILL.md` with sudo-free install procedure and checksum verification; reference toolchain (node).
5. **Layer 3c per-tick context.** Minimal block in `context-builder.ts`, gated on non-empty environment.
6. **Docker reconciliation.** Fold `docker-agent-environment.md` into this model (entrypoint pre-seeds `path_additions`; manifest replay for apt remains Docker-specific). Mark that doc as superseded.
7. **Settings surface (optional).** Read-only view of the entity's environment + a reset control.

---

## Implementation (v1)

| Layer | Where |
|-------|-------|
| 1. macOS PATH floor | `packages/tauri/src/main.rs` (macOS-gated append of `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`) |
| 2. Manifest schema | `packages/shared/src/schemas/environment.ts` (`environmentManifestSchema`, `EnvironmentManifest`) |
| 2. Overlay service | `packages/backend/src/services/environment-service.ts` (`getEnvironmentService()`: read/write manifest, `applyToProcessEnv`, denylist, mutations); `AGENT_ENV_DIR` in `utils/env.ts`; applied early in `index.ts` startup |
| 3a. Tool | `manage_environment` def in `packages/shared/src/tools/definitions.ts` (+ `ANIMUS_TOOL_DEFS`, `MIND_TOOL_NAMES`); handler `packages/backend/src/tools/handlers/manage-environment.ts`; registered in `tools/registry.ts`; seeded `sensitive` in `tools/permission-seeder.ts` |
| 3b. Bootstrap skill | `packages/backend/src/heartbeat/builtin-skills/setup-environment-skill.ts`; materialized + registered in `heartbeat/cortex-mind.ts` (`loadBuiltInSkillsAtStartup`) |
| 3c. Per-tick context | `── ENVIRONMENT ──` block in `heartbeat/gather-context.ts` → `context-builder.ts` (`MindContextParams.environmentContext`) → `heartbeat/index.ts` |
| Tests | `packages/backend/tests/services/environment-service.test.ts` |

Notes from implementation: the bootstrap skill is the first **built-in** (non-plugin) skill; built-in skills are materialized to `agent-env/skills/<name>/SKILL.md` at startup and registered with `source: 'builtin'` and `variables: { AGENT_ENV }`. The overlay denylist matches Cortex `safe-env` (refuses `PATH`, `NODE_OPTIONS`, `NODE_PATH`, `PYTHONPATH`, `LD_*`, `DYLD_*`, etc.). The macOS floor is applied both in Tauri (Layer 1) and, idempotently, by the service (so the backend is correct regardless of launcher).

## Open Questions

1. **Login-shell PATH resolution on macOS?** Adopt `$SHELL -lic 'echo $PATH'` merge to capture version managers, or rely on Layer 2 self-registration? (Leaning: Layer 2 self-registration is the durable answer; login-shell merge is a convenience enhancement.)
2. **Allowlisted non-PATH env vars to spawned commands?** Needed for `PYTHONPATH`-style tooling. If yes, add a general-purpose base-env hook to Cortex. (Leaning: avoid; prefer PATH-discoverable/self-contained installs first.)
3. **Size cap / cleanup for `agent-env/`?** Disk-usage health check and an owner-facing reset; possible LRU pruning of unused tools.
4. **`.animus` save/restore inclusion?** Should the registered toolchain travel with AI-state backups, or be treated as machine-local (rebuildable)? (Leaning: machine-local; record manifest for replay rather than shipping binaries across architectures.)

---

## References

- `docs/research/docker-agent-environment.md` — Docker-specific predecessor (persistent `agent-env`, install wrappers, manifest replay) that this generalizes.
- `docs/architecture/data-directory.md` — `DATA_DIR` layout (`agent-env/` slots in here; reconciles reserved `workspace/`).
- `docs/architecture/tool-permissions.md` — risk tiers, two-tick approval, deterministic interceptor, trust ramp (the environment tool plugs in as `sensitive`).
- `docs/architecture/mcp-tools.md` — shared tool definition + backend handler pattern for the environment tool.
- `docs/architecture/context-builder.md` — per-tick context injection (minimal environment block).
- `docs/architecture/plugin-system.md` — skills-first philosophy / `SKILL.md` standard (bootstrap skill).
- `cortex-mono/.../tools/shared/safe-env.ts` and `tools/bash/index.ts` — the sanitized-env denylist and non-login `-c` shell behavior this design works within.
- `packages/tauri/src/main.rs` (~L428) — sidecar PATH construction (Layer 1 target).
