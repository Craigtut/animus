# Stage 0: Build tts-native Rust addon
FROM node:25 AS rust-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config libssl-dev git curl \
    && rm -rf /var/lib/apt/lists/*

# Install Rust (stable toolchain)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app

# Copy only tts-native source + root package files needed for napi build
COPY packages/tts-native/package.json packages/tts-native/
COPY packages/tts-native/Cargo.toml packages/tts-native/Cargo.lock* packages/tts-native/
COPY packages/tts-native/build.rs packages/tts-native/
COPY packages/tts-native/src/ packages/tts-native/src/

# Install @napi-rs/cli (build tool) and build the native addon
RUN cd packages/tts-native && \
    npm install @napi-rs/cli@3 && \
    npx napi build --release --platform

# Stage 1: Build
FROM node:25 AS builder

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/agents/package.json packages/agents/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
COPY packages/channel-sdk/package.json packages/channel-sdk/
COPY packages/tts-native/package.json packages/tts-native/

# Install all dependencies (including devDependencies for build).
# onnxruntime-node's postinstall downloads optional CUDA GPU libraries (~500MB)
# from GitHub. CPU binaries are already bundled in the package. Skip the GPU
# download since we use CPU inference in Docker.
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
RUN npm ci

# Copy the pre-built tts-native binary from rust-builder
COPY --from=rust-builder /app/packages/tts-native/tts-native.*.node packages/tts-native/

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/agents/ packages/agents/
COPY packages/backend/ packages/backend/
COPY packages/frontend/ packages/frontend/
COPY packages/channel-sdk/ packages/channel-sdk/
COPY tsconfig.base.json tsconfig.json ./

# Build in dependency order: shared → agents → frontend → backend
# .dockerignore excludes **/dist and **/*.tsbuildinfo to prevent stale build
# artifacts from poisoning the Docker build. Each step also cleans dist/ as
# defense in depth. The backend tsc may have type errors (noEmitOnError
# defaults to false) so we allow its exit code.
RUN cd packages/shared && rm -rf dist && npx tsc && \
    test -f dist/index.d.ts && \
    cd ../agents && rm -rf dist && npx tsc && cp src/models.json dist/models.json && \
    cd ../frontend && npx vite build && \
    cd ../backend && rm -rf dist && (npx tsc -p tsconfig.build.json || true) && \
    rm -rf dist/db/migrations && cp -r src/db/migrations dist/db/migrations && \
    rm -rf dist/public && cp -r ../frontend/dist dist/public

# Prune dev dependencies after build (keeps native addons intact).
# LanceDB, sharp, and sherpa-onnx platform binaries are optionalDeps that get
# removed during prune. Re-install the correct ones for the container's arch.
RUN npm prune --omit=dev && \
    LANCE_VER=$(node -p "JSON.parse(require('fs').readFileSync('node_modules/@lancedb/lancedb/package.json','utf8')).version") && \
    SHARP_VER=$(node -p "JSON.parse(require('fs').readFileSync('node_modules/sharp/package.json','utf8')).version") && \
    SHERPA_VER=$(node -p "JSON.parse(require('fs').readFileSync('node_modules/sherpa-onnx-node/package.json','utf8')).version") && \
    ARCH=$(node -p "({x64:'x64',arm64:'arm64'})[process.arch]") && \
    npm install --no-save \
      "@lancedb/lancedb-linux-${ARCH}-gnu@${LANCE_VER}" \
      "@img/sharp-linux-${ARCH}@${SHARP_VER}" \
      "sherpa-onnx-linux-${ARCH}@${SHERPA_VER}"

# Stage 2: Production runtime
FROM node:25 AS runtime

# Install ffmpeg (needed for audio format conversion: WebM→PCM, WAV→OGG)
# Note: node:25 (full) is used instead of node:25-slim so that the agent has
# access to standard tools (curl, ping, etc.) when executing shell commands.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.title="Animus Engine"
LABEL org.opencontainers.image.description="Autonomous AI assistant with persistent inner life"
LABEL org.opencontainers.image.source="https://github.com/craigtut/animus"

WORKDIR /app

# Copy package files (needed for Node module resolution)
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/agents/package.json packages/agents/
COPY packages/backend/package.json packages/backend/
COPY packages/channel-sdk/package.json packages/channel-sdk/
COPY packages/tts-native/package.json packages/tts-native/

# Copy pruned node_modules from builder (preserves native addons).
# Hoisted workspace deps live in root node_modules; per-package dirs may not
# exist after prune, so we create empty fallbacks before copying.
RUN mkdir -p packages/shared/node_modules packages/agents/node_modules packages/backend/node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/backend/node_modules packages/backend/node_modules

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/agents/dist packages/agents/dist
COPY --from=builder /app/packages/backend/dist packages/backend/dist

# Copy tts-native package (index.js loader, type definitions, native binary)
COPY packages/tts-native/index.js packages/tts-native/index.d.ts packages/tts-native/
COPY --from=builder /app/packages/tts-native/tts-native.*.node packages/tts-native/

# Create data directory
RUN mkdir -p /app/data

# Set environment defaults
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV ANIMUS_DATA_DIR=/app/data
ENV HF_HOME=/app/data/huggingface_cache
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

VOLUME ["/app/data"]

# Set LD_LIBRARY_PATH dynamically based on container architecture so sherpa-onnx
# native shared libraries are found at runtime (x64 or arm64).
CMD ["sh", "-c", "ARCH=$(node -p \"({x64:'x64',arm64:'arm64'})[process.arch]\") && export LD_LIBRARY_PATH=/app/node_modules/sherpa-onnx-linux-${ARCH} && exec node packages/backend/dist/index.js"]
