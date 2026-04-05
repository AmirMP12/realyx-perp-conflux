# User & Developer Setup Guide

This guide provides step-by-step instructions for setting up a local development environment for the Realyx protocol on **Conflux eSpace**.

## 1. Prerequisites
Ensure you have the following installed on your machine:
- **Node.js**: v18.x or v20.x
- **Docker & Docker Compose**: For running the database, redis, and monitoring stack.
- **Git**: To clone the repository.

## 2. Global Installation
Install the Graph CLI for subgraph development:
```bash
npm install -g @graphprotocol/graph-cli
```

## 3. Repository Initialization
Clone the repository and install core dependencies:
```bash
git clone https://github.com/your-repo/realyx.git
cd realyx
npm install
```

## 4. Environment Configuration
Realyx uses a multi-tier environment setup. You must configure `.env` files for each component:

### Root Level
```bash
cp .env.example .env
# Set DEPLOYER_PRIVATE_KEY and CONFLUXSCAN_API_KEY
```

### Backend
```bash
cd backend
cp .env.example .env
# Set SUBGRAPH_URL and database credentials
```

### Frontend
```bash
cd ../frontend
cp .env.example .env
# Set VITE_TRADING_CORE_ADDRESS and other contract addresses
```

## 5. Running the Protocol

### Quick Start (Docker)
The easiest way to run the entire stack (Database, Redis, Backend, Frontend, Monitoring) is via Docker Compose:
```bash
docker-compose up -d
```
All services will be available at:
- **Frontend**: `http://localhost:3000`
- **Backend API**: `http://localhost:3001`
- **Prometheus**: `http://localhost:9090`

### Manual Development (Local)
If you prefer running components individually for development:
1. **Start Database**: `docker-compose up -d postgres redis`
2. **Launch Backend**: `cd backend && npm run dev`
3. **Launch Frontend**: `cd frontend && npm run dev`

## 6. Smart Contract Interaction
To interact with contracts or deploy new versions:
```bash
# Compile contracts
npx hardhat compile

# Deploy to Conflux Testnet
npx hardhat run scripts/deploy.ts --network confluxTestnet
```

---
*For any issues, consult the [Known Issues](known_issues.md) or join our developer Discord.*
