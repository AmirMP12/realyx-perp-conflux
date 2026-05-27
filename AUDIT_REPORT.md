# Realyx Smart Contract Audit Report

> Scope: `contracts/{base,core,libraries,modules,interfaces}/*.sol` (40 files, ~7.8 kLoC).
> Compiler: Solidity 0.8.24 / viaIR / optimizer 200 runs / EVM Paris / `revertStrings: "strip"`.
> This report is intended as a working document. All findings reference exact files and functions.

## Severity summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 3 |
| Medium | 6 |
| Low / Informational | 9 |

---

## Critical

### C-01 — Insurance pool share-decimal mismatch dilutes the first staker to ~zero

**Where**: `contracts/core/VaultCore.sol`

- `initialize` pre-mints `DEAD_SHARES = 1e18` insurance shares to `address(1)` and sets `_insTotalShares = 1e18`.
- `_convertToInsShares` returns `assets` (in 6-decimal USDC precision) on the first stake instead of scaling to 18-decimal share precision.
- `_convertToInsAssets` then divides by `_insTotalShares ≈ 1e18`, rounding the redemption to ~1 microUSDC for a $1000 stake.

The LP path applies `assets * (10 ** (SHARE_DECIMALS - USDC_DECIMALS)) = assets * 1e12` on first deposit. The insurance path does not, so the dead-share defense becomes the attack vector.

**Remediation**: scale by `1e12` on first stake (when `_insAssets == 0`) and add a `minInitialInsuranceDeposit` to keep dead-share dilution sub-bps. A regression test is provided in `test/audit/audit-findings.test.ts`.

---

## High

### H-01 — Liquidation reverts when insurance can't cover shortfall, creating a stuck-position deadlock

**Where**: `contracts/libraries/LiquidationLib.sol::liquidatePosition`

If `coverBadDebt` returns less than the shortfall and `actualAvailable < receiveAmount`, the liquidation reverts. The position is now neither liquidatable nor closable, funding keeps accruing, and OI accounting stays inflated.

**Remediation**: when `actualAvailable < receiveAmount`, repay the vault with what's available, record the residual via `recordFailedRepayment` (currently never called from inside the libraries — see M-01), and let the position close out.

### H-02 — `MIN_TWAP_DATA_POINTS = 6` makes opens, closes, and SL/TP triggers operationally fragile

**Where**: `TradingLib._executeIncrease`, `PositionCloseLib.closePosition`, and `executeStopLossTakeProfit`.

Requires ≥ 25 minutes of consistent keeper writes before an open or close is accepted (15-minute window × `MIN_TWAP_UPDATE_INTERVAL = 5 minutes`). Any keeper outage or fresh listing wedges trading.

**Remediation**: soft-validate on the close path when the trader supplies a tighter `minReceive`; surface explicit "TWAP not ready" diagnostics; document keeper warm-up in the runbook.

### H-03 — `coverBadDebt` rate-limits payouts even after the cumulative breaker has cleared

**Where**: `contracts/core/VaultCore.sol::coverBadDebt → _checkClaimRateLimit`.

A cluster of small claims can push `rateLimitCurrentLevel > maxClaimsPerWindow` and revert `coverBadDebt`. `LiquidationLib` does not `try/catch` that revert; the liquidation itself reverts, cascading into H-01.

**Remediation**: rate-limit only the governance `submitClaim` / `processClaim` paths.

---

## Medium

### M-01 — `recordFailedRepayment` is documented as the bad-debt sink but never called internally

`TradingCore.recordFailedRepayment` is gated on `TRADING_CORE_ROLE` and not invoked anywhere in `LiquidationLib` or `PositionCloseLib`. `_failedRepayments` storage is unreachable in production. Tooling that depends on `failedRepaymentCount`, `failedRepaymentIdAt`, `getFailedRepayment`, or `resolveFailedRepayment` will see zero state.

### M-02 — `FundingLib.settleFunding` stores `spotRate`, not the EWMA, biasing the next interval

The averaging is only effective when the keeper settles every interval. Sparse settlement leaves the prior intervals unprotected against same-block OI manipulation right before a `settleFunding` call.

### M-03 — `executeStopLossTakeProfit` does not accept `priceUpdateData`

SL/TP closes execute on cached Pyth state, which can be up to `maxStaleness` (15 minutes) behind. Mirror the `executeOrder` signature and forward fresh Pyth updates.

### M-04 — Price-drop breaker uses a 5-minute bucket snapshot as reference, not a TWAP

Wash-style price walks within a single 5-minute bucket can avoid tripping the breaker. Use the validated TWAP for the reference value.

### M-05 — `MarketCalendar.getNextOpenTime` returns 0 on iteration exhaustion

After the `AllDaysClosed` early-exit, the 366-iteration cap can still be hit on dense holiday configs. Revert with a dedicated error instead of returning 0 silently.

### M-06 — `AllowListCompliance.batchSetWhitelist` has no batch-size cap

Compared to `AccessControlled.batchGrantRole`, the compliance batcher is unbounded and emits one event per address. Apply `MAX_BATCH_SIZE` and emit one roll-up event.

---

## Low / Informational

### L-01 — `PositionToken.setTransferFee` is permanently disabled

`feeBps > 0` always reverts (`TransferFeeNotSupported`). The fee-recipient timelock and the `FeeRecipient*` events are unreachable.

### L-02 — `PositionToken._update` forwards raw revert data via assembly

Fine under the trust assumption that `tradingCore` is admin-controlled; document the trust boundary.

### L-03 — `OracleAggregator.expireGlobalPause` emits `address(this)` as deactivator

Visible in monitoring as a "self-deactivation" — confusing. The dedicated `GlobalPauseAutoExpired` event already disambiguates; consider dropping the `GlobalPauseDeactivated(address(this))` emission.

### L-04 — `_failedRepayments` is unreachable storage (see M-01)

### L-05 — Trailing stops are storage-only, never enforced

`setTrailingStop` writes the field; no executor reads it. Either implement high-water-mark tracking or remove the setter.

### L-06 — `TradingCore.setMarketId` has no length cap

`OracleAggregator.setMarketId` caps at `MAX_MARKET_ID_BYTES = 32`; mirror that on `TradingCore`.

### L-07 — `recordPricePoint(address, uint256)` discards its second argument

Name the parameter and validate it as zero, or remove it from the signature.

### L-08 — `ConfigLib.setMarket` hardcodes `2000` for the dynamic-margin sanity check

Should reference `PositionMath.MAX_DYNAMIC_MAINTENANCE_BPS` (or a constant in `DataTypes`) to avoid drift.

### L-09 — `VaultCore.requestUnstake` is silently idempotent

A re-request on an active cooldown is a no-op without emitting an event, leaving UIs blind. Re-emit `UnstakeRequested` with the original timestamp.

---

## Architecture & code-quality

- Externally-linked libraries are linked via `unsafeAllowLinkedLibraries: true`. Library rotation has UUPS-equivalent blast radius — document in the runbook.
- `_authorizeUpgrade` on the UUPS contracts is `onlyAdmin` with no timelock. Consider a 48–72h timelock on upgrades.
- `viaIR + revertStrings: "strip"` keeps gas low but strips revert strings; rely on custom errors for diagnostics.
- `Events.sol` uses file-scope free events. Indexers must subscribe per-contract.
- `contracts/test/*.sol` is compiled into every artifact set; ensure deploy scripts do not link mocks into prod.

## Operational notes

- The TWAP buffer must warm up (≥ 25 minutes of keeper writes) before opens/closes work.
- Keeper liveness is required for `settleFunding` at least within `maxFundingIntervals × FUNDING_INTERVAL`.
- Insurance pool funding sets the floor below which H-01 freezes positions.
- Pyth update fees are paid by keepers via `executeOrder{value: fee}`; the protocol does not subsidize.

## Recommended next steps

1. Fix C-01 immediately and run the regression test in `test/audit/audit-findings.test.ts`.
2. Address H-01 and H-03 together — they cascade.
3. Run `slither contracts/` and `mythril analyze --solv 0.8.24` for an automated second pass.
4. Add a 72h timelock on `_authorizeUpgrade` for `TradingCore`, `VaultCore`, `OracleAggregator`.
