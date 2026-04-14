# Realyx — deployment & operations runbook

Operator-focused procedures: **versioned addresses**, **roles**, **upgrades**, **pause / breakers**, and **stale oracle** response. Product onboarding stays in the root [README.md](../README.md).

---

## 1. Versioned addresses (source of truth)

| Artifact | Path | Notes |
|----------|------|--------|
| Latest deploy bundle | `deployment/confluxTestnet.json` | Written by deploy scripts; includes `chainId`, `timestamp`, `contracts{...}`. |
| README snapshot | [README.md § Deployed Contracts](../README.md) | Human table; **can drift** — prefer JSON for automation. |

**Current testnet snapshot** (from `deployment/confluxTestnet.json` at time of writing; **verify on-chain** before mainnet reuse):

| Key | Address (Conflux eSpace **testnet**, chain id **71**) |
|-----|--------------------------------------------------------|
| `tradingCore` | `0x64f277f73bfc81Ad80286a4266c0E0613d867Df3` |
| `vaultCore` | `0xB5C983d038caA21f4a9520b0EFAb2aD71DE4e714` |
| `oracleAggregator` | `0x89cC8eAbF2e967d81FD04D1023298A3bDcE67450` |
| `positionToken` | `0x4368b5741A105c1ACE50ad98581fDa050685fa8B` |
| `tradingCoreViews` | `0x944d4030CEc4Bf552d8E46dC684B70B100Eb0b86` |
| `marketCalendar` | `0xD3c20cca25Dd8189ed6115A1b65192d831ca732F` |
| `dividendManager` | `0xa5bd07176Ef68D1ec51BfCCD911d3B586a45c54F` |
| `complianceManager` | `0xa79185D94013FaC946Ce80fDbB8E781200A28F7e` |
| `dividendKeeper` | `0x28B46F65c26BDC6b9c77603B092EDdcd7EADEC82` |
| `usdc` / `mockUsdc` | `0xa56Ba38f3c820D6cf31a68CBBD0d25c0F5644d35` |
| `pyth` | `0xDd24F84d36BF92C65F92307595335bdFab5Bbd21` |

**Mainnet:** add `deployment/conflux.json` (or equivalent) after first mainnet deploy and paste addresses there; keep README in sync or link only to JSON.

**Explorers**

- Testnet: `https://evmtestnet.confluxscan.org/address/<ADDRESS>`
- Mainnet: `https://evm.confluxscan.org/address/<ADDRESS>`

---

## 2. Roles (AccessControl)

Defined in `contracts/libraries/DataTypes.sol` (hashes of string labels):

| Role constant | `bytes32` label | Intended holder |
|---------------|-----------------|-------------------|
| `DEFAULT_ADMIN_ROLE` | OpenZeppelin default | Multisig / protocol admin |
| `ADMIN_ROLE` | `"ADMIN_ROLE"` | Same as above for app-specific admin checks |
| `OPERATOR_ROLE` | `"OPERATOR_ROLE"` | Day-2 ops: markets, feeds, caps |
| `GUARDIAN_ROLE` | `"GUARDIAN_ROLE"` | Incident: pause, breakers, emergency price |
| `ORACLE_ROLE` | `"ORACLE_ROLE"` | Price / Hermes relay bots |
| `KEEPER_ROLE` | `"KEEPER_ROLE"` | Order execution, health updates, TWAP samples |
| `LIQUIDATOR_ROLE` | `"LIQUIDATOR_ROLE"` | Liquidation bots |
| `TRADING_CORE_ROLE` | `"TRADING_CORE_ROLE"` | **Only** the `TradingCore` proxy on `VaultCore` |

**Grant example** (from repo scripts pattern):

```bash
npx hardhat run scripts/grant-operator.ts --network confluxTestnet
```

Use Hardhat / cast with the **proxy address** of the contract you are administering. After deploy, confirm:

- `VaultCore`: `hasRole(TRADING_CORE_ROLE, tradingCoreProxy) == true`
- Keepers/oracles/guardians granted on **TradingCore**, **OracleAggregator**, and **VaultCore** as per your playbooks

### Auto keeper bot (testnet / staging)

Repo includes `scripts/keeper-bot.ts` to continuously execute pending orders from `OrderCreated` events.
The keeper now fetches Pyth Hermes updates and pushes `updatePriceFeeds` before `executeOrder`, which is required when oracle state is stale.

1. Fund keeper wallet with native gas token.
2. Grant `KEEPER_ROLE` on `TradingCore` to keeper wallet.
3. Configure env:
   - `KEEPER_PRIVATE_KEY`
   - `KEEPER_RPC_URL` (or rely on `CONFLUX_TESTNET_RPC_URL`)
   - optional `KEEPER_RPC_URLS` (CSV fallback RPCs)
   - optional `KEEPER_HERMES_URL` (default `https://hermes.pyth.network`)
   - optional `KEEPER_TRADING_CORE_ADDRESS`
4. Run:

```bash
npm run keeper:bot
```

For high-throughput test runs, run at least 2 keeper instances (different wallets), each with role + gas budget.

---

## 3. Deploy (clean environment)

Prerequisites: `PRIVATE_KEY` or `MNEMONIC`, RPC URLs (see `.env.example`), ConfluxScan API key for verify.

```bash
npm ci
npm run compile
npx hardhat run scripts/deploy-testnet.ts --network confluxTestnet
npm run verify:conflux-testnet
npm run setup:market
```

Outputs: `deployment/confluxTestnet.json`. Copy addresses into:

- `frontend/.env` / `backend/.env` (see their `.env.example`)
- Internal address book / monitoring

**Never** commit private keys; commit **only** address JSON if policy allows.

---

## 4. UUPS upgrades

Generic script: `scripts/upgrade.ts`.

**Required env**

- `CONTRACT_TO_UPGRADE` — e.g. `TradingCore`, `OracleAggregator`, `VaultCore`, `TradingCoreViews`
- `PROXY_ADDRESS` — proxy to upgrade

**Linked libraries** (must be deployed libraries and passed as env addresses):

- `TradingCore`: `LIB_CLEANUP_LIB`, `LIB_CONFIG_LIB`, `LIB_DUST_LIB`, `LIB_FLASH_LOAN_CHECK`, `LIB_FUNDING_LIB`, `LIB_HEALTH_LIB`, `LIB_POSITION_TRIGGERS_LIB`, `LIB_TRADING_CONTEXT_LIB`, `LIB_TRADING_LIB`, `LIB_WITHDRAW_LIB`
- `OracleAggregator`: `LIB_CIRCUIT_BREAKER_LIB`, `LIB_EMERGENCY_PAUSE_LIB`, `LIB_EMERGENCY_PRICE_LIB`
- `TradingCoreViews`: `LIB_POSITION_MATH`

```bash
set CONTRACT_TO_UPGRADE=TradingCore
set PROXY_ADDRESS=0x...yourTradingCoreProxy...
set LIB_TRADING_LIB=0x...deployedLibrary...
# ...set all required LIB_* per scripts/upgrade.ts
npx hardhat run scripts/upgrade.ts --network confluxTestnet
```

**Post-upgrade checklist**

1. Implementation verified on ConfluxScan (if supported).
2. Smoke: `getPrice`, `deposit` small amount, `createOrder` + `executeOrder` on test market.
3. Storage layout: only use OZ-upgrades-safe patterns; document storage gap changes in release notes.

---

## 5. Pause playbooks

### 5.1 Contract `pause()` / `unpause()` (Pausable)

- **Who can pause**: `AccessControlled.pause` — `ADMIN_ROLE` **or** `GUARDIAN_ROLE` (see `onlyAdminOrGuardian`).
- **Who can unpause**: **Admin only** (`unpause`).

**When to use**

- Suspend user entrypoints quickly while diagnosing (trading paths respect `whenNotPaused`).

**Steps**

1. Guardian or admin: `pause()` on **TradingCore** (and optionally **VaultCore** if LP flows must stop).
2. Communicate status (status page / Discord).
3. Root-cause: oracle, vault TVL, exploit suspicion.
4. Admin: `unpause()` after fix.

### 5.2 Oracle global pause & emergency pause (`OracleAggregator`)

- **`activateGlobalPause()`** — guardian; sets global flag used in `isMarketRestricted` / breaker gating.
- **`deactivateGlobalPause()`** — admin only.
- **`proposeEmergencyPause` / `confirmEmergencyPause`** — multi-guardian quorum over **registered** pausable targets (`registerPausable`).

**Playbook**

1. If prices are untrusted but contracts still reachable: **global pause** first (fast).
2. If specific modules must receive `pause()`: ensure targets were **`registerPausable`** during peacetime; then run emergency pause proposal flow.
3. After incident: reset breakers (below), refresh feeds, **deactivate** global pause when admin signs off.

---

## 6. Circuit breakers (oracle)

**Symptoms**

- Users see `BreakerActive()` on **increase** orders (`TradingCore` checks `isActionAllowed(market, 0)`).
- `isMarketRestricted(market)` returns restricted or non-zero active breakers.

**Operator actions**

1. Read status: `getBreakerStatus(market, breakerType)` for `PRICE_DROP`, `TWAP_DEVIATION`, etc.
2. If false alarm and oracle healthy: `autoResetBreakers(market)` (permissionless when healthy) or **`resetBreaker`** (admin/guardian per modifier).
3. If legitimate stress: keep breakers on; publish incident; optionally **`triggerBreaker`** (guardian) on missing automation.
4. Tune configs: **`configureBreaker`**, **`setBreakerEnabled`** (operator) with post-mortem parameters.

Document each change (tx hash, old/new threshold) in your ops log.

---

## 7. “Oracle is stale” — triage & fix

**On-chain signals**

- Reverts: `StalePrice()`, `InsufficientConfidence()`, `InvalidSource()`, `DataNotFound()`.
- Views: `isOracleHealthy(market)` returns `(false, reason)` with `"Stale price"`, `"Not configured"`, etc.

**Checklist**

1. **Pyth Hermes** — Is the price service returning fresh `publishTime` for the `feedId` on this network?
2. **On-chain update** — Did the user/keeper attach `updatePriceFeeds` calldata before txs that read spot? (Execution path may rely on recently updated Pyth state depending on flow.)
3. **`maxStaleness` / `setPythFeed`** — Operator compare `block.timestamp - publishTime` to configured cap; widen **only** with governance risk acceptance.
4. **Market calendar** — For RWA feeds, closed market can **widen** staleness window in oracle logic; confirm `marketIds` mapping is set on **OracleAggregator** and **TradingCore**.
5. **TWAP buffer** — If TWAP breakers misfire: ensure keepers call **`recordPricePoint`** at sane intervals (subject to min interval).
6. **Emergency override** — Last resort: guardian **`proposeEmergencyPrice` / `confirmEmergencyPrice`** with strict quorum; never routine.

**User-facing guidance**

- Show “price updating…” and retry after Hermes fetch.
- Do not retry **increase** trades in a tight loop (gas + `RateLimitExceeded` / flash-loan guards).

---

## 8. Vault / insurance incidents

| Symptom | Likely module | First actions |
|---------|----------------|---------------|
| `borrow` returns `false` | `VaultCore` | Check `getAvailableLiquidity`, utilization, exposure caps; add LP or lower OI. |
| `InsuranceFundCircuitBreakerActive()` | `VaultCore` | Pause aggressive cover; admin **`resetInsuranceCircuitBreaker`** after reserves review. |
| `EmergencyModeActive()` | `VaultCore` | Guardian triggered; admin clears when **`getUtilization()`** below threshold per `stopEmergencyMode`. |
| LP stuck after long emergency | Escape path | After timelock, eligible users **`emergencyEscapeWithdraw`** per contract rules. |

---

## 9. Links

- Custom errors for UX: [ERROR_CATALOG.md](./ERROR_CATALOG.md)
- Product & dev setup: [README.md](../README.md)
- User-facing: [user_guide.md](./user_guide.md)

---

## 10. Revision log (edit manually each deploy)

| Date (UTC) | Network | Change | Tx / PR |
|------------|---------|--------|---------|
| _Example_ | confluxTestnet | Initial deploy addresses in `deployment/confluxTestnet.json` | _fill_ |

Maintainers: append a row on every **deploy**, **upgrade**, or **role** change.
