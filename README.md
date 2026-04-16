# 🌌 Realyx — RWA Perpetual Futures DEX

Bridging TradFi and DeFi on Conflux eSpace: Trade Crypto, Equities, and Commodities with up to 10x leverage. Non-custodial, zero KYC, lightning fast.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Conflux](https://img.shields.io/badge/built%20on-Conflux-blue)](https://confluxnetwork.org)
[![Hackathon](https://img.shields.io/badge/Global%20Hackfest%202026-green)](https://github.com/conflux-fans/global-hackfest-2026)

</div>

---

## 📖 Overview
Realyx is a decentralized, intent-based perpetual futures exchange natively built on the Conflux eSpace network. It democratizes access to global financial markets by allowing users to permissionlessly trade high-demand **Real World Assets (RWAs)**—such as Nvidia, Tesla, and Gold commodities—alongside tier-1 cryptocurrencies from a unified margin account. 

Unlike traditional Automated Market Makers (AMMs) that suffer from high slippage and impermanent loss, Realyx utilizes an optimized **Shared Liquidity Vault** backed by stablecoins acting as a universal counterparty. Through the strategic integration of asynchronous order routing, decentralized Keeper execution nodes, and ultra-low latency infrastructure from the **Pyth Network**, we bring the high-frequency trading capabilities of centralized exchanges directly to the EVM layer while ensuring users maintain absolute custody of their funds.

---

## 🏆 Hackathon Information
- **Event**: Global Hackfest 2026
- **Team**: Realyx 

---

## 👥 Team
| Name | Role | GitHub | Discord |
|------|------|--------|---------|
| Amir | Full-Stack/Contract Developer | [@AmirMP12](https://github.com/AmirMP12) | AmirMP12 |

---

## 🚀 Problem Statement
**What problem does Realyx solve?**

Financial globalization is severely fragmented. Centralized platforms gatekeep access to global equities and commodities through strict geographical barriers, steep account minimums, and protracted KYC hurdles. Conversely, decentralized finance (DeFi) platforms have historically been restricted to synthetic crypto assets due to the technical limitations of EVM oracle latency and extreme vulnerability to front-running.

**Deep Dive into the Friction Points:**
1. **Siloed Liquidity & UX:** A retail trader wanting to long Tesla equity and short Bitcoin cannot do so from a unified Web3 portfolio. They must use TradFi brokers (subject to business hours) and disjointed DeFi DEXs simultaneously.
2. **Custodial Risk Execution:** To achieve low-latency perpetual trading, most platforms force users to deposit funds into centralized custodial or off-chain Layer-2 sequencers, completely breaking the fundamental ethos of Web3.
3. **Impermanent Loss & AMM Inefficiency:** Native on-chain derivatives historically rely on basic x*y=k liquidity pools, subjecting liquidity providers (LPs) to catastrophic impermanent loss when price structures diverge rapidly.

**How Conflux Blockchain helps:** 
By deploying on Conflux eSpace, an EVM-compatible network capable of high parallel throughput and fraction-of-a-cent gas fees, Realyx can deploy complex zero-slippage pricing models directly parameterized by external Pyth oracles. The blockchain ensures algorithmic transparency, cryptographically preventing internal exchange manipulation or arbitrary user liquidation blockages.

---

## 💡 Solution
**How does Realyx address the problem?**

Realyx introduces a **Synthetic Vault Counterparty** architecture merged with an intent-based execution engine.

**1. The `realyxLP` Vault Mechanics:**
Instead of pairing traders against each other (which requires deep orderbooks) or using volatile AMMs, Realyx requires Liquidity Providers (LPs) to stake stablecoins (USDT0/AxCNH/USDT/USDC) into `VaultCore.sol`. The Vault collectively acts as the counterparty to all trader open interest. If traders lose, the Vault gains value; if traders win, the Vault pays out. LPs are heavily compensated via standard borrow fees, funding rates, and protocol volume taxes.

**2. Asynchronous MEV-Resistant Execution:**
When a trader submits an order on Realyx, they are technically submitting a cryptographically signed "intent." 
- `createOrder` locks collateral.
- A decentralized bot/Keeper listens to the Conflux blockchain for the intent.
- The Keeper independently fetches the absolutely newest Pyth Oracle signed pricing data, updating the on-chain oracle and executing the intent in the exact same atomic transaction via `executeOrder`. 
**Result:** No front-running. No stale-price arbitrage.

**3. Safety via Insurance Fund:**
In the rare event of extreme, catastrophic market volatility causing PnL inversions (where trader profits massively exceed available Vault liquidity), Realyx employs a staked Insurance Fund that absorbs bad debt prior to the core Vault being struck.

---

## 📈 Go-to-Market Plan
- **Primary Audience:** DeFi power users seeking decentralized exposure to TradFi assets (AAPL, TSLA, GLD) and passive Yield Farmers wanting sustainable real yield derived from trader open-interest fees rather than inflationary tokenomics.
- **Acquisition & Bootstrap Strategy:** 
  1. Bootstrapping initial liquidity by offering 100% of generated platform revenue directly to early `realyxLP` Vault depositors for the first 6 months.
  2. Launching gamified trading competitions and volume leaderboards directly on Conflux testnet, converting those power users seamlessly immediately upon mainnet deployment.
- **Key Performance Indicators (Bootstrap Phase KPIs):** 
  - **Initial TVL Target:** > $350,000 in stablecoin Vault liquidity (sufficient to safely collateralize up to $3.5M in global Open Interest given 10x leverage dynamics).
  - **Daily Exchange Volume:** > $1,000,000 generated through initial retail onboarding and automated arbitrage volume.
  - **Open Interest Retention:** > 60% weekly retention rate among early protocol adopters.
  - **User Acquisition:** Securing 300+ active beta wallets within the first 30 days of mainnet.
- **Ecosystem Synergy:** Realyx establishes a critical DeFi primitive for Conflux eSpace. Perpetual DEX protocols generate the highest consistent contract interactions and block space utilization, creating massive baseline health and velocity for the broader Conflux ecosystem native stables.

---

## ⚡ Conflux Integration
**How does Realyx leverage Conflux features?**

- [x] **eSpace** - All core smart contracts (`TradingCore`, `VaultCore`, `Insurance`) are natively deployed and highly optimized for Conflux eSpace to take advantage of EVM compatibility. By deploying on eSpace, Realyx effortlessly supports MetaMask/Fluent wallets and ensures maximum smart contract testability via Hardhat tooling frameworks.
- [x] **Pyth Network** - Native integration with Pyth Network’s pull-based oracle system. This allows the protocol to update prices sub-second directly during trade execution blocks, securing Realyx against front-running and ensuring our index prices mirror Binance/Nasdaq flawlessly.
- [x] **Other** - Built robustly with a custom native PostgreSQL EVM Web3 Indexer running on an Express Node.js backbone. The indexer strictly listens to Conflux eSpace `blocks` and `logs` to populate our SQL environment in real-time.

---

## 🌟 Feature Capabilities

### Core Features
- **NFT Position Tokenization (Transferable Trades):** In a massive leap for DeFi composability, Realyx wraps every open leveraged trade into an official ERC-721 NFT (`PositionToken.sol`). This allows traders to seamlessly transfer, gift, or recursively collateralize their active perpetual positions across standard Web3 ecosystems exactly as they would any standard NFT infrastructure!
- **Advanced Vault Core System:** A highly resilient share-based accounting mechanism (`VaultCore.sol`). When LPs deposit stablecoins, they dynamically mint `realyxLP` utility tokens. These tokens represent fractional ownership of the entire Vault's collateral pool, structurally guaranteed to track intrinsic protocol profit accrued from trader liquidations, borrow fees, and swap expenses over time.
- **Safety-First Insurance Backstop System:** Built to absorb systemic tail-risk events. If traders experience immense, catastrophic PnL inversions (e.g. flash-crashes) that would otherwise drain the main liquidity Vault, the explicitly deployed `InsuranceFund.sol` automatically shoulders the bad debt. Insurance stakers earn premium yield in exchange for acting as the protocol's first line of systemic defense.
- **Global Markets Access:** Trade Crypto, Equities, Commodities, and Forex seamlessly across one decentralized interface.
- **Dynamic Funding Rates:** Math-driven constant-product algorithms calculate hourly funding fee adjustments to balance long and short skewed demands organically.

### Advanced Features
- **Strict Security Parameters:** Unprecedented user security controls including hyper-strict max slippage bounding, isolated margin execution isolating portfolio risk entirely to singular positions, and Keeper-validated timestamps overriding stale oracle reads.
- **Dynamic Liquidation Engine:** Configurable liquidation threshold structures ensuring vault solvency continuously.
- **Interactive Analytics:** Real-time charting configurations via TradingView Lightweight Charts, TVL history curves, and Top Trader Leaderboards based on PnL mapping.
- **Live Triggers Mechanism:** Set and forget Advanced Take-Profit (TP), Stop-Loss (SL), and Trailing Limit bounds integrated deeply at the smart contract EVM level.

### Future Features (Roadmap)
- **AxCNH and USDT0 Collaterals** - Deep integration to accept multiple conflux native stable/crypto-bridge utilities as underlying collateral.
- **Social Copy Trading** - Allow retail users to auto-mirror top leaderboard ranks intent flows.
- **Cross-Margin Architecture** - Realyx currently uses Isolated Margin. We plan to build Cross Margin where an entire portfolio balance offsets liquidation risks.

---

## 🛠️ Technology Architecture

### Stack Elements
- **Frontend**: React 18, Vite, Tailwind CSS, Zustand Storing, Framer Motion (Transitions), Wagmi, Viem, RainbowKit, Lucide-React.
- **Backend Listener**: Context-aware Node.js Runtime.
- **Database Indexing**: PostgreSQL 16 directly mapped via node-pg to EVM `getLogs` polling routines.
- **Network**: Conflux eSpace Testnet (Mainnet soon) built via Solidity 0.8.24.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React/Vite)                           │
│  Markets | Trading | Portfolio | Vault | Insurance | Analytics | Settings    │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │ REST API / WebSockets
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (Express Node)                          │
│  Event Poller | Market Aggregator | Stat Cruncher | Trigger Evaluator        │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │ SQL + RPC ABI Interactions
         ┌───────────────────────────────┼───────────────────────────────┐
         ▼                               ▼                               ▼
┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
│ NATIVE INDEXER  │           │  PYTH NETWORK   │           │ KEEPER NODES     │
│  (PostgreSQL)   │           │ (Hermes API API)│           │ (Chron Jobs)    │
│ Persists State  │           │ Fetches TWAPs   │           │ Executes Intents │
└────────┬────────┘           └─────────────────┘           └─────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CHAIN (Conflux eSpace Testnet)                          │
│  TradingCore | VaultCore | OracleAggregator | PositionToken | MockUSDC       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📋 Prerequisites
Before you begin, ensure you have the following installed:

- **Node.js** (v18.0.0 or higher) - Runtime execution.
- **Git** - Version control handling.
- **Conflux Wallet** ([Fluent Wallet](https://fluentwallet.com/) or [MetaMask](https://metamask.io/) configured for eSpace connection).
- **Docker** - For completely containerizing the backend PostGres & Redis configurations instantly.

---

## 📦 Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/AmirMP12/realyx-perp-conflux.git
cd realyx-perp-conflux
```

### 2. Install Sub-Workspace Dependencies
We utilize npm workspaces for monorepo efficiency.
```bash
npm install
npm install --workspace backend
npm install --workspace frontend
```

### 3. Environment & Secrets Configuration
You must configure your `.env` variables cleanly!
```bash
# Core root deployment variables (For Hardhat)
cp .env.example .env

# Backend runtime environment
cp backend/.env.example backend/.env

# Frontend API mappings
cp frontend/.env.example frontend/.env
```
Inside your `frontend/.env`, ensure WalletConnect IDs and smart contract addresses match the newly deployed states:
```env
# Example Testnet Configs
VITE_API_URL=http://localhost:3001/api
VITE_RPC_URL=https://evmtestnet.confluxrpc.com
VITE_TRADING_CORE_ADDRESS=0x64f277f73bfc81Ad80286a4266c0E0613d867Df3
VITE_CHAIN_ID=71
```

### 4. Smart Contract Deployment Simulation
```bash
# Compile contracts utilizing Solidity 0.8.24
npm run compile

# Target deployment towards Conflux eSpace testnet
npm run deploy:conflux-testnet

# Optionally verify contracts against ConfluxScan
npm run verify:conflux-testnet
```

### 5. Start Full Development Environment
We highly recommend running the backend stack purely through our minimal Docker compose to ignore manual Postgres tooling installs.
```bash
# Start Dockerized application instantly (Spin up API, Frontend, Database, Indexer)
docker-compose -f docker-compose.minimal.yml up -d
```
The React frontend should now be hot bound running robustly at `http://localhost:3000`.

---

## 🧪 Testing and Validations
Run comprehensive component tests across all layers of the stack:

```bash
# Execute deeply integrated hardhat smart contract test scenarios
npm run test

# Run backend event ingestion logic testing and REST API verification
cd backend && npm test

# Run frontend UI component mounting lifecycle testing
cd frontend && npm test
```

### Test Coverage Reporting
To generate code-level coverage graphs highlighting edge case penetrations via istanbul:
```bash
npx hardhat coverage
```

---

## 🎮 Getting Started Workflows

### 1. Account Initialization setup
- Open the application locally or navigate to the hosted demo link.
- Click the glowing primary **Connect Wallet** button on the top right header.
- Select your primary wallet (MetaMask) and physically ensure your RPC is mapped to `Conflux eSpace Testnet (Network ID: 71)`.
- If you lack native `$CFX`, utilize the [Conflux eSpace testnet faucet](https://evmtestnet.confluxscan.org/faucet).

### 2. Minting Testnet Portfolio Collateral
Realyx operates totally independent of AMMs relying on standard USDC balances. 
- Click the **Settings Gear** navigation element.
- Enter the **Testnet Tools** view.
- Click **"Mint 1k Mock USDC"** and sign the incoming wallet action.

---

## 🌊 Example Operational Workflows

#### Workflow 1: Committing a Margin Long Trading Intent
```text
1. Select the "Markets" left-navigation panel and parse the Crypto List for "CFX/USD".
2. On the trade view, select the "Long" toggle.
3. Input 100 USDC in the strictly validated Collateral field.
4. Drag the visual slider to format the Margin Multiplier to max (10.0x Leverage).
   -> Note: Observe the Order Notional Size visually scale to exactly 1000 USDC.
5. Click "Submit Long Order CFX".
6. Your wallet will prompt an asynchronous transaction ensuring your 100 USDC is committed to the Vault securely.
7. Within ~3 seconds, observe the "Positions" table at the bottom of the interface instantly refresh tracking your Live PnL mapped dynamically via Websockets!
```

#### Workflow 2: Depositing Vault Counterparty Liquidity
```text
1. Navigate directly to the 'Vault' navigation tab in the App Header.
2. Locate the comprehensive TVL and Profit charts for the master USDC Vault ecosystem.
3. Scroll to the "Deposit / Withdraw" action zone and enter 500 USDC.
4. Finalize the "Deposit Liquidity" transaction payload.
5. You instantly mint representative shares of the `realyxLP` utility token to your account index tracking Vault profitability intrinsically.
```

---

## 📺 Demo Showcases

- **🌍 Live Conflux eSpace Hosted Demo:** [Realyx Platform](https://realyx.vercel.app/)
- **🎥 Official Walkthrough Demo:** [Watch the walkthrough](https://youtube.com)
- **⏱️ Duration:** [3 minutes]

---

## 📜 Complete Contract Documentation

### Conflux eSpace Deployed Identifiers (Testnet v1)
| Primary Infrastructure | Contract Address | Conflux Explorer Transparency Link |
|-------------------------|-------------------|--------------------------------------|
| **TradingCore Node** | `0x64f277f73bfc81Ad80286a4266c0E0613d867Df3` | [View Core Engine Matrix on ConfluxScan](https://evmtestnet.confluxscan.net/address/0x64f277f73bfc81Ad80286a4266c0E0613d867Df3) |
| **VaultCore Liquidity**| `0xB5C983d038caA21f4a9520b0EFAb2aD71DE4e714` | [View Vault State on ConfluxScan](https://evmtestnet.confluxscan.net/address/0xB5C983d038caA21f4a9520b0EFAb2aD71DE4e714) |
| **ERC721 PositionToken**| `0x4368b5741A105c1ACE50ad98581fDa050685fa8B` | [View Token Tracker on ConfluxScan](https://evmtestnet.confluxscan.net/address/0x4368b5741A105c1ACE50ad98581fDa050685fa8B) |

### Functional Protocol Interfaces

#### `ITradingCore.sol` Example
We structure our core execution paths utilizing minimal surface area state manipulators. This includes dynamic execution triggers based completely on pending intent structures validated by Keeper price aggregation logic against Pyth bounds.

```solidity
interface ITradingCore {
    // Stage 1: Collateral locked in intent queue
    function createOrder(
        address market,
        uint256 size,
        uint256 collateral,
        uint256 leverage,
        bool isLong,
        OrderType orderType,
        uint256 triggerPrice,
        uint256 maxSlippageBps
    ) external;
    
    // Stage 2: Keeper execution block 
    function executeOrder(uint256 orderId, bytes[] calldata priceUpdateData) external payable;
    
    // Dynamic boundary limits scaling capabilities
    function setTriggerOrders(uint256 positionId, uint256 sl, uint256 tp, uint256 trailingStop) external;
}
```

---

## 🔌 API Ecosystem Breakdown

The Realyx Node indexer provisions ultra-high volume REST capabilities allowing power-users and institutional market makers to scrape and interact effectively.

### Core Data Delivery
#### Authentication:
The entire REST API remains strictly permissionless mirroring the ethos of the on-chain counterpart.

#### Representative Core Responses (GET `api/stats` Payload):
```json
{
  "status": "success",
  "data": {
    "totalVolume": 4529000,
    "totalOpenInterest": 1250000,
    "liquidations24H": 4,
    "systemHealthFactor": "0.9999",
    "vaultUtilizationRate": "45.2%"
  }
}
```

#### Detailed Contract Data Maps
```bash
# Query master statistics 
GET    /api/stats

# Fetch heavily formatted full database indexer market parameters
GET    /api/markets

# Track specific EVM user margin states mapped internally over JSON boundaries 
GET    /api/user/:address/positions

# Pull raw transactional historical action sequences limited chronologically 
GET    /api/user/:address/trades?limit=50
```

### WebSocket Streaming
For high frequency interface adjustments, the backend pushes tick level sub-second differentials heavily via lightweight raw payloads across natively configured websocket buffers on Node `ws`.

```javascript
// Example Client Connection 
const ws = new WebSocket('ws://localhost:3002');

ws.on('message', (msg) => {
    const data = JSON.parse(msg);
    if(data.type === 'PRICE_UPDATE') {
       // PnL components re-evaluate synchronously here natively against active POS arrays
       updateInterfacePrices(data.payload);
    }
});
```

---

## 🔒 Security Posture

### Preventative Security Measures
- **Two-Phase Commit Order Structure (Intents):** By stripping users' abilities to natively execute immediate AMM market swaps directly based on chain state, we unequivocally destroy all theoretical front-running, price slippage sandwiches, and flash loan attacks.
- **Oracle Slippage & Validation Logic:** Incoming Pyth execution payloads strictly validate timestamps, ensuring `block.timestamp` deviates favorably relative to strict contract constraints. Extremely stale updates explicitly revert the protocol blocking zero-day extraction hacks.
- **Parametric Constraints Constraints:** Smart contracts statically validate minimum colateralizations, positional ceilings, maximum leveraged multipliers (10x Base), and prevent execution routing that directly crosses hard liquidation ceilings (preventing immediate liquidations).

### Known Security Considerations
- Testnets natively inherently present RPC fragility specifically related to Pyth public Hermes network configurations leading to unexpected oracle latency. On mainnet architectures, Pyth provisions exclusive deployment networks guaranteeing aggressive price fluidity unhindered by public testnet noise.
- Realyx enforces administrative overrides for adding additional underlying RWA markets, configuring funding velocities systematically.

### Current Edge Case Limitations
- **Issue 1:** Total protocol database synchronization heavily relies on a singular Postgres indexer. Under massive 20,000+ RPS node load on the underlying testnet Conflux EVM state mapping APIs, transient database lag may occur generating minor frontend portfolio staleness.
- **Issue 2:** The isolated model does not automatically calculate risk adjustments across completely independent positions currently.

---

## 🛣️ Phased Roadmap

**Phase 1 (Hackathon Global HackFest 2026)** ✅
- [x] Initial design vectoring and complex mathematical derivation plotting for Vault structures.
- [x] Hardhat core smart contract implementation and aggressive local validations running 100+ tests natively.
- [x] Comprehensive Postgres indexer data digestion methodologies setup tracking 15+ complex EVM emit states.
- [x] WebUI implementation (Settings, Analytics, Trade logic execution frameworks) deployment formatting securely.

**Phase 2 (Post-Hackathon)**
- [ ] Tier-1 Full-Stack independent structural contract security auditing validations.
- [ ] Conflux eSpace Global Mainnet Launch provisioning targeting heavy early-adoptor liquidity mining.
- [ ] Multi-chain token integrations natively accepting standard stable utilities (USDT0/AxCNH).

**Phase 3 (Future Scale)**
- [ ] Execution implementation for complex Cross-Margin isolation.
- [ ] Smart-Contract governed Social Copy Trading indexing allowing automated intent mirroring.
- [ ] Deployed standalone containerized Keeper nodes allowing anybody to algorithmically execute trades to earn native execution Bounties.

---

## 🤝 Open Contributions Ecosystem

We heavily encourage external analysis and open-source contributions to our execution stacks. Please parse the generic [Contributing Guidelines](CONTRIBUTING.md) structurally determining code paradigms, PR evaluation standards, and open bounties.

### Standard Development Process
1. Fork the baseline target application repository actively.
2. Initialize and deploy an isolated feature branch matrix (`git checkout -b feature/dynamic-vault-metrics`).
3. Commit validated alterations comprehensively documented (`git commit -m 'Added dynamic Vault UI elements'`).
4. Push heavily towards origin states (`git push origin feature/dynamic-vault-metrics`).
5. Open an official Pull Request!

---

## ⚖️ Operational Licensing

This system actively inherits the massive decentralization frameworks available openly via the core MIT License matrix formats globally. Evaluate the core [LICENSE](LICENSE) mapping specific derivations!

---

## 🙏 Gracious Acknowledgments

- **Conflux Global Hackfest Network Initiative** - For fundamentally hosting an incredible boundary-pushing event!
- **Conflux Foundation Stack Teams** - For extreme infrastructural support, explicit technical documentation structures parsing eSpace compatibilities, and high mentorship outputs.
- **Open-source Communities** - Your relentless bug testing flows massively helped!

### Supported Utilizing Frameworks
- **[Pyth Network]** - The core baseline defining next-generation latency mechanisms.
- **[Wagmi.sh / Viem.sh]** - React hooks natively making UI structural elements incredibly capable across raw TS logic.

---

## 📞 Connectivity & Support Vectors

- **Core Tracker Issues:** [GitHub Repository Bug Reporting Tracking](https://github.com/AmirMP12/realyx-perp-conflux/issues)
- **Direct Lead Contact (Discord):** `amp1212`
- **Primary Source Link:** [AmirMP12/realyx-perp-conflux Baseline](https://github.com/AmirMP12/realyx-perp-conflux)
- **Execution URL Environment:** [Realyx Network Live Configurations](https://realyx.vercel.app/)

---

  <b>Built relentlessly with ❤️ for Conflux Global Hackfest 2026</b><br/><br/>
  <i>Incredible technologies originate collectively. We deeply hope Realyx drives profound innovative utilities towards Conflux Network ecosystem scale formats indefinitely!</i>
</div>
