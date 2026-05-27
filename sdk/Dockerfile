# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Runtime stage (minimal)
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# The SDK is a library — no runtime CMD needed.
# Consumers install it via npm or use it as a build dependency.
CMD ["node", "-e", "console.log('@realyx/sdk library ready')"]