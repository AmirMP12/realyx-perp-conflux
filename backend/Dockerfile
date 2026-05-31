# syntax=docker/dockerfile:1

# ── Build stage ──────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Production dependencies stage ────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Runtime stage ────────────────────────────────────────────
FROM node:20-alpine AS runtime

# tini provides proper PID 1 signal handling for graceful shutdown.
RUN apk add --no-cache tini

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# Ship runtime ABI JSON (loaded via fs at process.cwd()/src/abi by the indexer).
COPY --from=builder /app/src/abi ./src/abi

# Drop privileges — run as the unprivileged "node" user shipped in the image.
USER node

EXPOSE 3001 3002 9090

# Liveness check against the public API health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
