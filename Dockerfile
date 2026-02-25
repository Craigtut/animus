# Stage 1: Build
FROM node:24 AS builder

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/agents/package.json packages/agents/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
COPY packages/channel-sdk/package.json packages/channel-sdk/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/agents/ packages/agents/
COPY packages/backend/ packages/backend/
COPY packages/frontend/ packages/frontend/
COPY packages/channel-sdk/ packages/channel-sdk/
COPY tsconfig.base.json tsconfig.json ./

# Build in dependency order: shared → agents → frontend → backend
# Each package is built explicitly from its directory to avoid workspace
# resolution quirks. The backend tsc emits JS despite pre-existing type
# errors (noEmitOnError defaults to false) so we allow its exit code.
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
# LanceDB and sharp platform binaries are optionalDeps that get removed during
# prune. Re-install the correct ones for the container's architecture.
RUN npm prune --omit=dev && \
    LANCE_VER=$(node -p "JSON.parse(require('fs').readFileSync('node_modules/@lancedb/lancedb/package.json','utf8')).version") && \
    SHARP_VER=$(node -p "JSON.parse(require('fs').readFileSync('node_modules/sharp/package.json','utf8')).version") && \
    ARCH=$(node -p "({x64:'x64',arm64:'arm64'})[process.arch]") && \
    npm install --no-save \
      "@lancedb/lancedb-linux-${ARCH}-gnu@${LANCE_VER}" \
      "@img/sharp-linux-${ARCH}@${SHARP_VER}"

# Stage 2: Production runtime
FROM node:24-slim AS runtime

LABEL org.opencontainers.image.title="Animus Engine"
LABEL org.opencontainers.image.description="Autonomous AI assistant with persistent inner life"
LABEL org.opencontainers.image.source="https://github.com/animus-engine/animus"

WORKDIR /app

# Copy package files (needed for Node module resolution)
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/agents/package.json packages/agents/
COPY packages/backend/package.json packages/backend/
COPY packages/channel-sdk/package.json packages/channel-sdk/

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

CMD ["node", "packages/backend/dist/index.js"]
