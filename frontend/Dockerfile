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
ARG VITE_NETWORK
ARG VITE_WALLET_CONNECT_PROJECT_ID
ARG VITE_TRADING_LIB_ADDRESS
ARG VITE_POSITION_TOKEN_ADDRESS
ARG VITE_ORACLE_AGGREGATOR_ADDRESS
ARG VITE_VAULT_CORE_ADDRESS
ARG VITE_TRADING_CORE_ADDRESS

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_NETWORK=$VITE_NETWORK
ENV VITE_WALLET_CONNECT_PROJECT_ID=$VITE_WALLET_CONNECT_PROJECT_ID
ENV VITE_TRADING_LIB_ADDRESS=$VITE_TRADING_LIB_ADDRESS
ENV VITE_POSITION_TOKEN_ADDRESS=$VITE_POSITION_TOKEN_ADDRESS
ENV VITE_ORACLE_AGGREGATOR_ADDRESS=$VITE_ORACLE_AGGREGATOR_ADDRESS
ENV VITE_VAULT_CORE_ADDRESS=$VITE_VAULT_CORE_ADDRESS
ENV VITE_TRADING_CORE_ADDRESS=$VITE_TRADING_CORE_ADDRESS

# Build
RUN npm run build

# Production image with nginx
FROM nginx:1.25-alpine

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
