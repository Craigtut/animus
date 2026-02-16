# Stage 1: Build
FROM node:24-slim AS builder

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
COPY tsconfig.json ./

# Build in dependency order: shared → agents → frontend → backend
RUN npm run build -w @animus/shared && \
    npm run build -w @animus/agents && \
    npm run build -w @animus/frontend && \
    npm run build -w @animus/backend

# Stage 2: Production runtime
FROM node:24-slim AS runtime

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/agents/package.json packages/agents/
COPY packages/backend/package.json packages/backend/
COPY packages/channel-sdk/package.json packages/channel-sdk/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/agents/dist packages/agents/dist
COPY --from=builder /app/packages/backend/dist packages/backend/dist
COPY --from=builder /app/packages/backend/dist/public packages/backend/dist/public

# Create data directory
RUN mkdir -p /app/data

# Set environment defaults
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DB_SYSTEM_PATH=/app/data/system.db
ENV DB_HEARTBEAT_PATH=/app/data/heartbeat.db
ENV DB_MEMORY_PATH=/app/data/memory.db
ENV DB_MESSAGES_PATH=/app/data/messages.db
ENV DB_AGENT_LOGS_PATH=/app/data/agent_logs.db
ENV LANCEDB_PATH=/app/data/lancedb

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

VOLUME ["/app/data"]

CMD ["node", "packages/backend/dist/index.js"]
