# syntax=docker/dockerfile:1

# ── Build stage ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Production dependencies stage ────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ── Runtime stage (minimal) ──────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules

USER node

# The SDK is a library — no long-running CMD needed.
# Consumers install it via npm or use it as a build dependency.
CMD ["node", "-e", "console.log('@realyx/sdk library ready')"]
