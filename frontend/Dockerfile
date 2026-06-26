# Frontend Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (legacy-peer-deps for rainbowkit/wagmi peer mismatch)
RUN npm ci --legacy-peer-deps

# Copy source
COPY . .

# Build arguments - must be passed to ENV so Vite can use them at build time
ARG VITE_API_URL
ARG VITE_WS_URL
ARG VITE_WALLET_CONNECT_PROJECT_ID
ARG VITE_RPC_URL
ARG VITE_CONFLUX_TESTNET_RPC_URL
ARG VITE_APP_URL
ARG VITE_POSITION_TOKEN_ADDRESS
ARG VITE_ORACLE_AGGREGATOR_ADDRESS
ARG VITE_VAULT_CORE_ADDRESS
ARG VITE_TRADING_CORE_ADDRESS
ARG VITE_MOCK_USDT0_ADDRESS
ARG VITE_COLLATERAL_REGISTRY_ADDRESS
ARG VITE_COPY_REGISTRY_ADDRESS
ARG VITE_REFERRAL_REGISTRY_ADDRESS
ARG VITE_COPY_BOT_ADDRESS
ARG VITE_USDT0_ADDRESS

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_WALLET_CONNECT_PROJECT_ID=$VITE_WALLET_CONNECT_PROJECT_ID
ENV VITE_RPC_URL=$VITE_RPC_URL
ENV VITE_CONFLUX_TESTNET_RPC_URL=$VITE_CONFLUX_TESTNET_RPC_URL
ENV VITE_APP_URL=$VITE_APP_URL
ENV VITE_POSITION_TOKEN_ADDRESS=$VITE_POSITION_TOKEN_ADDRESS
ENV VITE_ORACLE_AGGREGATOR_ADDRESS=$VITE_ORACLE_AGGREGATOR_ADDRESS
ENV VITE_VAULT_CORE_ADDRESS=$VITE_VAULT_CORE_ADDRESS
ENV VITE_TRADING_CORE_ADDRESS=$VITE_TRADING_CORE_ADDRESS
ENV VITE_MOCK_USDT0_ADDRESS=$VITE_MOCK_USDT0_ADDRESS
ENV VITE_COLLATERAL_REGISTRY_ADDRESS=$VITE_COLLATERAL_REGISTRY_ADDRESS
ENV VITE_COPY_REGISTRY_ADDRESS=$VITE_COPY_REGISTRY_ADDRESS
ENV VITE_REFERRAL_REGISTRY_ADDRESS=$VITE_REFERRAL_REGISTRY_ADDRESS
ENV VITE_COPY_BOT_ADDRESS=$VITE_COPY_BOT_ADDRESS
ENV VITE_USDT0_ADDRESS=$VITE_USDT0_ADDRESS

# Build
RUN npm run build

# Production image with nginx (unprivileged — runs as non-root, listens on 8080)
FROM nginxinc/nginx-unprivileged:1.25-alpine

# Patch base OS packages (e.g. OpenSSL) to pick up security fixes. apk requires
# root, so temporarily switch to root and drop back to the unprivileged nginx
# user (UID 101) before running the container.
USER root
RUN apk upgrade --no-cache

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

USER 101

EXPOSE 8080

# Liveness check — nginx serves the SPA on 8080 (unprivileged image).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
