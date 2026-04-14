// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";

/**
 * @title IVaultCore
 * @notice Unified USDC vault: LP liquidity for trading, insurance fund, borrowing/repay hooks for `TradingCore`, and bad-debt workflows.
 * @dev Many mutators are restricted to `TradingCore` or role-gated; read functions are safe for UI and risk dashboards.
 */
interface IVaultCore {
    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event Withdraw(address indexed user, uint256 assets, uint256 shares);
    event WithdrawalQueued(address indexed user, uint256 shares, uint256 requestId);
    event WithdrawalProcessed(uint256 indexed requestId, address indexed user, uint256 assets);
    event ExposureUpdated(address indexed market, uint256 longExposure, uint256 shortExposure);
    event PnLSettled(address indexed market, int256 pnl, bool isProfit);
    event EmergencyModeActivated(uint256 timestamp);
    event EmergencyModeDeactivated(uint256 timestamp);

    event InsuranceStaked(address indexed user, uint256 assets, uint256 shares);
    event InsuranceUnstaked(address indexed user, uint256 assets, uint256 shares);
    event BadDebtCovered(uint256 indexed claimId, uint256 amount, uint256 positionId);
    event ClaimSubmitted(uint256 indexed claimId, uint256 amount, uint256 positionId);
    event FeeReceived(uint256 amount, string feeType);
    event SurplusDistributed(uint256 total, uint256 stakerShare, uint256 treasuryShare);

    /**
     * @notice Mint LP shares by depositing USDC.
     * @param assets USDC amount (6 decimals).
     * @param receiver Address credited with LP shares.
     * @return shares LP shares minted (18-decimal share token accounting).
     * @dev First deposit may require a minimum size to resist inflation attacks; reverts in global emergency mode when configured.
     */
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    /**
     * @notice Redeem LP shares for USDC immediately when liquidity and health checks allow.
     * @param shares LP shares to burn.
     * @param receiver Recipient of USDC.
     * @param owner Share owner; must equal `msg.sender` in the implementation.
     * @return assets USDC transferred out.
     */
    function withdraw(uint256 shares, address receiver, address owner) external returns (uint256 assets);

    /**
     * @notice Queue a withdrawal: burns shares from the caller and creates a timed request processed later.
     * @param shares LP shares to queue.
     * @param minAssets Minimum USDC to accept at processing time; request cancels with event if unmet.
     * @return requestId Id for `processWithdrawals` / `getWithdrawalRequest`.
     */
    function queueWithdrawal(uint256 shares, uint256 minAssets) external returns (uint256 requestId);

    /**
     * @notice Finalize queued withdrawals after cooldown and liquidity checks (keeper or public batch).
     * @param requestIds Withdrawal request identifiers.
     * @return processed Count successfully completed in this call (may be less than input length due to gas caps).
     */
    function processWithdrawals(uint256[] calldata requestIds) external returns (uint256 processed);

    /**
     * @notice Lend USDC from the LP pool to `TradingCore` for an open position leg.
     * @param amount USDC to transfer out.
     * @param market Market being borrowed against.
     * @param isLong Whether exposure is long or short side.
     * @return success False if utilization, exposure caps, or liquidity would be violated.
     */
    function borrow(uint256 amount, address market, bool isLong) external returns (bool success);

    /**
     * @notice Return principal and realized PnL from `TradingCore` after a trade or liquidation leg.
     * @param amount Principal component returned in USDC precision.
     * @param market Market whose exposure was updated.
     * @param isLong Side of the book.
     * @param pnl Signed PnL: losses reduce returned principal; profits may be paid out to the caller per rules.
     */
    function repay(uint256 amount, address market, bool isLong, int256 pnl) external;

    /**
     * @notice Adjust recorded open interest for a market without moving tokens (size-only exposure tracking).
     * @param market Market address.
     * @param sizeDelta Signed change in exposure units.
     * @param isLong Which side to apply the delta to.
     */
    function updateExposure(address market, int256 sizeDelta, bool isLong) external;

    /**
     * @notice Stake USDC into the insurance tranche; mints insurance shares to `receiver`.
     * @param assets USDC deposited.
     * @param receiver Address credited with insurance shares.
     * @return shares Insurance shares minted.
     */
    function stakeInsurance(uint256 assets, address receiver) external returns (uint256 shares);

    /**
     * @notice Burn insurance shares for USDC after cooldown and health checks.
     * @param shares Insurance shares to redeem.
     * @param receiver Recipient of USDC.
     * @return assets USDC amount transferred.
     */
    function unstakeInsurance(uint256 shares, address receiver) external returns (uint256 assets);

    /**
     * @notice Start the unstake cooldown timer for `msg.sender`.
     */
    function requestUnstake() external;

    /**
     * @notice Pay bad debt from the insurance pool up to available assets and governance thresholds.
     * @param amount Claimed shortfall to cover.
     * @param positionId Originating position for analytics.
     * @return covered USDC actually sent to `TradingCore` (may be less than `amount`).
     */
    function coverBadDebt(uint256 amount, uint256 positionId) external returns (uint256 covered);

    /**
     * @notice Open a governance bad-debt claim above the auto-approval threshold.
     * @param amount Claim size in USDC.
     * @param positionId Linked position id.
     * @return claimId Identifier for `approveClaim` / `processClaim`.
     */
    function submitClaim(uint256 amount, uint256 positionId) external returns (uint256 claimId);

    /**
     * @notice Guardian approves a pending claim for payout processing.
     * @param claimId Claim identifier.
     */
    function approveClaim(uint256 claimId) external;

    /**
     * @notice Pay out an approved claim from insurance liquidity.
     * @param claimId Claim identifier.
     * @return paid USDC transferred in this step (partial payouts allowed).
     */
    function processClaim(uint256 claimId) external returns (uint256 paid);

    /**
     * @notice Credit trading fees from `TradingCore` into fee accounting.
     * @param amount USDC fee amount.
     */
    function receiveFees(uint256 amount) external;

    /**
     * @notice Sweep insurance surplus above target to treasury and/or stakers per configuration.
     */
    function distributeSurplus() external;

    /**
     * @notice Enter restrictive emergency mode (guardian).
     */
    function triggerEmergencyMode() external;

    /**
     * @notice Exit emergency mode when utilization is safe (admin).
     */
    function stopEmergencyMode() external;

    /**
     * @notice LP-side total assets including borrows and global PnL adjustments (implementation-defined precision).
     */
    function totalAssets() external view returns (uint256);

    /**
     * @notice USDC held in the insurance tranche.
     */
    function insuranceAssets() external view returns (uint256);

    /**
     * @notice Total supply of LP shares (including dead shares if any).
     */
    function lpTotalShares() external view returns (uint256);

    /**
     * @notice Total supply of insurance shares.
     */
    function insTotalShares() external view returns (uint256);

    /**
     * @notice Pool utilization ratio (BPS or `1e18` scale per implementation docs on `VaultCore`).
     */
    function getUtilization() external view returns (uint256);

    /**
     * @notice Immediately withdrawable USDC balance in the vault contract (not reserved borrows).
     */
    function getAvailableLiquidity() external view returns (uint256);

    /**
     * @notice LP share price: assets per share in price precision.
     */
    function getLPSharePrice() external view returns (uint256);

    /**
     * @notice Long/short open interest tracked per market.
     */
    function getMarketExposure(address market) external view returns (DataTypes.MarketExposure memory);

    /**
     * @notice Whether emergency mode is active.
     */
    function isEmergencyMode() external view returns (bool);

    /**
     * @notice LP share balance of `user`.
     */
    function lpBalanceOf(address user) external view returns (uint256);

    /**
     * @notice Insurance share balance of `user`.
     */
    function insBalanceOf(address user) external view returns (uint256);

    /**
     * @notice Preview shares minted for a deposit at current exchange rate.
     */
    function previewDeposit(uint256 assets) external view returns (uint256);

    /**
     * @notice Preview assets received for burning `shares` LP shares.
     */
    function previewWithdraw(uint256 shares) external view returns (uint256);

    /**
     * @notice Metadata for a queued withdrawal request.
     */
    function getWithdrawalRequest(uint256 requestId) external view returns (DataTypes.WithdrawalRequest memory);

    /**
     * @notice Metadata for a bad-debt claim.
     */
    function getClaim(uint256 claimId) external view returns (DataTypes.BadDebtClaim memory);

    /**
     * @notice Insurance fund size relative to reported protocol TVL (health numerator/denominator).
     */
    function getInsuranceHealthRatio() external view returns (uint256);

    /**
     * @notice True when insurance ratio is above the configured minimum.
     */
    function isInsuranceHealthy() external view returns (bool);

    /**
     * @notice Underlying ERC20 asset (USDC).
     */
    function asset() external view returns (address);

    /**
     * @notice Convert `assets` to LP shares at current rate (ERC4626-style helper).
     */
    function convertToShares(uint256 assets) external view returns (uint256);

    /**
     * @notice Convert `shares` to underlying assets at current rate.
     */
    function convertToAssets(uint256 shares) external view returns (uint256);

    /**
     * @notice Maximum deposit allowed for `receiver` (often unbounded pure max).
     */
    function maxDeposit(address receiver) external view returns (uint256);

    /**
     * @notice Maximum LP shares `owner` can redeem in the current mode.
     */
    function maxRedeem(address owner) external view returns (uint256);
}
