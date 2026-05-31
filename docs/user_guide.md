# 📖 Realyx User Guide

Welcome to **Realyx**, the next-generation Perpetual DEX on **Conflux eSpace**. This comprehensive guide details how to seamlessly interact with the Realyx ecosystem to trade Real-World Assets (RWAs) and cryptocurrencies.

---

## 1. Initial Setup

### Network Configuration
Before trading, you must connect your Web3 wallet (e.g., **MetaMask**, **Fluent**, **OKX Wallet**) to the Conflux eSpace Testnet.

- **Network Name**: Conflux eSpace (Testnet)
- **RPC URL**: `https://evmtestnet.confluxrpc.com`
- **Chain ID**: `71`
- **Currency Symbol**: `CFX`
- **Block Explorer**: `https://evmtestnet.confluxscan.org`

### Acquiring Gas & Test Funds
To submit transactions, you will need **CFX** for gas fees and **Stablecoins (e.g., testnet USDC/USDT0/AxCNH)** for trading collateral.
1. Obtain native CFX from the [Conflux Faucet](https://evmfaucet.confluxnetwork.org/).
2. Navigate to **⚙️ Settings -> Testnet Tools** within the Realyx UI to mint complimentary teststablecoins to your wallet.

---

## 2. Perpetual Trading

### Executing a Trade
1. Navigate to the **Markets** dashboard.
2. Select an asset pair (e.g., `BTC/USD`, `AAPL/USD`, `GOLD/USD`).
3. Predict direction: Choose **Long** (if you anticipate price appreciation) or **Short** (for depreciation).
4. Input your **Order Size** in USDC.
5. Adjust the **Leverage Slider** (maximum 10x).
6. Click **Open Position** and confirm the exact parameters via your wallet prompt.

### Position Management
Once your trade is active, manage risk seamlessly from the **Portfolio** tab:
- **Adjusting Margin**: Manually deposit additional USDC to boost your Health Factor, staving off volatile liquidations.
- **Closing Positions**: Click the **Close** action to exit the trade at the current oracle market price and realize your PnL.
- **Advanced Stop Loss / Take Profit / Trailing Limits**: Automate your exits based on predefined trigger prices safely on the smart contract.

---

## 3. Liquidity Provision (The Vault)

Liquidity Providers (LPs) act as the backbone of Realyx. By depositing USDC, you become the counterparty to trader volume and receive protocol yields.

### Vault Staking
1. Access the **Vault** page.
2. Specify the quantity of USDC you wish to provide.
3. Click **Deposit**. You will be minted **Vault Shares** proportional to the pool's size.
4. Sit back: LPs actively accrue yield from trader fees, liquidations, and funding rate adjustments.

### Capital Unstaking
To ensure protocol solvency, large withdrawals follow a queue mechanism:
1. If enough free liquidity is available, withdrawals settle instantly.
2. Otherwise, initiate a **Withdrawal Request** on the Vault page.
3. Wait out the LP **withdrawal cooldown** (default ~1 day; configurable by governance).
4. Once the period lapses, execute the withdrawal to redeem your USDC + compounded rewards.

### Insurance Staking (optional backstop)
The insurance pool is a separate share class inside the same `VaultCore` contract:
- **Stake** USDC via the **Insurance** page to backstop bad debt and earn premium yield.
- **Unstaking** requires a request followed by a longer **unstake cooldown** (default ~7 days) to keep the backstop solvent during stress.

---

## 4. Social & RWA Features

- **Leaderboard** — Top traders ranked by realized PnL and volume.
- **Copy Trading** — Follow registered lead traders and mirror their intent flow with your own allocation and leverage caps.
- **Referrals** — Share your on-chain referral code to earn claimable USDC fee rebates.
- **Analytics** — Protocol-wide TVL, volume, and open-interest dashboards.
- **RWA trading hours** — Tokenized equities/commodities follow a `MarketCalendar`; orders on those markets are blocked (revert `MarketClosed`) outside session hours.

---
*Disclaimer: Leveraged trading and DeFi participation carry inherent risks. Only trade or provide liquidity with capital you are prepared to lose.*
