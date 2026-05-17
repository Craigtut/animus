# Docker Agent Environment Persistence

**STATUS**: Proposal
**Created**: 2026-05-16
**Problem**: Agent-installed tools and packages are lost on container restart/upgrade

## Problem Statement

Animus agents frequently install tools at runtime (pip packages, npm globals, apt packages, downloaded binaries) to accomplish tasks. Currently, only `/app/data` is mounted as a persistent volume. Everything the agent installs goes into the ephemeral container layer and is destroyed when the container is replaced during upgrades.

This creates a frustrating cycle: the agent installs tools, works effectively, then loses all that work on the next release.

## Industry Research

### How Other Projects Solve This

| Project | Persistence Model | Isolation |
|---------|-------------------|-----------|
| E2B | Firecracker microVM snapshots | Hardware (separate kernel) |
| Devin | Hypervisor snapshots + blockdiff (CoW deltas) | Hardware |
| OpenHands | Event-sourced replay + workspace volumes | Docker container |
| Daytona | Long-lived workspaces with snapshots | Docker / Kata / Sysbox |
| Docker Sandboxes | microVM + saved templates | Hypervisor |
| Fly.io Sprites | Persistent VMs + checkpoint/restore | Firecracker |
| Agent Zero | Careful volume mounts (`/a0/usr/` persists, app code ephemeral) | Docker |
| Codex | Two-phase: setup with network, then offline agent | OS-level sandbox |
| DevContainers | Lifecycle hooks + persistent `/workspaces` mount | Docker |
| Coder | Home directory PVC, everything else from image | Docker / K8s |

### Key Patterns

1. **Volume-mount separation**: Persist user/agent state on volumes, keep app code ephemeral and upgradeable (Agent Zero, Coder, DevContainers)
2. **Fat base images**: Pre-install common toolchains so the agent rarely needs to install from scratch
3. **Two-phase execution**: Setup phase has network access for installs; agent phase is sandboxed (Codex)
4. **Declarative manifests**: `devcontainer.json`, `devenv.nix`, `e2b.toml` allow environments to be rebuilt reproducibly
5. **Snapshot/save**: Capture entire VM/container state for instant resume (E2B, Devin, Docker Sandboxes)

### What Fits Animus

Animus is self-hosted and single-user, so multi-tenant microVM isolation is overkill. The closest prior art is **Agent Zero** (volume separation) combined with **DevContainers** (lifecycle hooks and pre-installed tools). The Codex two-phase model is worth borrowing for security.

## Proposed Architecture

### 1. Persistent Agent Environment (under existing data volume)

All agent-installed software lives under `/app/data/agent-env/`. Since `/app/data` is already volume-mounted, this persists across both restarts and upgrades with zero configuration changes for existing users.

```
/app/data/
  agent-env/
    bin/            # Agent-installed binaries, symlinks
    lib/            # Shared libraries
    pip/            # pip --target installs
    npm/            # npm --prefix installs
    cargo/          # cargo install --root installs
    go/             # GOPATH/GOBIN target
    apt-overlay/    # See "apt persistence" below
    manifest.json   # What was installed (optional, for recovery)
  databases/        # (existing) SQLite databases
  logs/             # (existing) Application logs
  huggingface_cache/# (existing) Model cache
```

### 2. Entrypoint Script

A startup script wires the persistent environment into the container's PATH and library search paths:

```bash
#!/bin/bash
set -e

AGENT_ENV="/app/data/agent-env"

# Create structure on first run
mkdir -p "$AGENT_ENV"/{bin,lib,pip,npm,cargo,go,apt-overlay}

# Prepend agent env to PATH (agent installs take priority)
export PATH="$AGENT_ENV/bin:$AGENT_ENV/npm/bin:$AGENT_ENV/cargo/bin:$AGENT_ENV/go/bin:$PATH"
export PYTHONPATH="$AGENT_ENV/pip:${PYTHONPATH:-}"
export NODE_PATH="$AGENT_ENV/npm/lib/node_modules:${NODE_PATH:-}"
export LD_LIBRARY_PATH="$AGENT_ENV/lib:${LD_LIBRARY_PATH:-}"
export CARGO_INSTALL_ROOT="$AGENT_ENV/cargo"
export GOPATH="$AGENT_ENV/go"
export GOBIN="$AGENT_ENV/go/bin"
export NPM_CONFIG_PREFIX="$AGENT_ENV/npm"
export PIP_TARGET="$AGENT_ENV/pip"

# Replay apt manifest if present and image version changed
if [ -f "$AGENT_ENV/manifest.json" ]; then
  IMAGE_VERSION=$(cat /app/.image-version 2>/dev/null || echo "unknown")
  LAST_VERSION=$(jq -r '.image_version // "none"' "$AGENT_ENV/manifest.json")
  if [ "$IMAGE_VERSION" != "$LAST_VERSION" ]; then
    echo "[agent-env] Image upgraded ($LAST_VERSION -> $IMAGE_VERSION), replaying apt packages..."
    APT_PACKAGES=$(jq -r '.apt_packages[]?' "$AGENT_ENV/manifest.json")
    if [ -n "$APT_PACKAGES" ]; then
      apt-get update -qq && apt-get install -y --no-install-recommends $APT_PACKAGES
      rm -rf /var/lib/apt/lists/*
    fi
    jq --arg v "$IMAGE_VERSION" '.image_version = $v' "$AGENT_ENV/manifest.json" > /tmp/manifest.json
    mv /tmp/manifest.json "$AGENT_ENV/manifest.json"
  fi
fi

# Continue to the main application
exec "$@"
```

### 3. Agent-Aware Install Wrappers

The agent needs to know where to install things. Rather than intercepting system commands, we provide wrapper scripts in the base image that target the persistent directory:

```bash
# /usr/local/bin/agent-pip
#!/bin/bash
pip install --target="$PIP_TARGET" "$@"

# /usr/local/bin/agent-npm
#!/bin/bash
npm install -g --prefix="$NPM_CONFIG_PREFIX" "$@"

# /usr/local/bin/agent-install
#!/bin/bash
# Wrapper for apt-get that also records to manifest
apt-get update -qq && apt-get install -y --no-install-recommends "$@"
rm -rf /var/lib/apt/lists/*

# Record to manifest
MANIFEST="/app/data/agent-env/manifest.json"
if [ ! -f "$MANIFEST" ]; then
  echo '{"apt_packages":[],"image_version":"unknown"}' > "$MANIFEST"
fi
for pkg in "$@"; do
  jq --arg p "$pkg" '.apt_packages += [$p] | .apt_packages |= unique' "$MANIFEST" > /tmp/m.json
  mv /tmp/m.json "$MANIFEST"
done
```

**Important**: The agent can still use raw `apt-get`, `pip`, `npm` directly. Those installs will work within the current container session but won't survive upgrades (apt) or will be in unexpected locations (pip/npm). The wrappers are the "right" way; the agent's system prompt should guide it to use them. Over time we can also alias the raw commands.

### 4. Fat Base Image (Pre-installed Tools)

Expand the runtime stage to include tools agents commonly need. This eliminates most install-on-demand scenarios:

```dockerfile
# In the runtime stage, after ffmpeg installation:
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build essentials (agents often need to compile things)
    build-essential \
    # Python ecosystem
    python3 python3-pip python3-venv python3-dev \
    # Common utilities agents reach for
    curl wget git jq unzip zip tar \
    # Network debugging
    dnsutils iputils-ping netcat-openbsd \
    # Text processing
    ripgrep fd-find \
    # Process management
    procps htop \
    # Image processing (beyond sharp)
    imagemagick \
    # PDF handling
    poppler-utils \
    # SSH/SCP (for remote operations)
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install common Python packages at system level
RUN pip3 install --break-system-packages \
    requests beautifulsoup4 pandas numpy pyyaml \
    httpx aiohttp rich typer

# Rust toolchain (agents sometimes need cargo for CLI tools)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:$PATH"
```

### 5. Manifest (Lightweight, Optional)

The manifest at `/app/data/agent-env/manifest.json` records what the agent installed. It serves two purposes:

1. **Recovery after upgrades**: apt packages are replayed on startup (see entrypoint script)
2. **Observability**: users can see what their agent has installed

```json
{
  "image_version": "0.5.0",
  "apt_packages": ["graphviz", "texlive-base"],
  "pip_packages": ["matplotlib", "scikit-learn"],
  "npm_packages": ["typescript", "eslint"],
  "cargo_packages": ["bat", "tokei"],
  "installed_at": {
    "graphviz": "2026-05-10T14:30:00Z",
    "matplotlib": "2026-05-12T09:15:00Z"
  }
}
```

The manifest is purely additive and advisory. If it gets corrupted or lost, everything still works (existing binaries in the agent-env directories remain functional). It's only needed for apt replay on upgrades.

## Security Considerations

### What the Agent Can Do

| Action | Risk | Mitigation |
|--------|------|------------|
| Install pip/npm/cargo packages | Supply chain attack | Packages run as non-root; no host access |
| Install apt packages | Broader system access | Container isolation; no host filesystem |
| Download arbitrary binaries | Malicious code execution | Runs inside container; no privilege escalation to host |
| Modify PATH/env | Could shadow system tools | Agent-env prepended, not replacing; image tools still accessible |
| Fill disk | Denial of service | Docker resource limits; data volume quotas |

### Recommended Guardrails

1. **Non-root agent user**: The application (and agent tool execution) should run as a non-root user. Apt installs require sudo, which we can configure with NOPASSWD for package management only.

2. **No Docker socket**: Never mount `/var/run/docker.sock`. The agent should not be able to create sibling containers or access the host Docker daemon.

3. **Resource limits**: Set memory and disk limits via docker-compose `deploy.resources` (already in the override example).

4. **Network policy** (optional, advanced): For paranoid deployments, restrict outbound network to known registries (pypi.org, npmjs.com, crates.io, apt mirrors) during install operations.

5. **Read-only application code**: Mount `/app` (excluding `/app/data`) as read-only so the agent cannot modify the application itself.

```yaml
# docker-compose.yml addition
services:
  animus:
    read_only: true
    tmpfs:
      - /tmp
      - /var/lib/apt/lists
      - /var/cache/apt
    volumes:
      - ./data:/app/data  # persistent, writable
```

### Single-User Trust Model

Animus is self-hosted and single-user. The agent acts on behalf of its owner. The primary threat isn't the agent being malicious (it's your agent), but rather:

- **Compromised packages**: A malicious pip/npm package could exfiltrate data. Mitigated by container isolation (no host access) and network restrictions if desired.
- **Persistent backdoors**: A compromised package in the agent-env survives restarts. Mitigated by the manifest (audit trail) and the ability to nuke `agent-env/` and start fresh.
- **Runaway resource usage**: The agent installs too much. Mitigated by disk quotas and the visibility of the manifest.

## Reliability Considerations

### What Survives What

| Event | Agent-env packages | Apt packages | Application |
|-------|-------------------|--------------|-------------|
| Container restart | Yes (volume) | Yes (same container) | Yes |
| `docker-compose down && up` | Yes (volume) | No (new container) | Fresh from image |
| Image upgrade | Yes (volume) | Replayed from manifest | Fresh from image |
| Volume deletion | No | No | Fresh from image |

### Failure Modes

1. **Binary incompatibility after upgrade**: A pip package with C extensions compiled against old glibc may break with new base image. **Mitigation**: The manifest records pip packages; the entrypoint could optionally reinstall them too (not just apt). Or: detect failures and suggest `agent-env reset`.

2. **Stale PATH entries**: Agent-env binaries that depend on removed system libraries. **Mitigation**: Keep the base image stable (same Debian release across minor versions). Major version bumps should document that agent-env may need rebuilding.

3. **Corrupt manifest**: The manifest gets malformed. **Mitigation**: Manifest is advisory only. The environment works without it. Add JSON validation to the entrypoint.

4. **Disk space exhaustion**: Agent installs too much. **Mitigation**: Docker volume quotas; monitoring; a `du -sh /app/data/agent-env` health check.

### Recovery

Users can always reset the agent environment without losing their data:

```bash
# Nuclear option: wipe agent-installed tools
rm -rf ./data/agent-env

# Selective: just wipe pip packages
rm -rf ./data/agent-env/pip

# The next container start recreates the directory structure
```

## Implementation Plan

### Phase 1: Fat Base Image (low risk, high immediate value)

Expand the Dockerfile runtime stage with commonly-needed tools. This alone eliminates 80%+ of runtime installs.

**Changes**: Dockerfile only
**Risk**: Larger image size (estimate: +200-400MB)
**Benefit**: Immediate; most agent tasks work without any runtime installs

### Phase 2: Persistent Agent Environment

Add the entrypoint script, directory structure, and PATH wiring. Agent-installed tools survive restarts and upgrades.

**Changes**: Dockerfile (entrypoint), docker-compose.yml (read_only), new script
**Risk**: Low; additive change. Existing data volume used.
**Benefit**: Agent installs persist permanently

### Phase 3: Install Wrappers + Manifest

Add `agent-pip`, `agent-npm`, `agent-install` wrappers. The manifest enables apt replay on upgrades.

**Changes**: New scripts in image, entrypoint manifest-replay logic
**Risk**: Low; wrappers are optional. Agent can still use raw commands.
**Benefit**: Upgrades automatically replay system packages

### Phase 4: Agent System Prompt Integration

Update the agent's tool-use instructions to prefer `agent-pip`/`agent-npm`/`agent-install` over raw commands. This is the glue that makes the agent "aware" of persistence.

**Changes**: System prompt / tool descriptions
**Risk**: None
**Benefit**: Agent naturally installs to persistent locations

### Phase 5 (Optional): Security Hardening

Non-root user, read-only app mount, network policy for registries. Only needed if running in less-trusted environments.

**Changes**: Dockerfile (USER directive), compose (read_only, network), sudo config
**Risk**: Medium; may break assumptions about writable paths
**Benefit**: Defense in depth

## Open Questions

1. **Should raw `pip install` be aliased to target agent-env?** This means the agent doesn't need special commands, but could surprise users who expect system-level installs. Agent Zero does this; it works in practice.

2. **Should we rebuild pip packages on upgrade?** C extensions compiled against old libraries may break. We could add a `PIP_REINSTALL_ON_UPGRADE=true` flag that reinstalls everything from manifest.

3. **How much to pre-install?** Bigger image = slower pulls but faster agent experience. The sweet spot is probably: Python + common libs, Node.js (already there), build-essential, common CLI tools. Total image size target: under 2GB.

4. **Should the agent-env have a size cap?** Docker doesn't natively support per-directory quotas, but we could add a periodic check or a pre-install hook that warns when approaching a limit.

## References

- [E2B Sandbox Architecture](https://e2b.dev/docs)
- [Cognition/Devin Blockdiff](https://github.com/CognitionAI/blockdiff)
- [OpenHands Event-Sourced Architecture](https://docs.all-hands.dev)
- [Docker Sandboxes Security Model](https://docs.docker.com/ai/sandboxes/security/)
- [Codex Sandboxing](https://developers.openai.com/codex/concepts/sandboxing)
- [Agent Zero Docker Deployment](https://www.agent-zero.ai/p/architecture/)
- [DevContainer Lifecycle Hooks](https://containers.dev/implementors/features/)
- [devenv Declarative Environments](https://devenv.sh/)
