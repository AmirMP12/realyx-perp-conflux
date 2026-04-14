# Developer & Environment Setup

This operational manual provides a step-by-step workflow for configuring a local, full-stack development environment for the **Realyx** protocol on **Conflux eSpace**.

---

## 1. Base Prerequisites

The Realyx architecture relies on modern, containerized environments. Ensure your system runs:
- **Node.js**: `v18.x` or `v20.x` (LTS highly recommended)
- **Docker engine & Docker Compose**: Essential for orchestrating databases, Redis, and database indexers natively.
- **Git & Git CLI**: For version control management.

---

## 2. Repository Initialization

Clone the master repository and initiate the monorepo-style package installations:
```bash
git clone https://github.com/AmirMP12/realyx-perp-dex.git
cd realyx-perp-dex
npm install
```

## 3. Multi-Tier Environment Variables

Realyx utilizes strict `.env` segregation across its core services. Replicate the example files and populate required credentials.

### 📄 Root Scope (Smart Contracts)
```bash
cp .env.example .env
```
*Action Item: Provide your `PRIVATE_KEY` and optional `CONFLUXSCAN_API_KEY` for verification.*

### 🖥️ Backend API Scope
```bash
cd backend
cp .env.example .env
```
*Action Item: Define the `POSTGRES_URL`, network ports, and PostgreSQL credentials.*
Also set:
- `ENABLE_WS=true` for local native websocket mode.
- `ENABLE_WS=false` for Vercel/serverless polling mode.

### 📱 Frontend UX Scope
```bash
cd ../frontend
cp .env.example .env
```
*Action Item: Input your `VITE_WALLET_CONNECT_PROJECT_ID` and sync contract addresses with `deployment/confluxTestnet.json`.*
For Vercel-only deployments keep `VITE_WS_URL` empty.

---

## 4. Protocol Invocation (Local Deploy)

### The Containerized Fast-Track (Recommended)
The most robust method to replicate the Realyx stack locally is via Docker Compose.
```bash
# Return to the root directory
cd ..
# Launch the minimal cluster in detached mode
docker-compose -f docker-compose.minimal.yml up -d
```

**Service Endpoints:**
- **Frontend App**: `http://localhost:3000`
- **REST API Portal**: `http://localhost:3001/api`
- **WebSocket Feed**: `ws://localhost:3002` (only when `ENABLE_WS=true`)

### The Manual Debug Track
To attach debuggers and review hot-reloads actively:
1. **Boot Dependencies**: `docker-compose up -d postgres redis`
2. **Backend Engine**: `cd backend && npm run dev`
3. **Frontend UI**: `cd frontend && npm run dev` *(Access via `http://localhost:5173`)*

---

## 5. Smart Contract Engineering

Modifying or patching the Realyx Solidity logic is strictly controlled via **Hardhat**.

```bash
# Compile and cache the latest ABIs
npx hardhat compile

# Deploy logic to the Conflux eSpace Testnet edge
npm run deploy:conflux-testnet
```

---
*Facing dependency conflicts or indexing lags? Refer to [Known Issues](known_issues.md) or raise a ticket on our GitHub.*
