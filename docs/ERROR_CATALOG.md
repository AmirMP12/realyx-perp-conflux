# Realyx — custom error catalog (integrators)

Solidity custom errors bubble up from **libraries** to the **outer contract** that called them. In practice, decode reverts on the contract the user called (`TradingCore`, `VaultCore`, `OracleAggregator`, `PositionToken`, …). `TradingCore` mirrors some `TradingLib` errors so tooling can use a single ABI.

Legend: **Meaning** (what failed). **Typical cause**. **Suggested fix** (integrator / operator).

---

## Access & roles (`AccessControlled`)

| Error | Meaning | Typical cause | Suggested fix |
|-------|---------|---------------|---------------|
| `NotAdmin()` | Caller lacks `ADMIN_ROLE`. | Non-admin called `onlyAdmin` function. | Use admin key or multisig; grant role via `grantRole` if policy allows. |
| `NotOperator()` | Caller lacks `OPERATOR_ROLE` (or `onlyAdminOrOperator` failed). | Wrong wallet for market/oracle ops. | Grant `OPERATOR_ROLE` or use operator wallet. |
| `NotGuardian()` | Caller lacks `GUARDIAN_ROLE`. | Non-guardian for pause/breaker/emergency paths. | Use guardian multisig. |
| `NotOracle()` | Caller lacks `ORACLE_ROLE`. | Price feed admin action. | Grant `ORACLE_ROLE` or use designated oracle bot. |
| `NotLiquidator()` | Caller lacks `LIQUIDATOR_ROLE`. | `liquidatePosition` from random EOA. | Grant role to liquidator bot / partner. |
| `NotKeeper()` | Caller lacks `KEEPER_ROLE`. | `executeOrder` or keeper-only path. | Grant role to relayer service. |
| `NotTradingCore()` | Caller lacks `TRADING_CORE_ROLE`. | Vault borrow/repay from non-core. | Only `TradingCore` proxy should hold this role on `VaultCore`. |
| `BatchSizeExceeded()` | Admin batch grant list too long. | Oversized `batchGrantRole` input. | Split into smaller batches (see contract limit). |
| `DuplicateAddress()` | Duplicate entry in batch grant. | Same address twice in array. | Deduplicate addresses. |

`ZeroAddress()` also appears on cores when init/setters get `address(0)` — treat as validation (see below).

---

## Trading engine (`TradingCore` + `TradingLib` / linked libs)

Many rows apply to **user txs** (`closePosition`, `createOrder`, …); some are **keeper-only** or **role-only**.

| Error | Meaning | Typical cause | Suggested fix |
|-------|---------|---------------|---------------|
| `NotPositionOwner()` | `msg.sender` does not own the position NFT. | Wrong wallet or stale UI. | Connect correct wallet; refresh position id. |
| `InsufficientCollateral()` | Margin too low for action (open, add, modify). | Size/leverage vs collateral. | Add collateral or reduce size/leverage. |
| `FlashLoanDetected()` | Same-block / flash-loan guard tripped. | MEV bot or scripted same-block loop. | Space txs across blocks; avoid suspicious patterns; operators may tune `FlashLoanCheck` params. |
| `DeadlineExpired()` | `block.timestamp` > `deadline` in params. | Slow mempool / user waited too long. | Resubmit with fresh deadline. |
| `BreakerActive()` | Oracle / risk breaker blocks **risk-increasing** flow. | `OracleAggregator.isActionAllowed(market, 0)` false. | Wait for operator to reset breakers / pause lifted; do not retry open blindly. |
| `PositionTooSmall()` | Remaining notionals below `minPositionSize` after partial close. | `partialClose` left dust. | Close fully or leave size above minimum. |
| `NotPositionToken()` | `updatePositionOwner` caller is not `PositionToken`. | Direct call to hook. | Only NFT contract should call; integrators ignore. |
| `ProtocolUnhealthy()` | Global health flag false (often vault-related). | Bad debt / keeper health update. | Pause risk-increasing UX; operators fix solvency / run health keeper. |
| `InsufficientOracleSources()` | `getValidSourceCount(market)` below minimum. | Feed not configured or unhealthy. | Operator: `setPythFeed`, fix Pyth; user: wait. |
| `PositionNotFound()` | No open position for id / wrong state. | Closed id, typo, wrong chain. | Refresh positions; verify `chainId` and contract address. |
| `Unauthorized()` | Generic auth (e.g. views unset, cleanup rules). | `tradingViews` zero, or cleanup on others’ positions without admin. | Set `tradingViews`; only self-cleanup unless admin. |
| `TransferToContractNotAllowed()` | USDC transfer blocked to contracts. | Smart contract wallet without ERC1271-style allowance. | Use EOA or supported wallet pattern. |
| `ComplianceCheckFailed()` | `IComplianceManager.isAllowed` returned false. | Geo / allow-list policy. | Do not retry; user not permitted for that market. |
| `MarketClosed()` | `IMarketCalendar` says session closed for RWA id. | Outside equity hours. | Show “market closed”; retry when open. |
| `DeviationOutOfRange()` | Entry/exit price vs oracle outside allowed band. | Volatile print or stale UI price. | Refresh oracle; widen slippage bounds only if product allows. |
| `InvalidOraclePrice()` | Oracle returned unusable price (mirrored from lib for decoding). | Zero/invalid Pyth payload, bad feed. | Operator: feeds; user: retry after update. |
| `MinPositionDuration()` | Close too soon after open. | Anti-gaming window. | Wait until `minPositionDuration` elapsed. |
| `ExecutionFeeTooLow()` | `msg.value` below `minExecutionFee` for order. | Underpaid keeper fee on `createOrder`. | Send correct `msg.value` with order. |
| `MarketNotActive()` | Market not listed / inactive in core. | `unlistMarket` or never listed. | Operator: `setMarket`; user: pick active market. |
| `ExceedsMaxLeverage()` | Requested leverage above market cap. | UI default too high. | Clamp leverage to `getMarketInfo(market).maxLeverage` (semantic per deployment). |
| `ExceedsMaxPositionSize()` | Position size cap. | User or bot too large. | Reduce size. |
| `ExceedsMaxTotalExposure()` | Global or book exposure cap. | Protocol risk limit. | Reduce size or wait for capacity. |
| `InsufficientLiquidity()` | Vault could not borrow enough USDC. | High utilization / caps. | Retry later; LP adds liquidity; operator raises caps if safe. |
| `LiquidationPriceDeviation()` | Liquidation price vs oracle out of tolerance. | Oracle moved during liq. | Retry with fresh price; operator tune `liquidationDeviationBps`. |
| `SlippageExceeded()` | Exit proceeds below `minReceive`. | Volatile market / tight min. | Increase slippage tolerance or split close. |
| `CloseSizeExceedsPosition()` | Close size > open size. | Buggy client math. | Fix client to ≤ position size. |
| `ZeroCloseSize()` | Zero close requested. | Client bug. | Send positive close size. |
| `PositionNotLiquidatable()` | Health above liquidation threshold. | Bot too eager. | Only liquidate when `canLiquidate` true. |
| `OpenPriceDeviation()` | Entry price vs oracle too far. | Stale quote in UI. | Refresh price; operator tune open deviation. |
| `InsufficientLiquidatorReward()` | Vault cannot pay liquidator incentive. | Config / liquidity edge case. | Operator: fee tiers / vault funding. |
| `RepaymentFailedCritical()` | Critical repay path failed in lib. | Insolvent edge or token revert. | Incident: pause, investigate logs. |
| `CommitRevealRequired()` | Optional commit-reveal gate (if enabled in build). | Feature flag / rare path. | Follow two-step flow if product enables. |
| `MaxPositionsExceeded()` | User hit `maxPositionsPerUser`. | Too many open NFTs. | Close positions or raise limit (admin). |
| `InvalidOrder()` | Limit order trigger vs spot invalid. | LIMIT_INCREASE conditions not met. | Fix trigger vs side. |
| `OrderNotFound()` | No such order id. | Already executed/cancelled, wrong id. | Refresh order book state. |
| `RepaymentValidationFailed()` | Internal repay validation in lib. | Accounting mismatch after liq. | Ops: reconcile vault vs core. |
| `InvalidOrResolvedFailedRepayment()` | Admin resolve on missing/already cleared bad debt record. | Wrong `positionId`. | Verify `_failedRepayments` / events. |

**Position triggers** (`PositionTriggersLib`): `InvalidStopLoss()`, `InvalidTakeProfit()`, `InvalidTrailingStop()` — price/BPS vs oracle or ordering rules; fix SL/TP/trailing params.

**Close / liq** (`PositionCloseLib`, `LiquidationLib`): `InsufficientLiquidityForRepayment()`, `RepayFailed()` — vault cannot absorb leg; ops liquidity / exposure.

**Config** (`ConfigLib`): `InvalidMarket()`, `MarketAlreadyListed()`, `InvalidMarginConfig()`, `MaxActiveMarketsExceeded()` — operator listing mistakes; fix params or unlist first.

**Fees** (`FeeCalculator`): `InvalidFeeConfig()` — admin `setFeeConfig` rejected; use valid bps sums per implementation.

**Rate limit** (`RateLimitLib`, `FlashLoanCheck`): `RateLimitExceeded()` — too many actions per window; slow down client.

**Math** (`PositionMath`): `InvalidPositionSize()`, `InvalidLeverage()`, `InvalidPrice()`, `DivisionByZero()`, `OverflowRisk()`, `PositionSizeTooLarge()`, `FundingDeltaTooLarge()`, `FundingOverflow()` — bad inputs or extreme funding; validate client-side; ops check parameters.

---

## Vault (`VaultCore`)

| Error | Meaning | Typical cause | Suggested fix |
|-------|---------|---------------|---------------|
| `InsufficientShares()` | Burn more LP/insurance shares than balance. | Rounding or double-spend UI. | Refresh balance; lower amount. |
| `InsufficientLiquidity()` | Not enough free USDC for instant withdraw. | High borrow utilization. | Use `queueWithdrawal` or wait for repayments. |
| `ExceedsExposureCap()` | `updateExposure` would exceed per-market cap. | TradingCore bug or mis-set cap. | Operator: `setMaxExposure`; devs: check OI math. |
| `UtilizationTooHigh()` | Borrow path rejects due to utilization (non-revert false on `borrow` in some paths; still used elsewhere). | Pool stressed. | Add LP liquidity; reduce new positions. |
| `EmergencyModeActive()` | LP `deposit`/`withdraw` blocked in emergency. | Guardian triggered emergency. | Wait for `stopEmergencyMode` or use escape path per policy. |
| `WithdrawalNotReady()` | Queued withdrawal before cooldown. | `processWithdrawals` too early. | Wait `withdrawalCooldown`. |
| `InvalidRequest()` | Bad request id, batch too large, or empty queue row. | Wrong `requestIds` or corrupted state. | Verify id; operator investigate. |
| `MinimumDepositRequired()` | First LP deposit below anti-inflation minimum. | Too small `deposit`. | Increase `assets` past `minInitialDeposit`. |
| `ZeroShares()` / `ZeroAssets()` | Zero mint/redeem. | User sent 0. | Send positive amount. |
| `NotOwner()` | `withdraw` owner != `msg.sender`. | Delegation not supported on that path. | Call from `owner` or implement separate pattern. |
| `UnhealthyRatio()` | Insurance ratio would break minimum after unstake. | Large unstake vs TVL. | Partial unstake later; operator adjust TVL/ratios. |
| `CooldownNotComplete()` / `CooldownNotStarted()` | Insurance unstake without waiting / without `requestUnstake`. | User skipped steps. | Call `requestUnstake`, wait `unstakeCooldown`. |
| `ClaimNotApproved()` | `processClaim` on unapproved claim. | Governance lag. | Guardian `approveClaim` first. |
| `InvalidTVL()` | `updateProtocolTVL` above max. | Operator typo. | Lower value or admin raises `setMaxProtocolTVL`. |
| `ClaimRateLimitExceeded()` | Bad-debt payout rate limit. | Too many claims in window. | Spread payouts; admin tune limits. |
| `InsuranceFundCircuitBreakerActive()` | Insurance CB tripped on bad debt velocity. | Stress event. | Operator: `resetInsuranceCircuitBreaker` after review (admin). |
| `CollectionExposureLimitExceeded()` | Reserved / per-deployment exposure guard (error exists on `VaultCore`; confirm `revert` sites in your tagged release). | Per-market collection cap. | Same playbook as `ExceedsExposureCap`; grep release tag for callers. |
| `InsufficientRepayBalance()` | `TradingCore` did not send enough USDC on `repay`. | Contract balance < required receive. | Ensure core holds USDC before repay. |
| `InvalidFirstDeposit()` | LP pool state inconsistent for first deposit. | Donation attack vector blocked. | Follow first-deposit min rules; fresh deploy if test corrupted. |
| `ClaimInvalidOrPaid()` | Double `approveClaim` / wrong id. | Already paid claim. | Refresh claim state from `getClaim`. |
| `NotEmergencyMode()` | `emergencyEscapeWithdraw` while not in emergency. | User wrong function. | Use normal `withdraw` / queue. |
| `EscapeTimelockNotExpired()` | Escape hatch too early after emergency. | User impatient. | Wait `MAX_EMERGENCY_DURATION` after activation (see contract). |

**Withdrawals** (`WithdrawLib`): `TransferFailed()` — USDC transfer revert; check token paused / blacklist.

---

## Oracle (`OracleAggregator` + libs)

| Error | Meaning | Typical cause | Suggested fix |
|-------|---------|---------------|---------------|
| `StalePrice()` | Pyth `publishTime` older than `maxStaleness` (session rules may widen). | Hermes lag, network outage, wrong feed id. | Push fresh `updatePriceFeeds` before txs; operator increases staleness only if policy allows. |
| `InsufficientConfidence()` | Oracle confidence above `maxUncertainty` / ratio rule. | Wide Pyth conf during stress. | Wait for better feed; relax `maxConfidence` carefully (operator). |
| `PriceOutOfBounds()` | Price outside configured min/max band. | Flash print or mis-set bounds. | Operator adjust `minPrice`/`maxPrice`; investigate manipulation. |
| `InvalidSource()` | Missing or zero feed / bad Pyth payload. | Feed not set, wrong network. | `setPythFeed`; verify `feedId` on Conflux. |
| `DataNotFound()` | Pyth call reverted or historical slot empty. | Bad feed, wrong id, no TWAP history. | Update feeds; for history use valid `hoursAgo`. |
| `DeviationTooHigh()` | Aggregated vs reference deviation too large. | Multi-source divergence (if used). | Ops review feeds; pause trading if needed. |
| `AdapterNotFound()` | Legacy adapter id (if any in deployment). | Misconfiguration. | Operator: register adapter or disable path. |
| `TimelockNotExpired()` | Governance timelock on sensitive change. | Too early second tx. | Wait timelock; document per deployment. |
| `NoEthUsdFeed()` | `ethFeedId` unset for ETH/USD reads. | Config not finished. | Operator `setEthFeedId`. |
| `TWAPUpdateTooFrequent()` | Ring buffer append throttled. | Keeper spamming `recordPricePoint`. | Respect `MIN_TWAP_UPDATE_INTERVAL`. |
| `SequencerDown()` / `SequencerGracePeriodNotOver()` | L2 sequencer safety (if enabled for deployment). | Rollup outage. | Pause opens; follow rollup status. |
| `BreakerNotConfigured()` | Operating on unset breaker type. | Config order wrong. | `configureBreaker` before `triggerBreaker`. |
| `BreakerAlreadyTriggered()` / `BreakerNotTriggered()` | Double trigger or reset without trigger. | Ops mistake. | Check `getBreakerStatus`. |
| `CooldownActive()` | Breaker cooldown not elapsed. | Too fast reset/retry. | Wait `cooldownSeconds`. |
| `InvalidWindowSeconds()` / `InvalidCooldownSeconds()` | Bad breaker params. | Operator typo. | Fix window/cooldown to sane ranges. |
| `InsufficientConfirmations()` | Emergency pause/price quorum not met. | Not enough guardians confirmed. | Additional guardians call `confirm*`. |
| `AlreadyConfirmed()` | Same guardian confirmed twice. | Retry duplicate tx. | No-op off-chain; use fresh proposal id. |
| `ProposalNotFound()` / `ProposalExpired()` | Unknown or expired pause/price proposal. | Wrong `pauseId` / `proposalId` or clock. | Propose again; sync chain time. |
| `GlobalPauseActive()` | Global kill-switch on. | Incident response. | Admin `deactivateGlobalPause` when safe. |
| `NotRegistered()` | Target not in pausable registry. | Emergency pause list incomplete. | `registerPausable` for core contracts. |
| `InsufficientTWAPData()` | TWAP window has too few samples. | New market or sparse updates. | Keepers run `recordPricePoint`; widen window only if policy allows. |
| `EmergencyPriceDeviationTooHigh()` | Manual price too far from spot. | Protective revert on bad governance input. | Re-propose closer to spot or follow multi-step policy. |
| `EmergencyPriceProposalNotFound()` / `EmergencyPriceAlreadyConfirmed()` / `EmergencyPriceProposalExpired()` | Emergency price workflow state errors. | Wrong id / double confirm / clock. | Align with `EmergencyPriceLib` flow. |
| `NotOracleOrKeeper()` | `recordPricePoint` from random address. | Open call. | Grant `ORACLE_ROLE` or `KEEPER_ROLE`. |
| `AlreadyInitialized()` | Second `initialize` on implementation/proxy misuse. | Redeploy mistake. | Use fresh proxy; never re-init live proxy. |

**OracleAggregatorLib**: `NoValidPrice()`, `TWAPOverflow()` — internal TWAP math guards; ops check buffer corruption / params.

**EmergencyPauseLib**: overlaps `ProposalNotFound`, etc. — same playbook as oracle table.

---

## Position NFT (`PositionToken`)

| Error | Meaning | Typical cause | Suggested fix |
|-------|---------|---------------|---------------|
| `TradingCoreAlreadySet()` | Tried to change core twice. | Re-init attack blocked. | Immutable core after set. |
| `InvalidFee()` | Transfer fee bps too high. | Admin config error. | Lower `setTransferFee`. |
| `TokenDoesNotExist()` | `tokenURI` / op on burned id. | Stale id. | Refresh metadata. |
| `ContractRecipientNotAllowed()` | Transfer to blocking contract recipient. | Policy / security. | Transfer to EOA or allow-listed pattern. |
| `UseCanonicalMint()` | Wrong mint overload used. | Direct contract call. | Use `TradingCore`-driven mint path. |
| `TransferFeeNotSupported()` | Feature not enabled for path. | Client used unsupported transfer. | Use supported transfer mode. |
| `TradingCoreUpdateFailed()` / `PositionOwnershipUpdateFailed()` | Internal hook failures. | Core revert on owner sync. | Check `TradingCore` / compliance state. |

---

## Other modules (less common for frontends)

| Error | Source | Meaning / fix (short) |
|-------|--------|------------------------|
| `InvalidFeeConfig()` | `FeeCalculator` | Admin fee struct invalid — fix bps fields. |
| `InvalidAmount()` / `FeeExceedsAmount()` | `FeeCalculator` | Amount math — check inputs. |
| `IndexDeltaTooLarge()` / `DividendOverflow()` / `DividendTooLarge()` | `DividendManager` | Dividend params too aggressive — operator smaller steps. |
| `InvalidTime()` / `OpenMustBeBeforeClose()` / `InvalidDay()` | `MarketCalendar` | Bad session config — fix hours/days. |
| `AlreadyInitialized()` | `TradingCoreViews` | Views proxy already inited — use correct deploy script. |

---

## Decoder tips

1. **Selector**: first 4 bytes of `keccak256("ErrorName(type1,...)")` — match against ABIs of `TradingCore`, `VaultCore`, `OracleAggregator`, `PositionToken`, and linked libraries if decoding raw traces.
2. **User-facing copy**: map selector → row in this table; show “oracle stale / market closed / breaker” buckets for less technical users.
3. **When in doubt**: read the **latest** `deployment/<network>.json` and verify you are on the correct **chain id** (Conflux eSpace testnet `71`, mainnet `1030` per repo config).

This catalog is a **best-effort** summary; always confirm against the deployed ABI and source version you ship.
