/* ===== REALYX DOCS — app.js ===== */
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// PAGE CONTENT — defined first so navigate() can reference PAGES safely
// ─────────────────────────────────────────────────────────────────────────────
const PAGES = {};

PAGES['home'] = () => `
<div class="home-hero">
  <div class="home-hero__eyebrow">
    <span class="badge badge--purple">v1.0.0</span>
    <span class="badge badge--green">Testnet Live</span>
  </div>
  <h1 class="home-hero__title">Realyx<br><span class="gradient">Documentation</span></h1>
  <p class="home-hero__desc">Realyx is a decentralized perpetual futures exchange for Real World Assets, built on Conflux eSpace. Trade crypto, equities, and commodities with up to 10x leverage — non-custodial, zero KYC, MEV-resistant.</p>
  <div class="home-hero__actions">
    <a href="https://realyx.vercel.app/" target="_blank" rel="noopener" class="btn-primary">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      Launch App
    </a>
    <button class="btn-secondary" onclick="navigate('quick-start')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
      Quick Start
    </button>
  </div>
</div>
<div class="stats-row">
  <div class="stat-card"><div class="stat-card__value">10x</div><div class="stat-card__label">Default Max Leverage</div></div>
  <div class="stat-card"><div class="stat-card__value">8h</div><div class="stat-card__label">Funding Interval</div></div>
  <div class="stat-card"><div class="stat-card__value">&lt;3s</div><div class="stat-card__label">Order Execution</div></div>
  <div class="stat-card"><div class="stat-card__value">71</div><div class="stat-card__label">Conflux Testnet Chain ID</div></div>
</div>
<h2>Where to start</h2>
<div class="card-grid">
  <div class="card" onclick="navigate('what-is-realyx')"><div class="card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></div><div class="card__title">What is Realyx?</div><div class="card__desc">Understand the protocol, its purpose, and how it differs from other DEXs.</div></div>
  <div class="card" onclick="navigate('quick-start')"><div class="card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg></div><div class="card__title">Quick Start</div><div class="card__desc">Get the full development environment running in minutes with Docker.</div></div>
  <div class="card" onclick="navigate('first-trade')"><div class="card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div><div class="card__title">Your First Trade</div><div class="card__desc">Step-by-step guide to opening your first leveraged position on Realyx.</div></div>
  <div class="card" onclick="navigate('api-reference')"><div class="card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 2 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></div><div class="card__title">API Reference</div><div class="card__desc">REST endpoints, WebSocket channels, and contract interfaces.</div></div>
  <div class="card" onclick="navigate('smart-contracts')"><div class="card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div class="card__title">Smart Contracts</div><div class="card__desc">Deployed addresses, interfaces, and on-chain architecture.</div></div>
  <div class="card" onclick="navigate('contributing')"><div class="card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div><div class="card__title">Contributing</div><div class="card__desc">How to contribute code, documentation, or bug reports.</div></div>
</div>
<h2>Network &amp; Contracts</h2>
<table>
  <thead><tr><th>Contract</th><th>Address</th><th>Explorer</th></tr></thead>
  <tbody>
    <tr><td>TradingCore</td><td><code>0x64f277...7Df3</code></td><td><a href="https://evmtestnet.confluxscan.org/address/0x64f277f73bfc81Ad80286a4266c0E0613d867Df3" target="_blank">ConfluxScan ↗</a></td></tr>
    <tr><td>VaultCore</td><td><code>0xB5C983...4e714</code></td><td><a href="https://evmtestnet.confluxscan.org/address/0xB5C983d038caA21f4a9520b0EFAb2aD71DE4e714" target="_blank">ConfluxScan ↗</a></td></tr>
    <tr><td>PositionToken</td><td><code>0x4368b5...fa8B</code></td><td><a href="https://evmtestnet.confluxscan.org/address/0x4368b5741A105c1ACE50ad98581fDa050685fa8B" target="_blank">ConfluxScan ↗</a></td></tr>
  </tbody>
</table>
<p style="font-size:13px;color:var(--text-3)">Network: Conflux eSpace Testnet &middot; Chain ID: 71 &middot; RPC: <code>https://evmtestnet.confluxrpc.com</code></p>
<div class="callout callout--warning"><div class="callout__icon">⚠️</div><div class="callout__body"><div class="callout__title">Risk disclosure</div><p>Realyx is experimental, derivatives-adjacent software currently deployed on Conflux eSpace Testnet only. Nothing in this documentation is financial advice. Trading perpetual futures with leverage carries material smart-contract, oracle, liquidation, and jurisdictional risk, and you can lose more than your initial collateral. Liquidity provider yields are variable, not guaranteed, and depend on net trader PnL and protocol activity. The protocol has not yet undergone a third-party security audit.</p></div></div>
<h2>Community</h2>
<div class="card-grid">
  <a class="card card--link" href="https://x.com/Realyx_Perp" target="_blank" rel="noopener">
    <div class="card__icon"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M18.244 2H21l-6.51 7.435L22 22h-6.563l-5.142-6.72L4.5 22H1.74l6.96-7.954L1 2h6.706l4.65 6.144L18.244 2zm-1.156 18h1.84L7.005 4H5.06l12.028 16z"/></svg></div>
    <div class="card__title">X (Twitter)</div>
    <div class="card__desc">Follow <strong>@Realyx_Perp</strong> for product updates and ecosystem news.</div>
  </a>
  <a class="card card--link" href="https://t.me/Real_yx" target="_blank" rel="noopener">
    <div class="card__icon"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M22 2L2 10.4l5.4 1.9L18 5l-8.4 8.7L9.2 19 12 16l4.4 3.5c.5.4 1.2.2 1.4-.4L22 2z"/></svg></div>
    <div class="card__title">Telegram Channel</div>
    <div class="card__desc">Announcements-only channel: releases, deployments, and incident notes.</div>
  </a>
  <a class="card card--link" href="https://t.me/realyx_perp" target="_blank" rel="noopener">
    <div class="card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
    <div class="card__title">Telegram Group</div>
    <div class="card__desc">Open community chat for questions, feedback, and trading discussion.</div>
  </a>
  <a class="card card--link" href="https://github.com/AmirMP12/realyx-perp-conflux" target="_blank" rel="noopener">
    <div class="card__icon"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg></div>
    <div class="card__title">GitHub</div>
    <div class="card__desc">Source code, issue tracker, and security advisories.</div>
  </a>
</div>
`;

PAGES['what-is-realyx'] = () => `
<div class="page-header">
  <div class="page-header__eyebrow">Getting Started</div>
  <h1 class="page-header__title">What is Realyx?</h1>
  <p class="page-header__desc">A decentralized perpetual futures exchange for Real World Assets and crypto, built on Conflux eSpace.</p>
</div>
<p>Realyx is an <strong>intent-based perpetual futures DEX</strong> deployed on Conflux eSpace. It lets traders open leveraged long and short positions on RWA markets — stocks, commodities, forex — and crypto pairs from a single unified interface, while liquidity providers earn real yield by acting as the counterparty through a shared stablecoin vault.</p>
<div class="callout callout--info"><div class="callout__icon">ℹ️</div><div class="callout__body"><div class="callout__title">Currently on Testnet</div><p>Realyx is deployed on Conflux eSpace Testnet (Chain ID 71). No real funds are at risk. Mainnet launch is planned for Phase 2.</p></div></div>
<h2>The problem Realyx solves</h2>
<p>Financial globalization is fragmented. Centralized platforms gatekeep access to global equities through geographical barriers, account minimums, and KYC hurdles. DeFi platforms have historically been limited to crypto assets due to oracle latency and front-running vulnerabilities.</p>
<ul>
  <li><strong>Siloed liquidity</strong> — A trader wanting to long Tesla and short Bitcoin must use separate platforms. Realyx unifies both in one margin account.</li>
  <li><strong>Custodial risk</strong> — Most low-latency perp platforms require depositing funds into centralized custodians. Realyx is fully non-custodial.</li>
  <li><strong>AMM inefficiency</strong> — Traditional on-chain derivatives use x*y=k pools, causing impermanent loss for LPs. Realyx uses a vault counterparty model instead.</li>
</ul>
<h2>How it works</h2>
<div class="steps">
  <div class="step-item"><div class="step-num">1</div><div class="step-body"><h3>Submit signed intent</h3><p>You place an order by submitting a signed intent. Collateral is locked in the smart contract, but the order isn't executed yet.</p></div></div>
  <div class="step-item"><div class="step-num">2</div><div class="step-body"><h3>Keeper fetches fresh oracle price</h3><p>Decentralized Keeper nodes monitor the blockchain for pending intents and fetch the latest signed price data from Pyth Network's Hermes API.</p></div></div>
  <div class="step-item"><div class="step-num">3</div><div class="step-body"><h3>Atomic execution eliminates MEV</h3><p>The Keeper submits a single transaction that updates the oracle price and executes your order atomically. No front-running possible.</p></div></div>
  <div class="step-item"><div class="step-num">4</div><div class="step-body"><h3>Vault acts as counterparty</h3><p>Your position is backed by the shared USDC vault. If you profit, the vault pays out. LPs earn fees from this activity.</p></div></div>
</div>
<h2>What makes Realyx different</h2>
<table>
  <thead><tr><th>Feature</th><th>Realyx</th><th>Typical Perp DEX</th></tr></thead>
  <tbody>
    <tr><td>Pricing</td><td>Oracle-based (Pyth)</td><td>AMM or orderbook</td></tr>
    <tr><td>MEV protection</td><td>Intent-based two-phase commit</td><td>Vulnerable to front-running</td></tr>
    <tr><td>LP risk</td><td>No impermanent loss</td><td>Impermanent loss possible</td></tr>
    <tr><td>Positions</td><td>ERC-721 NFT (transferable)</td><td>Internal ledger entry</td></tr>
    <tr><td>Markets</td><td>Crypto + Equities + Commodities</td><td>Crypto only</td></tr>
    <tr><td>KYC</td><td>None required</td><td>Often required</td></tr>
  </tbody>
</table>
<h2>Supported markets</h2>
<ul>
  <li><strong>Crypto:</strong> CFX-USD, BTC-USD, ETH-USD</li>
  <li><strong>Tokenized equities:</strong> TSLAX-USD, NVDAX-USD, AAPLX-USD, METAX-USD, GOOGLX-USD, NFLXX-USD, COINX-USD, MCDX-USD, CRCLX-USD</li>
  <li><strong>Tokenized commodities:</strong> XAUT-USD (Tether Gold)</li>
</ul>
<p>The full active set is defined per deployment in <code>scripts/setup-market.ts</code> and surfaced by <code>GET /api/markets</code>.</p>
`;

PAGES['key-features'] = () => `
<div class="page-header">
  <div class="page-header__eyebrow">Getting Started</div>
  <h1 class="page-header__title">Key Features</h1>
  <p class="page-header__desc">A complete perpetual futures protocol with institutional-grade infrastructure.</p>
</div>
<h2>NFT Position Tokens</h2>
<p>Every open leveraged trade is wrapped as an <strong>ERC-721 NFT</strong> via <code>PositionToken.sol</code>. Transfer, sell, gift, or collateralize your active positions across any Web3 ecosystem.</p>
<h2>Shared Liquidity Vault</h2>
<p>LPs deposit USDC into <code>VaultCore.sol</code> and receive <code>realyxLP</code> share tokens. The vault acts as counterparty to all trades. LPs earn from trading fees, borrow fees, funding rates, and liquidation penalties — with no impermanent loss.</p>
<h2>MEV-Resistant Intent Execution</h2>
<p>Two-phase commit makes front-running structurally impossible. Phase 1: <code>createOrder()</code> locks collateral. Phase 2: Keeper fetches fresh Pyth price and executes atomically. The execution price is determined at execution time, not submission time.</p>
<h2>Insurance Fund</h2>
<p>A dedicated USDC pool within <code>VaultCore</code> absorbs bad debt in extreme market conditions before the main LP pool is affected. Insurance stakers earn premium yield for providing this backstop.</p>
<h2>Advanced Order Types</h2>
<p>Stop-Loss, Take-Profit, and Trailing Stop are all enforced at the smart contract level — no off-chain dependency.</p>
<h2>Dynamic Funding Rates</h2>
<p>Funding rates are calculated algorithmically every 8 hours to keep perpetual prices anchored to spot. When long OI exceeds short, longs pay shorts, and vice versa.</p>
<h2>Pyth Network Oracle Integration</h2>
<p>Pull-based oracle model — prices are only updated on-chain when needed (at order execution). The <code>OracleAggregator</code> validates freshness, confidence intervals, and circuit breaker conditions.</p>
`;

PAGES['quick-start'] = () => `
<div class="page-header">
  <div class="page-header__eyebrow">Getting Started</div>
  <h1 class="page-header__title">Quick Start</h1>
  <p class="page-header__desc">Get the full Realyx development environment running in minutes.</p>
</div>
<div class="callout callout--warning"><div class="callout__icon">⚠️</div><div class="callout__body"><div class="callout__title">Prerequisites</div><p>You need <strong>Node.js v18+</strong>, <strong>Git</strong>, and <strong>Docker</strong> installed before proceeding.</p></div></div>
<h2>1. Clone &amp; Install</h2>
<pre><code>git clone https://github.com/AmirMP12/realyx-perp-conflux.git
cd realyx-perp-conflux
npm install</code></pre>
<h2>2. Configure Environment</h2>
<pre><code>cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env</code></pre>
<table>
  <thead><tr><th>File</th><th>Variable</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>.env</code></td><td><code>PRIVATE_KEY</code></td><td>Deployer wallet private key</td></tr>
    <tr><td><code>backend/.env</code></td><td><code>POSTGRES_URL</code></td><td>PostgreSQL connection string</td></tr>
    <tr><td><code>backend/.env</code></td><td><code>ENABLE_WS</code></td><td><code>true</code> local, <code>false</code> Vercel</td></tr>
    <tr><td><code>frontend/.env</code></td><td><code>VITE_API_URL</code></td><td>Backend API base URL</td></tr>
    <tr><td><code>frontend/.env</code></td><td><code>VITE_CHAIN_ID</code></td><td><code>71</code> for testnet</td></tr>
  </tbody>
</table>
<h2>3. Compile Smart Contracts</h2>
<pre><code>npm run compile</code></pre>
<h2>4. Launch Full Stack with Docker</h2>
<pre><code>docker-compose -f docker-compose.minimal.yml up -d</code></pre>
<table>
  <thead><tr><th>Service</th><th>URL</th></tr></thead>
  <tbody>
    <tr><td>Frontend</td><td><code>http://localhost:3000</code></td></tr>
    <tr><td>Backend API</td><td><code>http://localhost:3001/api</code></td></tr>
    <tr><td>WebSocket</td><td><code>ws://localhost:3002</code></td></tr>
  </tbody>
</table>
<h2>Manual development mode</h2>
<pre><code>docker-compose up -d postgres
cd backend && npm run dev
cd frontend && npm run dev   # → http://localhost:5173</code></pre>
`;

PAGES['first-trade'] = () => `
<div class="page-header">
  <div class="page-header__eyebrow">Getting Started</div>
  <h1 class="page-header__title">Your First Trade</h1>
  <p class="page-header__desc">Step-by-step guide to opening your first leveraged position on Realyx testnet.</p>
</div>
<div class="callout callout--success"><div class="callout__icon">✅</div><div class="callout__body"><div class="callout__title">No real funds required</div><p>Realyx runs on Conflux eSpace Testnet. All tokens are free test tokens with no real value.</p></div></div>
<h2>Step 1: Connect your wallet</h2>
<div class="steps">
  <div class="step-item"><div class="step-num">1</div><div class="step-body"><h3>Install MetaMask or Fluent Wallet</h3><p>Any EVM-compatible wallet works. MetaMask is recommended.</p></div></div>
  <div class="step-item"><div class="step-num">2</div><div class="step-body"><h3>Add Conflux eSpace Testnet</h3><table><tbody><tr><td><strong>RPC URL</strong></td><td><code>https://evmtestnet.confluxrpc.com</code></td></tr><tr><td><strong>Chain ID</strong></td><td><code>71</code></td></tr><tr><td><strong>Currency</strong></td><td>CFX</td></tr></tbody></table></div></div>
  <div class="step-item"><div class="step-num">3</div><div class="step-body"><h3>Get testnet CFX for gas</h3><p>Visit the <a href="https://evmtestnet.confluxscan.org/faucet" target="_blank">Conflux eSpace faucet</a> and request free CFX.</p></div></div>
  <div class="step-item"><div class="step-num">4</div><div class="step-body"><h3>Connect wallet on Realyx</h3><p>Open <a href="https://realyx.vercel.app/" target="_blank">realyx.vercel.app</a> and click Connect Wallet.</p></div></div>
</div>
<h2>Step 2: Mint testnet USDC</h2>
<ol>
  <li>Click the <strong>Settings</strong> gear icon</li>
  <li>Navigate to <strong>Testnet Tools</strong></li>
  <li>Click <strong>"Mint 1k Mock USDC"</strong> and confirm in your wallet</li>
</ol>
<h2>Step 3: Open a long position</h2>
<ol>
  <li>Navigate to the <strong>Markets</strong> tab and select <strong>CFX/USD</strong></li>
  <li>Choose <strong>Long</strong></li>
  <li>Enter <strong>100 USDC</strong> collateral and set <strong>5x</strong> leverage</li>
  <li>Click <strong>"Open Long Position"</strong> and confirm in your wallet</li>
</ol>
<div class="callout callout--info"><div class="callout__icon">ℹ️</div><div class="callout__body"><div class="callout__title">Two transactions</div><p>You'll sign two transactions: one to approve USDC spending, and one to submit the order intent. The Keeper executes within ~3 seconds.</p></div></div>
<h2>Step 4: Monitor &amp; close</h2>
<p>Your position appears in the <strong>Portfolio</strong> tab with live PnL via WebSocket. Click <strong>Close</strong> to exit and receive your USDC ± PnL back to your wallet.</p>
`;

PAGES['how-it-works'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Core Concepts</div><h1 class="page-header__title">How It Works</h1><p class="page-header__desc">The complete lifecycle of a trade on Realyx — from intent to settlement.</p></div>
<h2>The intent-based model</h2>
<p>Traditional DEXs execute trades immediately against on-chain state, creating MEV opportunities. Realyx separates <em>intent submission</em> from <em>execution</em>:</p>
<pre><code>// Phase 1: Trader submits intent (collateral locked)
createOrder(market, collateral, leverage, isLong)

// Phase 2: Keeper executes with fresh oracle price
executeOrder(orderId, pythPriceUpdateData)</code></pre>
<h2>Order lifecycle</h2>
<div class="steps">
  <div class="step-item"><div class="step-num">1</div><div class="step-body"><h3>Order Created</h3><p>Trader calls <code>TradingCore.createOrder()</code>. USDC collateral is transferred to the contract. An <code>OrderCreated</code> event is emitted.</p></div></div>
  <div class="step-item"><div class="step-num">2</div><div class="step-body"><h3>Indexer Detects Event</h3><p>The PostgreSQL indexer polls <code>getLogs</code> from Conflux eSpace and persists the order. The WebSocket server broadcasts the pending order to connected clients.</p></div></div>
  <div class="step-item"><div class="step-num">3</div><div class="step-body"><h3>Keeper Fetches Price</h3><p>The Keeper bot detects the pending order and calls Pyth's Hermes API to fetch a signed VAA containing the latest price data.</p></div></div>
  <div class="step-item"><div class="step-num">4</div><div class="step-body"><h3>Atomic Execution</h3><p>The Keeper calls <code>TradingCore.executeOrder(orderId, priceUpdateData)</code>. In a single transaction: oracle is updated, order is validated, position is opened.</p></div></div>
  <div class="step-item"><div class="step-num">5</div><div class="step-body"><h3>Position Opens</h3><p><code>PositionToken</code> mints an ERC-721 NFT to the trader. <code>VaultCore</code> records the borrowed notional. A <code>PositionOpened</code> event is emitted.</p></div></div>
  <div class="step-item"><div class="step-num">6</div><div class="step-body"><h3>Frontend Updates</h3><p>The WebSocket server pushes the new position state to the frontend. The UI re-renders with live PnL tracking.</p></div></div>
</div>
<h2>Funding rate settlement</h2>
<p>Every 8 hours, funding rates are settled per market. If long OI &gt; short OI: longs pay shorts. If short OI &gt; long OI: shorts pay longs. Balanced markets have near-zero funding rates.</p>
`;

PAGES['vault-mechanics'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Core Concepts</div><h1 class="page-header__title">Vault Mechanics</h1><p class="page-header__desc">How the shared liquidity vault acts as counterparty to all trades.</p></div>
<h2>The vault counterparty model</h2>
<p>LPs deposit USDC into <code>VaultCore</code>. The vault collectively takes the opposite side of every trade. If traders lose, the vault profits; if traders win, the vault pays out. LPs earn fees regardless of individual trade outcomes.</p>
<h2>LP share accounting</h2>
<p>VaultCore uses an ERC-4626-style share system:</p>
<pre><code>shares = deposit_amount x total_shares / total_assets</code></pre>
<p>When an LP deposits USDC, they receive <code>realyxLP</code> shares. The share price increases over time as the vault accumulates trading fees, borrow fees, funding payments, and liquidation penalties.</p>
<h2>Deposit</h2>
<pre><code>function deposit(uint256 assets, address receiver)
  external returns (uint256 shares);</code></pre>
<h2>Withdrawal</h2>
<pre><code>function withdraw(uint256 shares, address receiver, address owner)
  external returns (uint256 assets);</code></pre>
<p>Subject to available liquidity. Large withdrawals that exceed immediate liquidity are queued and processed when liquidity frees up.</p>
<h2>Borrow/repay cycle</h2>
<pre><code>// Position opens: 100 USDC collateral, 10x leverage
vault.borrow(1000 USDC, market, isLong)

// Position closes with +50 USDC profit
vault.repay(1000, market, isLong, +50)
// Vault receives 950 USDC back (1000 - 50 paid to trader)</code></pre>
<h2>Key metrics</h2>
<table>
  <thead><tr><th>Metric</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>totalAssets()</code></td><td>Total USDC managed</td></tr>
    <tr><td><code>getAvailableLiquidity()</code></td><td>USDC available for new borrows or withdrawals</td></tr>
    <tr><td><code>getUtilization()</code></td><td>Percentage of assets lent to open positions</td></tr>
    <tr><td><code>getLPSharePrice()</code></td><td>Current value of 1 LP share in USDC</td></tr>
  </tbody>
</table>
`;

PAGES['intent-execution'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Core Concepts</div><h1 class="page-header__title">Intent-Based Execution</h1><p class="page-header__desc">How Realyx eliminates MEV through a two-phase commit architecture.</p></div>
<h2>What is MEV?</h2>
<p>MEV (Miner Extractable Value) is profit extracted by block producers or bots by reordering, inserting, or censoring transactions. In traditional DEXs, a front-runner can see your pending trade and execute before you, getting a better price at your expense.</p>
<h2>The two-phase commit solution</h2>
<ul>
  <li><strong>Phase 1 (createOrder):</strong> You submit your intent. Collateral is locked. No price is specified — the execution price will be determined later.</li>
  <li><strong>Phase 2 (executeOrder):</strong> A Keeper fetches the freshest possible Pyth price and executes your order atomically. The oracle update and execution happen in the same transaction.</li>
</ul>
<p>A front-runner would need to predict the future oracle price to exploit this system — which is impossible.</p>
<h2>Keeper incentives</h2>
<p>Keepers are compensated with an <strong>execution fee</strong> paid by the trader. This fee covers the Keeper's gas costs plus a small profit margin. Anyone can run a Keeper node and earn these fees.</p>
<h2>Oracle validation</h2>
<p>The <code>OracleAggregator</code> contract validates every Pyth price update: staleness check, confidence interval, and circuit breaker conditions.</p>
`;

PAGES['funding-rates'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Core Concepts</div><h1 class="page-header__title">Funding Rates</h1><p class="page-header__desc">How perpetual prices stay anchored to spot through periodic funding payments.</p></div>
<h2>What are funding rates?</h2>
<p>Perpetual futures have no expiry date, so they need a mechanism to keep their price aligned with the underlying spot price. Funding rates are periodic payments between long and short position holders that create this alignment.</p>
<h2>How funding works on Realyx</h2>
<ul>
  <li>Funding is settled every <strong>8 hours</strong></li>
  <li>When longs dominate: longs pay shorts (discourages more longs)</li>
  <li>When shorts dominate: shorts pay longs (discourages more shorts)</li>
  <li>Balanced markets have near-zero funding rates</li>
</ul>
<p>Funding is accrued continuously and settled when positions are modified, closed, or the 8-hour window passes.</p>
`;

PAGES['liquidation'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Core Concepts</div><h1 class="page-header__title">Liquidation Engine</h1><p class="page-header__desc">How Realyx protects vault solvency through dynamic liquidation thresholds.</p></div>
<h2>What triggers liquidation?</h2>
<p>A position is liquidated when its <strong>health factor</strong> falls below the maintenance margin requirement. This happens when the mark price moves against your position far enough that your remaining collateral can no longer cover potential losses.</p>
<pre><code>health = (collateral + unrealized_pnl) / (notional x maintenance_margin_rate)</code></pre>
<h2>Liquidation process</h2>
<ol>
  <li>A Keeper detects that a position's health factor has fallen below the threshold</li>
  <li>The Keeper refreshes the oracle if needed (via <code>OracleAggregator.updatePrices</code>) and calls <code>TradingCore.liquidatePosition(positionId)</code></li>
  <li>The position is closed at the current oracle price</li>
  <li>A liquidation penalty is split between the Keeper (reward) and the vault (insurance)</li>
  <li>Any remaining collateral is returned to the trader</li>
</ol>
<h2>Avoiding liquidation</h2>
<ul>
  <li>Add collateral to increase your health factor</li>
  <li>Use lower leverage to give yourself more buffer</li>
  <li>Set a stop-loss order to exit before reaching the liquidation price</li>
</ul>
`;

PAGES['trading-guide'] = () => `
<div class="page-header"><div class="page-header__eyebrow">User Guides</div><h1 class="page-header__title">Trading Guide</h1><p class="page-header__desc">Everything you need to trade perpetual futures on Realyx.</p></div>
<h2>Opening a position</h2>
<ol>
  <li>Navigate to the <strong>Markets</strong> tab and select an asset pair</li>
  <li>Choose <strong>Long</strong> (price goes up) or <strong>Short</strong> (price goes down)</li>
  <li>Enter your collateral amount in USDC</li>
  <li>Set your leverage (1x–10x)</li>
  <li>Review the estimated entry price, liquidation price, and fees</li>
  <li>Click <strong>Open Position</strong> and confirm in your wallet</li>
</ol>
<div class="callout callout--warning"><div class="callout__icon">⚠️</div><div class="callout__body"><div class="callout__title">Higher leverage = higher risk</div><p>10x leverage means a 10% adverse price move will liquidate your position. Start with lower leverage until you're comfortable with the mechanics.</p></div></div>
<h2>Managing positions</h2>
<p>From the <strong>Portfolio</strong> tab you can:</p>
<ul>
  <li><strong>Add collateral</strong> — Deposit more USDC to improve your health factor</li>
  <li><strong>Close position</strong> — Exit at the current mark price and realize PnL</li>
  <li><strong>Set Stop-Loss</strong> — Automatically close if price moves against you</li>
  <li><strong>Set Take-Profit</strong> — Automatically close when you reach your target profit</li>
  <li><strong>Set Trailing Stop</strong> — Dynamic stop that follows price in the profitable direction</li>
</ul>
<h2>Understanding fees</h2>
<table>
  <thead><tr><th>Fee Type</th><th>When Charged</th></tr></thead>
  <tbody>
    <tr><td>Opening fee</td><td>When position opens (% of notional)</td></tr>
    <tr><td>Closing fee</td><td>When position closes (% of notional)</td></tr>
    <tr><td>Borrow fee</td><td>Per hour while open (% of notional)</td></tr>
    <tr><td>Funding rate</td><td>Every 8 hours (varies by market imbalance)</td></tr>
    <tr><td>Execution fee</td><td>Paid to Keeper (fixed CFX amount)</td></tr>
  </tbody>
</table>
<h2>Transferring positions</h2>
<p>Since every position is an ERC-721 NFT, you can transfer it like any other NFT. The new owner inherits all position parameters, collateral, and risk.</p>
`;

PAGES['providing-liquidity'] = () => `
<div class="page-header"><div class="page-header__eyebrow">User Guides</div><h1 class="page-header__title">Providing Liquidity</h1><p class="page-header__desc">Earn real yield by acting as counterparty to traders through the Realyx vault.</p></div>
<h2>How LPs earn yield</h2>
<p>When you deposit USDC into the vault, you become the collective counterparty to all traders. You earn from:</p>
<ul>
  <li><strong>Trading fees</strong> — A portion of every position open and close</li>
  <li><strong>Borrow fees</strong> — Charged hourly on all outstanding positions</li>
  <li><strong>Funding payments</strong> — Net flow from imbalanced markets</li>
  <li><strong>Liquidation penalties</strong> — A share of liquidation fees</li>
</ul>
<h2>Depositing</h2>
<ol>
  <li>Navigate to the <strong>Vault</strong> tab</li>
  <li>Enter the amount of USDC you want to deposit</li>
  <li>Click <strong>Deposit</strong> and confirm in your wallet</li>
  <li>You receive <code>realyxLP</code> share tokens representing your ownership of the vault</li>
</ol>
<h2>Withdrawing</h2>
<ol>
  <li>Navigate to the <strong>Vault</strong> tab</li>
  <li>Enter the number of <code>realyxLP</code> shares to redeem</li>
  <li>Click <strong>Withdraw</strong></li>
  <li>If liquidity is available, you receive USDC immediately. If utilization is high, your withdrawal is queued.</li>
</ol>
<div class="callout callout--warning"><div class="callout__icon">⚠️</div><div class="callout__body"><div class="callout__title">LP risk</div><p>If traders collectively profit more than the fees earned, LP share value decreases. Vault-counterparty models tend to be net profitable for LPs historically, but this is not guaranteed.</p></div></div>
`;

PAGES['nft-positions'] = () => `
<div class="page-header"><div class="page-header__eyebrow">User Guides</div><h1 class="page-header__title">NFT Positions</h1><p class="page-header__desc">Every Realyx position is a transferable ERC-721 NFT.</p></div>
<h2>What is a position NFT?</h2>
<p>When you open a leveraged position on Realyx, the <code>PositionToken</code> contract mints an ERC-721 NFT to your wallet. This NFT represents your entire position — collateral, leverage, direction, entry price, and trigger orders.</p>
<h2>What you can do with position NFTs</h2>
<ul>
  <li><strong>Transfer</strong> — Send to any wallet. The new owner inherits all position parameters and risk.</li>
  <li><strong>Sell</strong> — List on any NFT marketplace. Buyers acquire the position at its current state.</li>
  <li><strong>Gift</strong> — Send profitable positions to other traders.</li>
  <li><strong>Collateralize</strong> — Use as collateral in other DeFi protocols that support ERC-721 assets.</li>
</ul>
<div class="callout callout--danger"><div class="callout__icon">🚨</div><div class="callout__body"><div class="callout__title">Transfer risk</div><p>When you transfer a position NFT, you transfer all associated risk. Always verify position health before accepting a transfer.</p></div></div>
<h2>Transfer mechanics</h2>
<p>When a position NFT is transferred, <code>PositionToken</code> calls <code>TradingCore.updatePositionOwner()</code> to update the on-chain ownership record. The new owner can then manage the position from their wallet.</p>
`;

PAGES['faq'] = () => `
<div class="page-header"><div class="page-header__eyebrow">User Guides</div><h1 class="page-header__title">FAQ</h1><p class="page-header__desc">Frequently asked questions about Realyx.</p></div>
<h2>General</h2>
<h3>What is Realyx?</h3>
<p>Realyx is a decentralized perpetual futures exchange built on Conflux eSpace. Trade crypto, equities, and commodities with up to 10x leverage — no KYC, no custody risk, no front-running.</p>
<h3>Is Realyx audited?</h3>
<p>Not yet. A professional security audit is planned for Phase 2 (post-hackathon). The protocol is currently on testnet only.</p>
<h3>What network does Realyx run on?</h3>
<p>Conflux eSpace — an EVM-compatible execution environment. Chain ID 71 (testnet) or 1030 (mainnet, coming soon).</p>
<h2>Trading</h2>
<h3>What assets can I trade?</h3>
<p>Crypto pairs (CFX-USD, BTC-USD, ETH-USD), tokenized equities (TSLAX, NVDAX, AAPLX, METAX, GOOGLX, NFLXX, COINX, MCDX, CRCLX), and tokenized gold (XAUT-USD). The active set per deployment is the response of <code>GET /api/markets</code>.</p>
<h3>What's the maximum leverage?</h3>
<p>Up to 10x by default, configurable per market. Higher leverage means tighter liquidation prices.</p>
<h3>Can I get front-run?</h3>
<p>No. Realyx uses a two-phase commit model. Your order intent is submitted first, then a Keeper executes it with fresh oracle data in a separate transaction. There's no opportunity for MEV extraction.</p>
<h3>What happens if no Keeper executes my order?</h3>
<p>Your order remains pending. You can cancel it at any time to recover your escrowed collateral. In practice, Keepers execute orders within seconds.</p>
<h3>Can I transfer my position to someone else?</h3>
<p>Yes. Every position is an ERC-721 NFT. Transfer it using any NFT marketplace or direct wallet transfer.</p>
<h2>Liquidity Providing</h2>
<h3>How do LPs earn yield?</h3>
<p>LPs earn from trading fees, borrow fees, funding payments, and liquidation penalties.</p>
<h3>Can LPs lose money?</h3>
<p>Yes. If traders collectively profit more than the fees earned, LP share value decreases. This is not guaranteed to be profitable.</p>
<h3>Is there a lock-up period?</h3>
<p>No mandatory lock-up. However, withdrawals are subject to available liquidity — if utilization is high, you may need to use the queued withdrawal mechanism.</p>
<h2>Technical</h2>
<h3>What wallet do I need?</h3>
<p>MetaMask or Fluent Wallet configured for Conflux eSpace. Any EVM-compatible wallet that supports custom networks works.</p>
<h3>How do I get testnet tokens?</h3>
<ul>
  <li><strong>CFX (gas):</strong> <a href="https://evmtestnet.confluxscan.org/faucet" target="_blank">Conflux eSpace faucet</a></li>
  <li><strong>USDC (collateral):</strong> Use "Mint 1k Mock USDC" in Settings → Testnet Tools</li>
</ul>
<h2>Community</h2>
<h3>How do I follow Realyx and reach the team?</h3>
<ul>
  <li><strong>X (Twitter):</strong> <a href="https://x.com/Realyx_Perp" target="_blank" rel="noopener">@Realyx_Perp</a> for product updates.</li>
  <li><strong>Telegram channel:</strong> <a href="https://t.me/Real_yx" target="_blank" rel="noopener">t.me/Real_yx</a> for announcements only.</li>
  <li><strong>Telegram group:</strong> <a href="https://t.me/realyx_perp" target="_blank" rel="noopener">t.me/realyx_perp</a> for community chat and questions.</li>
  <li><strong>GitHub issues:</strong> <a href="https://github.com/AmirMP12/realyx-perp-conflux/issues" target="_blank" rel="noopener">repo issue tracker</a> for bug reports and feature requests.</li>
</ul>
`;

PAGES['troubleshooting'] = () => `
<div class="page-header"><div class="page-header__eyebrow">User Guides</div><h1 class="page-header__title">Troubleshooting</h1><p class="page-header__desc">Common issues and how to resolve them.</p></div>
<h2>Order stuck as "pending"</h2>
<p><strong>Cause:</strong> No Keeper is running, or the Keeper's RPC connection is down.</p>
<p><strong>Fix:</strong> Cancel the order at any time to recover your collateral. If running your own environment, check that the Keeper bot is running.</p>
<h2>Transaction failed with "out of gas"</h2>
<p><strong>Cause:</strong> Conflux eSpace sometimes underestimates gas for complex transactions.</p>
<p><strong>Fix:</strong> Increase the gas limit in your wallet settings (try 1.5x the estimated amount).</p>
<h2>Frontend shows stale data</h2>
<p><strong>Cause:</strong> The PostgreSQL indexer may be lagging behind the chain.</p>
<p><strong>Fix:</strong> Check <code>GET /api/sync</code> for indexer status. Try refreshing the page.</p>
<h2>"Oracle price too stale" error</h2>
<p><strong>Cause:</strong> The Pyth price feed hasn't been updated recently enough. More common on testnet.</p>
<p><strong>Fix:</strong> Wait for a Keeper to refresh prices, or trigger a manual refresh via the API.</p>
<h2>Wallet won't connect</h2>
<p><strong>Cause:</strong> Wrong network selected in your wallet.</p>
<p><strong>Fix:</strong> Ensure your wallet is connected to Conflux eSpace Testnet (Chain ID 71).</p>
<h2>Backend won't start</h2>
<pre><code># Check PostgreSQL is running
docker-compose ps

# Start just the database
docker-compose up -d postgres

# Then start backend
cd backend && npm run dev</code></pre>
`;

PAGES['dev-installation'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Developer Guide</div><h1 class="page-header__title">Installation</h1><p class="page-header__desc">Set up the full Realyx development environment from scratch.</p></div>
<h2>Prerequisites</h2>
<table>
  <thead><tr><th>Tool</th><th>Version</th><th>Purpose</th></tr></thead>
  <tbody>
    <tr><td>Node.js</td><td>v18.x or v20.x LTS</td><td>Runtime for backend, frontend, scripts</td></tr>
    <tr><td>npm</td><td>v9+</td><td>Package management (workspaces)</td></tr>
    <tr><td>Docker + Compose</td><td>Latest</td><td>PostgreSQL, Redis, containerized stack</td></tr>
    <tr><td>Git</td><td>Any</td><td>Version control</td></tr>
  </tbody>
</table>
<h2>Clone &amp; install</h2>
<pre><code>git clone https://github.com/AmirMP12/realyx-perp-conflux.git
cd realyx-perp-conflux
npm install</code></pre>
<h2>Compile smart contracts</h2>
<pre><code>npm run compile</code></pre>
<p>Runs <code>hardhat compile</code> (Solidity 0.8.24) followed by ABI post-processing scripts that fix enum encoding in generated TypeChain types.</p>
<h2>Verify setup</h2>
<pre><code>npm run test
npm run backend:typecheck
npm run frontend:typecheck</code></pre>
<h2>Available npm scripts</h2>
<table>
  <thead><tr><th>Script</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>npm run compile</code></td><td>Compile Solidity contracts + fix ABIs</td></tr>
    <tr><td><code>npm run test</code></td><td>Run Hardhat smart contract tests</td></tr>
    <tr><td><code>npm run deploy:conflux-testnet</code></td><td>Deploy to Conflux eSpace Testnet</td></tr>
    <tr><td><code>npm run verify:conflux-testnet</code></td><td>Verify contracts on ConfluxScan</td></tr>
    <tr><td><code>npx hardhat coverage</code></td><td>Generate Solidity coverage report</td></tr>
  </tbody>
</table>
`;

PAGES['configuration'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Developer Guide</div><h1 class="page-header__title">Configuration</h1><p class="page-header__desc">Environment variables and configuration for all Realyx services.</p></div>
<h2>Root environment (.env)</h2>
<pre><code># Deployer wallet private key (required for deployment)
PRIVATE_KEY=0x...

# ConfluxScan API key (optional, for contract verification)
CONFLUXSCAN_API_KEY=your_api_key

# RPC URLs
CONFLUX_TESTNET_RPC=https://evmtestnet.confluxrpc.com</code></pre>
<h2>Backend environment (backend/.env)</h2>
<pre><code>POSTGRES_URL=postgresql://user:pass@localhost:5432/realyx
RPC_URL=https://evmtestnet.confluxrpc.com
CHAIN_ID=71
TRADING_CORE_ADDRESS=0x64f277f73bfc81Ad80286a4266c0E0613d867Df3
VAULT_CORE_ADDRESS=0xB5C983d038caA21f4a9520b0EFAb2aD71DE4e714
PORT=3001
ENABLE_WS=true
WS_PORT=3002</code></pre>
<h2>Frontend environment (frontend/.env)</h2>
<pre><code>VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:3002
VITE_RPC_URL=https://evmtestnet.confluxrpc.com
VITE_CHAIN_ID=71
VITE_TRADING_CORE_ADDRESS=0x64f277f73bfc81Ad80286a4266c0E0613d867Df3
VITE_VAULT_CORE_ADDRESS=0xB5C983d038caA21f4a9520b0EFAb2aD71DE4e714
VITE_POSITION_TOKEN_ADDRESS=0x4368b5741A105c1ACE50ad98581fDa050685fa8B
VITE_WALLET_CONNECT_PROJECT_ID=your_project_id</code></pre>
<h2>Serverless (Vercel) mode</h2>
<p>When deploying to Vercel, WebSockets are not available. Set <code>ENABLE_WS=false</code> in backend and leave <code>VITE_WS_URL</code> empty in frontend. The frontend automatically falls back to REST polling.</p>
`;

PAGES['architecture'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Developer Guide</div><h1 class="page-header__title">Architecture</h1><p class="page-header__desc">Full-stack system design and component interactions.</p></div>
<h2>System diagram</h2>
<pre><code>+------------------------------------------------------------------+
|                  FRONTEND (React 18 / Vite)                      |
|  Markets | Trading | Portfolio | Vault | Analytics | Settings    |
+------------------------------+-----------------------------------+
                               | REST API / WebSocket
                               v
+------------------------------------------------------------------+
|                  BACKEND (Express / Node.js)                     |
|  Event Poller | Market Aggregator | Stat Cruncher | Triggers     |
+------------------------------+-----------------------------------+
                               | SQL + JSON-RPC
       +-----------------------+-----------------------+
       v                       v                       v
+-------------+       +-------------+       +-------------+
|  PostgreSQL |       | Pyth Network|       |   Keepers   |
|  (Indexer)  |       |  (Hermes)   |       |  (Bot.ts)   |
+------+------+       +-------------+       +-------------+
       |
       v
+------------------------------------------------------------------+
|              Conflux eSpace (EVM-compatible L1)                  |
|  TradingCore | VaultCore | OracleAggregator | PositionToken      |
+------------------------------------------------------------------+</code></pre>
<h2>Smart contracts (on-chain)</h2>
<table>
  <thead><tr><th>Contract</th><th>Role</th></tr></thead>
  <tbody>
    <tr><td><code>TradingCore</code></td><td>Order creation, execution, position management, funding, liquidation</td></tr>
    <tr><td><code>TradingCoreViews</code></td><td>Read-only companion for gas-efficient view calls</td></tr>
    <tr><td><code>VaultCore</code></td><td>LP deposits/withdrawals, borrow/repay, insurance fund</td></tr>
    <tr><td><code>OracleAggregator</code></td><td>Pyth price feed integration, staleness checks, circuit breakers</td></tr>
    <tr><td><code>PositionToken</code></td><td>ERC-721 NFT representing each open position</td></tr>
    <tr><td><code>MarketCalendar</code></td><td>Trading hours enforcement for RWA markets</td></tr>
    <tr><td><code>DividendManager</code></td><td>Corporate action settlement for equity positions</td></tr>
  </tbody>
</table>
<h2>Backend services</h2>
<ul>
  <li><strong>Express API</strong> — REST endpoints for market data, user positions, stats, leaderboard</li>
  <li><strong>PostgreSQL Indexer</strong> — Polls <code>getLogs</code> from Conflux eSpace, persists 15+ event types</li>
  <li><strong>WebSocket Server</strong> — Pushes real-time price updates and position changes</li>
  <li><strong>Pyth Service</strong> — Fetches latest prices from Hermes for frontend display</li>
  <li><strong>Server-side cache</strong> — Caches heavy aggregations (TVL, OI, volume)</li>
</ul>
<h2>Frontend stack</h2>
<ul>
  <li>React 18 + Vite, Wagmi + Viem + RainbowKit, Zustand, TanStack Query, Lightweight Charts, Framer Motion, Tailwind CSS</li>
</ul>
<h2>Data flow</h2>
<ol>
  <li>User submits order → <code>TradingCore.createOrder()</code> locks collateral, emits <code>OrderCreated</code></li>
  <li>Indexer detects event → Persists to PostgreSQL, broadcasts via WebSocket</li>
  <li>Keeper detects pending order → Fetches Pyth VAA, calls <code>TradingCore.executeOrder()</code></li>
  <li>Position opens → <code>PositionToken</code> mints NFT, vault borrows notional</li>
  <li>Frontend updates → WebSocket pushes new position state, UI re-renders PnL</li>
</ol>
`;

PAGES['smart-contracts'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Developer Guide</div><h1 class="page-header__title">Smart Contracts</h1><p class="page-header__desc">Deployed addresses, interfaces, and contract responsibilities.</p></div>
<h2>Deployed addresses (Conflux eSpace Testnet · Chain ID 71)</h2>
<table>
  <thead><tr><th>Contract</th><th>Role</th><th>Address</th><th>Explorer</th></tr></thead>
  <tbody>
    <tr><td>TradingCore</td><td>Order creation, execution, liquidation</td><td><code>0x64f277f73bfc81Ad80286a4266c0E0613d867Df3</code></td><td><a href="https://evmtestnet.confluxscan.org/address/0x64f277f73bfc81Ad80286a4266c0E0613d867Df3" target="_blank" rel="noopener">View ↗</a></td></tr>
    <tr><td>TradingCoreViews</td><td>Read-only companion for view calls</td><td><code>0x944d4030CEc4Bf552d8E46dC684B70B100Eb0b86</code></td><td><a href="https://evmtestnet.confluxscan.org/address/0x944d4030CEc4Bf552d8E46dC684B70B100Eb0b86" target="_blank" rel="noopener">View ↗</a></td></tr>
    <tr><td>VaultCore</td><td>LP liquidity, insurance tranche, borrow / repay</td><td><code>0xB5C983d038caA21f4a9520b0EFAb2aD71DE4e714</code></td><td><a href="https://evmtestnet.confluxscan.org/address/0xB5C983d038caA21f4a9520b0EFAb2aD71DE4e714" target="_blank" rel="noopener">View ↗</a></td></tr>
    <tr><td>PositionToken</td><td>ERC-721 NFT representing each open position</td><td><code>0x4368b5741A105c1ACE50ad98581fDa050685fa8B</code></td><td><a href="https://evmtestnet.confluxscan.org/address/0x4368b5741A105c1ACE50ad98581fDa050685fa8B" target="_blank" rel="noopener">View ↗</a></td></tr>
    <tr><td>OracleAggregator</td><td>Pyth feed integration, staleness checks</td><td><code>0x89cC8eAbF2e967d81FD04D1023298A3bDcE67450</code></td><td><a href="https://evmtestnet.confluxscan.org/address/0x89cC8eAbF2e967d81FD04D1023298A3bDcE67450" target="_blank" rel="noopener">View ↗</a></td></tr>
    <tr><td>MarketCalendar</td><td>Trading-hours enforcement for RWA markets</td><td><code>0xD3c20cca25Dd8189ed6115A1b65192d831ca732F</code></td><td><a href="https://evmtestnet.confluxscan.org/address/0xD3c20cca25Dd8189ed6115A1b65192d831ca732F" target="_blank" rel="noopener">View ↗</a></td></tr>
    <tr><td>DividendManager</td><td>Corporate-action settlement for equity positions</td><td><code>0xa5bd07176Ef68D1ec51BfCCD911d3B586a45c54F</code></td><td><a href="https://evmtestnet.confluxscan.org/address/0xa5bd07176Ef68D1ec51BfCCD911d3B586a45c54F" target="_blank" rel="noopener">View ↗</a></td></tr>
    <tr><td>Pyth</td><td>Pyth Network on-chain contract (entropy / VAA verifier)</td><td><code>0xDd24F84d36BF92C65F92307595335bdFab5Bbd21</code></td><td><a href="https://evmtestnet.confluxscan.org/address/0xDd24F84d36BF92C65F92307595335bdFab5Bbd21" target="_blank" rel="noopener">View ↗</a></td></tr>
    <tr><td>Mock USDC</td><td>Testnet collateral token (mintable in app Settings)</td><td><code>0xa56Ba38f3c820D6cf31a68CBBD0d25c0F5644d35</code></td><td><a href="https://evmtestnet.confluxscan.org/address/0xa56Ba38f3c820D6cf31a68CBBD0d25c0F5644d35" target="_blank" rel="noopener">View ↗</a></td></tr>
  </tbody>
</table>
<p style="font-size:13px;color:var(--text-3)">Source of truth: <code>deployment/confluxTestnet.json</code> in the repo. RPC <code>https://evmtestnet.confluxrpc.com</code>.</p>
<h2>TradingCore interface</h2>
<pre><code>interface ITradingCore {
  // Phase 1: Lock collateral, record intent
  function createOrder(
    OrderType orderType,
    address market,
    uint256 sizeDelta,
    uint256 collateralDelta,
    uint256 triggerPrice,
    bool isLong,
    uint256 maxSlippage,
    uint256 positionId
  ) external payable returns (uint256 orderId);

  // Phase 2: Keeper executes with fresh Pyth price
  function executeOrder(
    uint256 orderId,
    bytes[] calldata priceUpdateData
  ) external;

  // Cancel a queued order and refund escrowed collateral
  function cancelOrder(uint256 orderId) external;

  // Set SL / TP / trailing stop on an open position
  function setStopLoss(uint256 positionId, uint256 stopLossPrice) external;
  function setTakeProfit(uint256 positionId, uint256 takeProfitPrice) external;
  function setTrailingStop(uint256 positionId, uint256 trailingStopBps) external;

  // Close a position (full or partial)
  function closePosition(DataTypes.ClosePositionParams calldata params)
    external returns (int256 realizedPnL);
  function partialClose(
    uint256 positionId,
    uint256 closePercent,
    uint256 maxSlippage
  ) external returns (int256 realizedPnL);

  // Liquidate an undercollateralized position
  function liquidatePosition(uint256 positionId)
    external returns (uint256 liquidatorReward);
}</code></pre>
<h2>VaultCore interface</h2>
<pre><code>interface IVaultCore {
  // LP deposits / withdrawals (ERC-4626-style)
  function deposit(uint256 assets, address receiver)
    external returns (uint256 shares);
  function withdraw(uint256 shares, address receiver, address owner)
    external returns (uint256 assets);
  function queueWithdrawal(uint256 shares, uint256 minAssets)
    external returns (uint256 requestId);

  // TradingCore borrow / repay hooks
  function borrow(uint256 amount, address market, bool isLong)
    external returns (bool success);
  function repay(uint256 amount, address market, bool isLong, int256 pnl) external;

  // Insurance tranche (separate share class within the same vault)
  function stakeInsurance(uint256 assets, address receiver)
    external returns (uint256 shares);
  function unstakeInsurance(uint256 shares, address receiver)
    external returns (uint256 assets);
}</code></pre>
<h2>Upgradeability</h2>
<p>All core contracts use the <strong>UUPS (Universal Upgradeable Proxy Standard)</strong> pattern. Upgrades require the <code>UPGRADER_ROLE</code> and are governed by a multi-signature quorum.</p>
<h2>Supporting libraries</h2>
<table>
  <thead><tr><th>Library</th><th>Purpose</th></tr></thead>
  <tbody>
    <tr><td><code>TradingLib</code></td><td>Core trading logic</td></tr>
    <tr><td><code>FundingLib</code></td><td>Funding rate calculations</td></tr>
    <tr><td><code>HealthLib</code></td><td>Position health assessment</td></tr>
    <tr><td><code>LiquidationLib</code></td><td>Liquidation execution</td></tr>
    <tr><td><code>PositionMath</code></td><td>PnL, liquidation price, health calculations</td></tr>
    <tr><td><code>CircuitBreakerLib</code></td><td>Market-wide circuit breaker logic</td></tr>
    <tr><td><code>DataTypes</code></td><td>All shared structs, enums, constants</td></tr>
  </tbody>
</table>
`;

PAGES['api-reference'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Developer Guide</div><h1 class="page-header__title">API Reference</h1><p class="page-header__desc">REST endpoints and WebSocket channels for the Realyx backend.</p></div>
<h2>Base URLs</h2>
<table>
  <thead><tr><th>Environment</th><th>REST Base URL</th><th>WebSocket</th></tr></thead>
  <tbody>
    <tr><td>Local</td><td><code>http://localhost:3001/api</code></td><td><code>ws://localhost:3002</code></td></tr>
    <tr><td>Vercel</td><td><code>/api</code></td><td>Not available (use polling)</td></tr>
  </tbody>
</table>
<h2>Authentication</h2>
<p>The entire REST API is <strong>permissionless</strong> — no API keys or authentication required.</p>
<h2>Response envelope</h2>
<pre><code>// Success
{ "success": true, "data": { ... } }

// Error
{ "success": false, "error": "message" }</code></pre>
<h2>Endpoints</h2>
<table>
  <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><span class="method method--get">GET</span></td><td class="endpoint-path">/api/markets</td><td>Active markets with on-chain and indexed metrics</td></tr>
    <tr><td><span class="method method--get">GET</span></td><td class="endpoint-path">/api/markets/price-history/:marketId</td><td>Historical prices (query: <code>?days=7</code>)</td></tr>
    <tr><td><span class="method method--get">GET</span></td><td class="endpoint-path">/api/user/:address/positions</td><td>Open positions for a wallet address</td></tr>
    <tr><td><span class="method method--get">GET</span></td><td class="endpoint-path">/api/user/:address/trades</td><td>Trade history (query: <code>?limit=20</code>)</td></tr>
    <tr><td><span class="method method--get">GET</span></td><td class="endpoint-path">/api/stats</td><td>Protocol summary: TVL, 24h volume, OI, liquidations</td></tr>
    <tr><td><span class="method method--get">GET</span></td><td class="endpoint-path">/api/stats/history</td><td>Daily aggregated metrics (90 days)</td></tr>
    <tr><td><span class="method method--get">GET</span></td><td class="endpoint-path">/api/leaderboard</td><td>Trader rankings (query: <code>?limit=10&amp;timeframe=all</code>)</td></tr>
    <tr><td><span class="method method--get">GET</span></td><td class="endpoint-path">/api/insurance/claims</td><td>Insurance fund claim history</td></tr>
    <tr><td><span class="method method--get">GET</span></td><td class="endpoint-path">/api/sync</td><td>Trigger an indexer sync (gated by <code>CRON_SECRET</code>)</td></tr>
    <tr><td><span class="method method--get">GET</span></td><td class="endpoint-path">/api/pyth-refresh</td><td>Refresh cached Pyth prices (gated by <code>CRON_SECRET</code>)</td></tr>
    <tr><td><span class="method method--get">GET</span></td><td class="endpoint-path">/health</td><td>Service health check (also <code>/health/detailed</code>)</td></tr>
  </tbody>
</table>
<h2>Example: GET /api/stats</h2>
<pre><code>{
  "success": true,
  "data": {
    "totalMarkets": 12,
    "volume24h": "1250000.000000",
    "cumulativeVolumeUsd": "4529000.000000",
    "totalOpenInterest": "850000.000000",
    "totalLiquidations": "4",
    "activeTraders24h": 127,
    "tvl": "350000.000000"
  }
}</code></pre>
<h2>WebSocket</h2>
<p>When <code>ENABLE_WS=true</code>, clients can subscribe to real-time channels:</p>
<pre><code>// Subscribe to channels
ws.send(JSON.stringify({
  type: "subscribe",
  channels: ["prices", "stats"]
}));

// Incoming message types: price_update, stats_update, funding_update
ws.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  if (data.type === "price_update") {
    updatePrices(data.payload);
  }
};</code></pre>
`;

PAGES['keeper-node'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Developer Guide</div><h1 class="page-header__title">Keeper Node</h1><p class="page-header__desc">Run a Keeper node to execute orders and earn execution fees.</p></div>
<h2>What is a Keeper?</h2>
<p>Keepers are off-chain bots that monitor the blockchain for pending order intents and execute them by providing fresh Pyth oracle data. Keepers earn an execution fee for each successfully processed order.</p>
<h2>Prerequisites</h2>
<ul>
  <li>A funded wallet on Conflux eSpace (for gas)</li>
  <li>The <code>KEEPER_ROLE</code> granted by the protocol admin</li>
  <li>Node.js v18+ installed</li>
</ul>
<h2>Setup &amp; run</h2>
<pre><code>git clone https://github.com/AmirMP12/realyx-perp-conflux.git
cd realyx-perp-conflux
npm install

# Set PRIVATE_KEY to your keeper wallet in .env
cp .env.example .env

# Run the keeper bot
npx ts-node scripts/keeper-bot.ts</code></pre>
<p>The bot will poll for pending orders, fetch the latest Pyth VAA from Hermes API, call <code>executeOrder(orderId, priceUpdateData)</code>, and collect the execution fee.</p>
<h2>Configuration</h2>
<table>
  <thead><tr><th>Variable</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>KEEPER_POLL_INTERVAL</code></td><td>3000ms</td><td>How often to check for pending orders</td></tr>
    <tr><td><code>KEEPER_LOOKBACK_BLOCKS</code></td><td>100</td><td>How many blocks back to scan for missed orders</td></tr>
    <tr><td><code>RPC_URL</code></td><td>—</td><td>Conflux eSpace RPC endpoint</td></tr>
    <tr><td><code>PRIVATE_KEY</code></td><td>—</td><td>Keeper wallet private key</td></tr>
  </tbody>
</table>
<div class="callout callout--info"><div class="callout__icon">ℹ️</div><div class="callout__body"><div class="callout__title">Decentralized Keeper network (roadmap)</div><p>Phase 3 plans to open Keeper participation to anyone without requiring a role grant, with on-chain bounty distribution.</p></div></div>
`;

PAGES['deployment'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Developer Guide</div><h1 class="page-header__title">Deployment</h1><p class="page-header__desc">Deploy Realyx using Docker Compose, Vercel, or manual setup.</p></div>
<h2>Docker Compose (recommended)</h2>
<pre><code>docker-compose -f docker-compose.minimal.yml up -d</code></pre>
<p>Starts: Frontend (port 3000), Backend API (port 3001), WebSocket (port 3002), PostgreSQL (port 5432).</p>
<h2>Vercel (serverless)</h2>
<ol>
  <li>Set <code>ENABLE_WS=false</code> in backend environment</li>
  <li>Set <code>VITE_WS_URL=</code> (empty) in frontend environment</li>
  <li>Deploy via <code>vercel deploy</code> or connect your GitHub repo</li>
</ol>
<pre><code>node build-vercel.mjs</code></pre>
<h2>Contract deployment</h2>
<pre><code># Deploy to Conflux eSpace Testnet
npm run deploy:conflux-testnet

# Verify on ConfluxScan
npm run verify:conflux-testnet

# Write deployment addresses to JSON
npx ts-node scripts/write-deployment.ts</code></pre>
<h2>Kubernetes (production)</h2>
<p>Kubernetes manifests are available in <code>infrastructure/kubernetes/</code> for production-grade deployments with horizontal scaling, health checks, and monitoring via Prometheus/Grafana.</p>
`;

PAGES['testing'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Developer Guide</div><h1 class="page-header__title">Testing</h1><p class="page-header__desc">Running and writing tests across all layers of the Realyx stack.</p></div>
<h2>Smart contract tests</h2>
<pre><code># Run the full Hardhat test suite
npm run test

# Generate coverage report
npx hardhat coverage</code></pre>
<p>Tests are organized in <code>test/</code>:</p>
<ul>
  <li><code>test/core/</code> — TradingCore, VaultCore, OracleAggregator unit tests</li>
  <li><code>test/scenarios/</code> — End-to-end trading scenarios</li>
  <li><code>test/security/</code> — Attack vector tests (flash loans, reentrancy, oracle manipulation)</li>
  <li><code>test/fuzz/</code> — Property-based fuzz tests</li>
  <li><code>test/e2e/</code> — Full protocol integration tests</li>
</ul>
<h2>Backend tests</h2>
<pre><code>cd backend && npm test</code></pre>
<p>Uses Jest. Tests cover REST API endpoints, event ingestion logic, and service layer functions.</p>
<h2>Frontend tests</h2>
<pre><code>cd frontend && npm test</code></pre>
<p>Uses Vitest + Testing Library. Tests cover component rendering, wallet interactions, and data formatting.</p>
<h2>E2E tests</h2>
<pre><code>cd frontend && npx playwright test</code></pre>
<p>Playwright tests simulate full user flows: connecting wallet, minting USDC, opening positions, and closing them.</p>
`;

PAGES['security'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Reference</div><h1 class="page-header__title">Security</h1><p class="page-header__desc">Security architecture, threat model, and known limitations.</p></div>
<div class="callout callout--warning"><div class="callout__icon">⚠️</div><div class="callout__body"><div class="callout__title">Audit status</div><p>Realyx has not yet undergone a formal third-party security audit. The protocol is currently deployed on testnet only. A professional audit is planned for Phase 2.</p></div></div>
<h2>Design philosophy</h2>
<ol>
  <li><strong>Non-custodial</strong> — All collateral is held in auditable smart contracts, never in an EOA</li>
  <li><strong>Intent-based execution</strong> — Eliminates front-running and sandwich attacks by design</li>
  <li><strong>Oracle validation</strong> — Strict staleness and confidence checks prevent stale-price exploitation</li>
  <li><strong>Role separation</strong> — Granular access control limits blast radius of compromised keys</li>
  <li><strong>Circuit breakers</strong> — Automatic market halts on anomalous conditions</li>
</ol>
<h2>Attack vectors and mitigations</h2>
<table>
  <thead><tr><th>Attack</th><th>Mitigation</th></tr></thead>
  <tbody>
    <tr><td>Front-running / MEV</td><td>Two-phase commit intent model</td></tr>
    <tr><td>Oracle manipulation</td><td>Pyth VAA validation, staleness checks, confidence intervals</td></tr>
    <tr><td>Flash loan attacks</td><td><code>FlashLoanCheck</code> library detects and reverts flash loan patterns</td></tr>
    <tr><td>Reentrancy</td><td>OpenZeppelin ReentrancyGuard on all state-modifying functions</td></tr>
    <tr><td>Bad debt cascade</td><td>Insurance fund absorbs bad debt before LP pool is affected</td></tr>
  </tbody>
</table>
<h2>Access control roles</h2>
<table>
  <thead><tr><th>Role</th><th>Permissions</th></tr></thead>
  <tbody>
    <tr><td><code>DEFAULT_ADMIN_ROLE</code></td><td>Grant/revoke other roles</td></tr>
    <tr><td><code>KEEPER_ROLE</code></td><td>Execute orders and liquidations</td></tr>
    <tr><td><code>OPERATOR_ROLE</code></td><td>Add/update markets, configure parameters</td></tr>
    <tr><td><code>UPGRADER_ROLE</code></td><td>Upgrade contract implementations (UUPS)</td></tr>
    <tr><td><code>GUARDIAN_ROLE</code></td><td>Activate emergency mode, pause markets</td></tr>
  </tbody>
</table>
<h2>Known limitations</h2>
<ul>
  <li><strong>Single indexer:</strong> Protocol database sync relies on a single PostgreSQL indexer. Under extreme load, transient lag may cause minor frontend staleness.</li>
  <li><strong>Isolated margin only:</strong> Cross-margin mode is not yet implemented.</li>
  <li><strong>Testnet oracle fragility:</strong> Public Pyth Hermes endpoints on testnet may have higher latency than mainnet dedicated infrastructure.</li>
</ul>
<h2>Responsible disclosure</h2>
<p>Report vulnerabilities privately by opening a security advisory on <a href="https://github.com/AmirMP12/realyx-perp-conflux/security/advisories/new" target="_blank" rel="noopener">GitHub</a>. Please do not disclose publicly until a fix is deployed.</p>
`;

PAGES['glossary'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Reference</div><h1 class="page-header__title">Glossary</h1><p class="page-header__desc">Domain-specific terms used throughout Realyx documentation.</p></div>
<div class="glossary-letter">A</div>
<div class="glossary-term"><div class="glossary-term__name">AMM (Automated Market Maker)</div><div class="glossary-term__def">A DEX mechanism using mathematical formulas (e.g., x*y=k) to price assets. Realyx does not use an AMM — it uses oracle-based pricing with a vault counterparty.</div></div>
<div class="glossary-letter">B</div>
<div class="glossary-term"><div class="glossary-term__name">Bad debt</div><div class="glossary-term__def">When a liquidated position's collateral cannot cover its losses. The shortfall is absorbed by the insurance fund.</div></div>
<div class="glossary-term"><div class="glossary-term__name">BPS (Basis Points)</div><div class="glossary-term__def">One hundredth of a percent. 100 BPS = 1%. Used for fee rates, margin requirements, and slippage tolerances.</div></div>
<div class="glossary-letter">C</div>
<div class="glossary-term"><div class="glossary-term__name">Circuit breaker</div><div class="glossary-term__def">An automatic mechanism that halts trading on a market when anomalous conditions are detected.</div></div>
<div class="glossary-term"><div class="glossary-term__name">Collateral</div><div class="glossary-term__def">USDC deposited by a trader to back a leveraged position. Determines the liquidation threshold.</div></div>
<div class="glossary-term"><div class="glossary-term__name">Conflux eSpace</div><div class="glossary-term__def">The EVM-compatible execution space on the Conflux network. Supports standard Ethereum tooling with sub-cent gas fees.</div></div>
<div class="glossary-letter">F</div>
<div class="glossary-term"><div class="glossary-term__name">Funding rate</div><div class="glossary-term__def">A periodic payment between long and short position holders that keeps perpetual prices aligned with spot. Settled every 8 hours on Realyx.</div></div>
<div class="glossary-letter">H</div>
<div class="glossary-term"><div class="glossary-term__name">Health factor</div><div class="glossary-term__def">A measure of how close a position is to liquidation. Calculated as (collateral + unrealized PnL) / (notional × maintenance margin rate).</div></div>
<div class="glossary-term"><div class="glossary-term__name">Hermes</div><div class="glossary-term__def">Pyth Network's off-chain price service API. Keepers fetch signed price updates (VAAs) from Hermes.</div></div>
<div class="glossary-letter">I</div>
<div class="glossary-term"><div class="glossary-term__name">Insurance fund</div><div class="glossary-term__def">A separate USDC pool within VaultCore that absorbs bad debt before it affects LP deposits.</div></div>
<div class="glossary-term"><div class="glossary-term__name">Intent</div><div class="glossary-term__def">A signed order request that declares trading intent without specifying execution price. Keepers fill intents with fresh oracle prices.</div></div>
<div class="glossary-letter">K</div>
<div class="glossary-term"><div class="glossary-term__name">Keeper</div><div class="glossary-term__def">An off-chain bot that monitors pending orders and executes them by providing fresh oracle data. Earns execution fees.</div></div>
<div class="glossary-letter">L</div>
<div class="glossary-term"><div class="glossary-term__name">Leverage</div><div class="glossary-term__def">The multiplier applied to collateral to determine position size. 10x leverage means $100 collateral controls a $1,000 position.</div></div>
<div class="glossary-term"><div class="glossary-term__name">LP (Liquidity Provider)</div><div class="glossary-term__def">A user who deposits USDC into the vault, earning fees in exchange for acting as counterparty to traders.</div></div>
<div class="glossary-letter">M</div>
<div class="glossary-term"><div class="glossary-term__name">MEV (Miner Extractable Value)</div><div class="glossary-term__def">Value extracted by block producers through transaction ordering. Realyx's intent model prevents MEV extraction.</div></div>
<div class="glossary-letter">P</div>
<div class="glossary-term"><div class="glossary-term__name">Perpetual futures (perps)</div><div class="glossary-term__def">Derivative contracts with no expiry date. Funding rates keep prices anchored to spot.</div></div>
<div class="glossary-term"><div class="glossary-term__name">Pyth Network</div><div class="glossary-term__def">A decentralized oracle network providing high-frequency price feeds via a pull-based model where consumers fetch signed price attestations (VAAs).</div></div>
<div class="glossary-letter">R</div>
<div class="glossary-term"><div class="glossary-term__name">realyxLP</div><div class="glossary-term__def">The LP share token representing fractional ownership of the vault's assets.</div></div>
<div class="glossary-term"><div class="glossary-term__name">RWA (Real World Asset)</div><div class="glossary-term__def">Traditional financial assets (stocks, commodities, forex) represented on-chain. Realyx enables perpetual trading on RWAs.</div></div>
<div class="glossary-letter">T</div>
<div class="glossary-term"><div class="glossary-term__name">TVL (Total Value Locked)</div><div class="glossary-term__def">The total USDC deposited in the vault by liquidity providers.</div></div>
<div class="glossary-letter">U</div>
<div class="glossary-term"><div class="glossary-term__name">UUPS (Universal Upgradeable Proxy Standard)</div><div class="glossary-term__def">A proxy pattern where upgrade logic lives in the implementation contract. Used by all Realyx core contracts.</div></div>
<div class="glossary-letter">V</div>
<div class="glossary-term"><div class="glossary-term__name">VAA (Verifiable Action Approval)</div><div class="glossary-term__def">Pyth's signed price attestation format. Keepers submit VAAs to update on-chain prices during order execution.</div></div>
<div class="glossary-term"><div class="glossary-term__name">Vault</div><div class="glossary-term__def">The shared USDC liquidity pool (VaultCore) that acts as counterparty to all trades.</div></div>
`;

PAGES['roadmap'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Reference</div><h1 class="page-header__title">Roadmap</h1><p class="page-header__desc">Phased development plan for the Realyx protocol — from hackathon prototype to production-grade perpetuals DEX.</p></div>
<div class="roadmap-phase">
  <div class="roadmap-phase__header"><div class="roadmap-phase__title">Phase 1 · Complete — Global Hackfest 2026</div><span class="badge badge--green">Complete</span></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--done">✓</div><div class="roadmap-item__text">Core smart contracts — TradingCore, VaultCore, OracleAggregator, PositionToken</div></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--done">✓</div><div class="roadmap-item__text">Hardhat test cases across core, fuzz, security &amp; e2e suites</div></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--done">✓</div><div class="roadmap-item__text">PostgreSQL native EVM indexer tracking 15+ on-chain events</div></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--done">✓</div><div class="roadmap-item__text">Full-stack frontend — Markets, Trading, Portfolio, Vault, Analytics, Settings</div></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--done">✓</div><div class="roadmap-item__text">Keeper bot for decentralised order execution</div></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--done">✓</div><div class="roadmap-item__text">Deployed to Conflux eSpace Testnet (Chain ID 71)</div></div>
</div>
<div class="roadmap-phase">
  <div class="roadmap-phase__header"><div class="roadmap-phase__title">Phase 2 · Post-Hackathon</div><span class="badge badge--yellow">Planned</span></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--todo">○</div><div class="roadmap-item__text">Independent smart-contract security audit</div></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--todo">○</div><div class="roadmap-item__text">Conflux eSpace Mainnet launch (Chain ID 1030)</div></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--todo">○</div><div class="roadmap-item__text">Multi-collateral support — USDT0 &amp; AxCNH</div></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--todo">○</div><div class="roadmap-item__text">Liquidity mining programme for early <code>realyxLP</code> depositors</div></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--todo">○</div><div class="roadmap-item__text">Public Keeper node — anyone can execute orders and earn bounties</div></div>
</div>
<div class="roadmap-phase">
  <div class="roadmap-phase__header"><div class="roadmap-phase__title">Phase 3 · Scale</div><span class="badge badge--blue">Future</span></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--todo">○</div><div class="roadmap-item__text">Cross-margin architecture across all open positions</div></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--todo">○</div><div class="roadmap-item__text">Social copy-trading — auto-mirror top leaderboard wallets</div></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--todo">○</div><div class="roadmap-item__text">Expanded RWA markets — Forex, commodities, additional equities</div></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--todo">○</div><div class="roadmap-item__text">Governance module for community-driven parameter updates</div></div>
  <div class="roadmap-item"><div class="roadmap-item__check roadmap-item__check--todo">○</div><div class="roadmap-item__text">Mobile-optimised trading interface</div></div>
</div>
<p>Feature requests and prioritization feedback are welcome via <a href="https://github.com/AmirMP12/realyx-perp-conflux/issues" target="_blank" rel="noopener">GitHub Issues</a>.</p>
`;

PAGES['contributing'] = () => `
<div class="page-header"><div class="page-header__eyebrow">Reference</div><h1 class="page-header__title">Contributing</h1><p class="page-header__desc">How to contribute code, documentation, or bug reports to Realyx.</p></div>
<h2>Ways to contribute</h2>
<ul>
  <li><strong>Bug reports</strong> — Open an issue on <a href="https://github.com/AmirMP12/realyx-perp-conflux/issues" target="_blank">GitHub</a></li>
  <li><strong>Feature requests</strong> — Describe the use case and proposed solution</li>
  <li><strong>Code contributions</strong> — Fix bugs, add features, improve tests</li>
  <li><strong>Documentation</strong> — Fix typos, add examples, improve clarity</li>
</ul>
<h2>Development workflow</h2>
<div class="steps">
  <div class="step-item"><div class="step-num">1</div><div class="step-body"><h3>Fork and clone</h3><pre><code>git clone https://github.com/YOUR_USERNAME/realyx-perp-conflux.git
cd realyx-perp-conflux && npm install</code></pre></div></div>
  <div class="step-item"><div class="step-num">2</div><div class="step-body"><h3>Create a feature branch</h3><pre><code>git checkout -b feature/my-improvement</code></pre></div></div>
  <div class="step-item"><div class="step-num">3</div><div class="step-body"><h3>Make changes and test</h3><pre><code>npm run test
cd backend && npm test
cd frontend && npm test</code></pre></div></div>
  <div class="step-item"><div class="step-num">4</div><div class="step-body"><h3>Commit and push</h3><pre><code>git commit -m "feat: add my improvement"
git push origin feature/my-improvement</code></pre></div></div>
  <div class="step-item"><div class="step-num">5</div><div class="step-body"><h3>Open a Pull Request</h3><p>Open a PR against the <code>main</code> branch. Describe what you changed and why.</p></div></div>
</div>
<h2>Code style</h2>
<ul>
  <li>Solidity: Prettier with <code>.prettierrc</code> config</li>
  <li>TypeScript: ESLint with project-specific rules</li>
  <li>Commit messages: Conventional Commits format (<code>feat:</code>, <code>fix:</code>, <code>docs:</code>)</li>
</ul>
<p>All contributions are licensed under MIT, matching the project license.</p>
`;


// ─────────────────────────────────────────────────────────────────────────────
// SEARCH INDEX
// ─────────────────────────────────────────────────────────────────────────────
const SEARCH_INDEX = [
  { page: 'home', title: 'Introduction', section: 'Home' },
  { page: 'what-is-realyx', title: 'What is Realyx?', section: 'Getting Started' },
  { page: 'key-features', title: 'Key Features', section: 'Getting Started' },
  { page: 'quick-start', title: 'Quick Start', section: 'Getting Started' },
  { page: 'first-trade', title: 'Your First Trade', section: 'Getting Started' },
  { page: 'how-it-works', title: 'How It Works', section: 'Core Concepts' },
  { page: 'vault-mechanics', title: 'Vault Mechanics', section: 'Core Concepts' },
  { page: 'intent-execution', title: 'Intent-Based Execution', section: 'Core Concepts' },
  { page: 'funding-rates', title: 'Funding Rates', section: 'Core Concepts' },
  { page: 'liquidation', title: 'Liquidation Engine', section: 'Core Concepts' },
  { page: 'trading-guide', title: 'Trading Guide', section: 'User Guides' },
  { page: 'providing-liquidity', title: 'Providing Liquidity', section: 'User Guides' },
  { page: 'nft-positions', title: 'NFT Positions', section: 'User Guides' },
  { page: 'faq', title: 'FAQ', section: 'User Guides' },
  { page: 'troubleshooting', title: 'Troubleshooting', section: 'User Guides' },
  { page: 'dev-installation', title: 'Installation', section: 'Developer Guide' },
  { page: 'configuration', title: 'Configuration', section: 'Developer Guide' },
  { page: 'architecture', title: 'Architecture', section: 'Developer Guide' },
  { page: 'smart-contracts', title: 'Smart Contracts', section: 'Developer Guide' },
  { page: 'api-reference', title: 'API Reference', section: 'Developer Guide' },
  { page: 'keeper-node', title: 'Keeper Node', section: 'Developer Guide' },
  { page: 'deployment', title: 'Deployment', section: 'Developer Guide' },
  { page: 'testing', title: 'Testing', section: 'Developer Guide' },
  { page: 'security', title: 'Security', section: 'Reference' },
  { page: 'glossary', title: 'Glossary', section: 'Reference' },
  { page: 'roadmap', title: 'Roadmap', section: 'Reference' },
  { page: 'contributing', title: 'Contributing', section: 'Reference' },
];

// ─────────────────────────────────────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────────────────────────────────────
const html = document.documentElement;
const themeBtn = document.getElementById('theme-toggle');
themeBtn.addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('rx-theme', next);
});

// ─────────────────────────────────────────────────────────────────────────────
// SIDEBAR TOGGLE
// ─────────────────────────────────────────────────────────────────────────────
const sidebar = document.getElementById('sidebar');
const mainEl = document.querySelector('.main');
const sidebarBtn = document.getElementById('sidebar-toggle');

function setSidebar(open) {
  if (window.innerWidth <= 900) {
    sidebar.classList.toggle('mobile-open', open);
    mainEl.classList.remove('sidebar-collapsed');
  } else {
    sidebar.classList.toggle('collapsed', !open);
    mainEl.classList.toggle('sidebar-collapsed', !open);
  }
}
setSidebar(window.innerWidth > 900);
sidebarBtn.addEventListener('click', () => {
  const isOpen = window.innerWidth <= 900
    ? sidebar.classList.contains('mobile-open')
    : !sidebar.classList.contains('collapsed');
  setSidebar(!isOpen);
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 900) setSidebar(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────────────────────
const contentArea = document.getElementById('content-area');
const tocNav = document.getElementById('toc-nav');
let currentPage = '';

function navigate(page) {
  if (page === currentPage) return;
  currentPage = page;

  document.querySelectorAll('.sidebar__item').forEach(el => {
    el.classList.toggle('sidebar__item--active', el.dataset.page === page);
  });

  const renderer = PAGES[page] || PAGES['home'];
  contentArea.innerHTML = renderer();

  window.scrollTo(0, 0);
  buildTOC();
  addCopyButtons();
  history.pushState({ page }, '', '#' + page);

  if (window.innerWidth <= 900) setSidebar(false);
}

document.querySelectorAll('.sidebar__item').forEach(el => {
  el.addEventListener('click', () => navigate(el.dataset.page));
});

window.addEventListener('popstate', e => {
  const page = (e.state && e.state.page) || location.hash.slice(1) || 'home';
  navigate(page);
});

// ─────────────────────────────────────────────────────────────────────────────
// TOC BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function buildTOC() {
  const headings = contentArea.querySelectorAll('h2, h3');
  if (headings.length < 2) { tocNav.innerHTML = ''; return; }
  let out = '';
  headings.forEach((h, i) => {
    if (!h.id) h.id = 'h-' + i;
    const cls = h.tagName === 'H3' ? 'toc-h3' : '';
    out += `<a href="#${h.id}" class="${cls}">${h.textContent}</a>`;
  });
  tocNav.innerHTML = out;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        tocNav.querySelectorAll('a').forEach(a => a.classList.remove('active'));
        const link = tocNav.querySelector(`a[href="#${e.target.id}"]`);
        if (link) link.classList.add('active');
      }
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  headings.forEach(h => observer.observe(h));
}

// ─────────────────────────────────────────────────────────────────────────────
// COPY BUTTONS
// ─────────────────────────────────────────────────────────────────────────────
function addCopyButtons() {
  contentArea.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      const text = code ? code.innerText : pre.innerText;
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      });
    });
    pre.appendChild(btn);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────────────────────
const searchModal = document.getElementById('search-modal');
const searchModalInput = document.getElementById('search-modal-input');
const searchResultsEl = document.getElementById('search-results');
const searchBox = document.getElementById('search-box');
const searchClose = document.getElementById('search-close');
const searchBackdrop = document.getElementById('search-backdrop');

function openSearch() {
  searchModal.hidden = false;
  searchModalInput.focus();
  renderSearchResults('');
}
function closeSearch() {
  searchModal.hidden = true;
  searchModalInput.value = '';
}

searchBox.addEventListener('click', openSearch);
searchClose.addEventListener('click', closeSearch);
searchBackdrop.addEventListener('click', closeSearch);
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
  if (e.key === 'Escape') closeSearch();
});
searchModalInput.addEventListener('input', e => renderSearchResults(e.target.value));

function renderSearchResults(query) {
  const q = query.toLowerCase().trim();
  const results = q
    ? SEARCH_INDEX.filter(r => r.title.toLowerCase().includes(q) || r.section.toLowerCase().includes(q))
    : SEARCH_INDEX.slice(0, 8);

  if (!results.length) {
    searchResultsEl.innerHTML = `<div class="search-empty">No results for "${query}"</div>`;
    return;
  }
  searchResultsEl.innerHTML = results.map(r => `
    <div class="search-result" data-page="${r.page}">
      <svg class="search-result__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <div>
        <div class="search-result__title">${r.title}</div>
        <div class="search-result__section">${r.section}</div>
      </div>
    </div>
  `).join('');

  searchResultsEl.querySelectorAll('.search-result').forEach(el => {
    el.addEventListener('click', () => { closeSearch(); navigate(el.dataset.page); });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL LOAD — must be last, after PAGES and navigate() are both defined
// ─────────────────────────────────────────────────────────────────────────────
navigate(location.hash.slice(1) || 'home');
