#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# prepare-tauri.sh
# Prepares the Tauri build by downloading a platform-specific Node.js binary
# and populating the resources/ directory with the built backend + dependencies.
#
# Run this AFTER `npm run build:prod` and BEFORE `cargo tauri build`.
# ============================================================================

# -- Colors (if terminal supports it) ----------------------------------------
if [ -t 1 ] && command -v tput &>/dev/null && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  BOLD=$(tput bold)
  GREEN=$(tput setaf 2)
  CYAN=$(tput setaf 6)
  YELLOW=$(tput setaf 3)
  RED=$(tput setaf 1)
  RESET=$(tput sgr0)
else
  BOLD="" GREEN="" CYAN="" YELLOW="" RED="" RESET=""
fi

step() { echo "${BOLD}${CYAN}==> $1${RESET}"; }
info() { echo "    ${GREEN}$1${RESET}"; }
warn() { echo "    ${YELLOW}WARNING: $1${RESET}"; }
fail() { echo "    ${RED}ERROR: $1${RESET}"; exit 1; }

# -- Paths --------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$REPO_ROOT/packages/tauri"
BINARIES_DIR="$TAURI_DIR/binaries"
RESOURCES_DIR="$TAURI_DIR/resources"
BACKEND_DIST="$REPO_ROOT/packages/backend/dist"
SHARED_PKG="$REPO_ROOT/packages/shared"
AGENTS_PKG="$REPO_ROOT/packages/agents"
BACKEND_PKG_JSON="$REPO_ROOT/packages/backend/package.json"

NODE_VERSION="v24.0.0"

# ===========================================================================
# STEP A: Download Node.js binary
# ===========================================================================
step "Step A: Download Node.js binary"

# Detect platform and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    NODE_OS="darwin"
    case "$ARCH" in
      arm64)  NODE_ARCH="arm64";  TARGET_TRIPLE="aarch64-apple-darwin" ;;
      x86_64) NODE_ARCH="x64";    TARGET_TRIPLE="x86_64-apple-darwin" ;;
      *)      fail "Unsupported macOS architecture: $ARCH" ;;
    esac
    ;;
  Linux)
    NODE_OS="linux"
    case "$ARCH" in
      x86_64)  NODE_ARCH="x64";   TARGET_TRIPLE="x86_64-unknown-linux-gnu" ;;
      aarch64) NODE_ARCH="arm64";  TARGET_TRIPLE="aarch64-unknown-linux-gnu" ;;
      *)       fail "Unsupported Linux architecture: $ARCH" ;;
    esac
    ;;
  *)
    fail "Unsupported OS: $OS (only macOS and Linux are supported)"
    ;;
esac

BINARY_NAME="node-${TARGET_TRIPLE}"
BINARY_PATH="$BINARIES_DIR/$BINARY_NAME"

info "Platform: ${NODE_OS}-${NODE_ARCH} (target triple: ${TARGET_TRIPLE})"

if [ -f "$BINARY_PATH" ]; then
  info "Node.js binary already exists at $BINARY_PATH — skipping download"
else
  ARCHIVE_NAME="node-${NODE_VERSION}-${NODE_OS}-${NODE_ARCH}.tar.gz"
  DOWNLOAD_URL="https://nodejs.org/dist/${NODE_VERSION}/${ARCHIVE_NAME}"
  TMP_DIR="$(mktemp -d)"
  trap "rm -rf '$TMP_DIR'" EXIT

  info "Downloading Node.js ${NODE_VERSION} from ${DOWNLOAD_URL}"
  curl -fSL --progress-bar -o "$TMP_DIR/$ARCHIVE_NAME" "$DOWNLOAD_URL"

  info "Extracting node binary..."
  tar -xzf "$TMP_DIR/$ARCHIVE_NAME" -C "$TMP_DIR"

  EXTRACTED_DIR="$TMP_DIR/node-${NODE_VERSION}-${NODE_OS}-${NODE_ARCH}"
  if [ ! -f "$EXTRACTED_DIR/bin/node" ]; then
    fail "Could not find node binary at $EXTRACTED_DIR/bin/node"
  fi

  mkdir -p "$BINARIES_DIR"
  cp "$EXTRACTED_DIR/bin/node" "$BINARY_PATH"
  chmod +x "$BINARY_PATH"
  info "Node.js binary installed at $BINARY_PATH"

  # Clean up temp dir (trap handles this, but be explicit)
  rm -rf "$TMP_DIR"
  trap - EXIT
fi

# ===========================================================================
# STEP B: Populate resources/ directory
# ===========================================================================
step "Step B: Populate resources/ directory"

# B.1 — Verify backend is built
if [ ! -f "$BACKEND_DIST/index.js" ]; then
  fail "Backend not built. Run 'npm run build:prod' first. Expected: $BACKEND_DIST/index.js"
fi

# B.2 — Clean resources (except .gitkeep)
info "Cleaning resources/ directory..."
find "$RESOURCES_DIR" -mindepth 1 -not -name '.gitkeep' -exec rm -rf {} + 2>/dev/null || true

# B.3 — Copy backend dist
info "Copying backend dist..."
mkdir -p "$RESOURCES_DIR/backend"
cp -R "$BACKEND_DIST"/* "$RESOURCES_DIR/backend/"

# B.4 — Copy @animus/shared workspace package
info "Copying @animus/shared..."
mkdir -p "$RESOURCES_DIR/node_modules/@animus/shared"
cp "$SHARED_PKG/package.json" "$RESOURCES_DIR/node_modules/@animus/shared/"
if [ -d "$SHARED_PKG/dist" ]; then
  cp -R "$SHARED_PKG/dist" "$RESOURCES_DIR/node_modules/@animus/shared/dist"
else
  fail "@animus/shared not built. Expected: $SHARED_PKG/dist"
fi

# B.5 — Copy @animus/agents workspace package
info "Copying @animus/agents..."
mkdir -p "$RESOURCES_DIR/node_modules/@animus/agents"
cp "$AGENTS_PKG/package.json" "$RESOURCES_DIR/node_modules/@animus/agents/"
if [ -d "$AGENTS_PKG/dist" ]; then
  cp -R "$AGENTS_PKG/dist" "$RESOURCES_DIR/node_modules/@animus/agents/dist"
else
  fail "@animus/agents not built. Expected: $AGENTS_PKG/dist"
fi

# B.6 — Generate minimal package.json for third-party deps
info "Generating resources/package.json..."
node -e "
  const pkg = JSON.parse(require('fs').readFileSync('$BACKEND_PKG_JSON', 'utf8'));
  const deps = {};
  for (const [name, version] of Object.entries(pkg.dependencies || {})) {
    // Exclude @animus/* workspace references
    if (!name.startsWith('@animus/')) {
      deps[name] = version;
    }
  }
  const output = {
    name: 'animus-backend-resources',
    version: '0.1.0',
    private: true,
    type: 'module',
    dependencies: deps
  };
  require('fs').writeFileSync(
    '$RESOURCES_DIR/package.json',
    JSON.stringify(output, null, 2) + '\n'
  );
"

# B.7 — Install third-party production dependencies
info "Installing production dependencies in resources/..."
cd "$RESOURCES_DIR"
npm install --omit=dev --ignore-scripts=false 2>&1 | tail -5
cd "$REPO_ROOT"

# ===========================================================================
# STEP C: Verify
# ===========================================================================
step "Step C: Verify build artifacts"

ERRORS=0

if [ ! -f "$RESOURCES_DIR/backend/index.js" ]; then
  warn "Missing: resources/backend/index.js"
  ERRORS=$((ERRORS + 1))
fi

if [ ! -d "$RESOURCES_DIR/node_modules/fastify" ]; then
  warn "Missing: resources/node_modules/fastify"
  ERRORS=$((ERRORS + 1))
fi

if [ ! -d "$RESOURCES_DIR/node_modules/@animus/shared/dist" ]; then
  warn "Missing: resources/node_modules/@animus/shared/dist"
  ERRORS=$((ERRORS + 1))
fi

if [ ! -d "$RESOURCES_DIR/node_modules/@animus/agents/dist" ]; then
  warn "Missing: resources/node_modules/@animus/agents/dist"
  ERRORS=$((ERRORS + 1))
fi

if [ ! -f "$BINARY_PATH" ]; then
  warn "Missing: Node.js binary at $BINARY_PATH"
  ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -gt 0 ]; then
  fail "Verification failed with $ERRORS error(s)"
fi

echo ""
echo "${BOLD}${GREEN}Tauri build preparation complete!${RESET}"
echo "  Node.js binary: $BINARY_PATH"
echo "  Resources dir:  $RESOURCES_DIR"
echo ""
echo "Next step: cd packages/tauri && cargo tauri build"
