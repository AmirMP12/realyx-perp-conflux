// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @dev Minimal view of `TradingCore` exposing the keeper / liquidation entry
 *      points. Declared locally so this module stays decoupled from the full
 *      `ITradingCore` surface (which omits these keeper-only methods).
 */
interface ITradingCoreKeeperOps {
    function executeOrder(uint256 orderId, bytes[] calldata priceUpdateData) external payable;

    function executeStopLossTakeProfit(
        uint256[] calldata positionIds,
        bytes[] calldata priceUpdateData
    ) external payable returns (uint256 processed);

    function liquidatePosition(uint256 id) external returns (uint256 reward);

    function liquidatePositionPermissionless(uint256 id) external returns (uint256 reward);

    function withdrawKeeperFees() external;

    function canLiquidate(uint256 id) external view returns (bool can, uint256 healthFactor);

    function oracleAggregator() external view returns (address);
}

/**
 * @dev Pyth-style price push used to refresh the on-chain oracle cache before a
 *      liquidation (which itself takes no `priceUpdateData`).
 */
interface IOracleUpdater {
    function updatePrices(bytes[] calldata priceUpdateData) external payable returns (uint256 feeRefund);
}

/**
 * @title KeeperNetwork
 * @notice Decentralized, reward-incentivized keeper network and on-chain
 *         self-execution router for Realyx.
 *
 * @dev WHY THIS EXISTS
 *      `TradingCore.executeOrder` and `TradingCore.executeStopLossTakeProfit`
 *      are gated by `KEEPER_ROLE`, and liquidations by `LIQUIDATOR_ROLE`. That
 *      makes order/trigger execution depend on an allow-listed operator set: a
 *      single point of liveness failure and a censorship/MEV vector.
 *
 *      This module is granted `KEEPER_ROLE` (and optionally `LIQUIDATOR_ROLE`)
 *      on `TradingCore` and re-exposes those entry points permissionlessly.
 *      Anyone — optionally after posting a refundable stake — can:
 *        - execute resting orders (`executeOrder`),
 *        - self-execute stop-loss / take-profit / trailing triggers
 *          (`executeTriggers`),
 *        - liquidate underwater positions (`liquidate`).
 *
 *      Callers are made whole on the native Pyth update fee (any refund plus the
 *      keeper execution fee accrued inside the core is forwarded back to them)
 *      and earn an additional native bounty from a governance-funded reward
 *      pool. Liquidation rewards (USDC) paid by the core are forwarded in full.
 *
 *      Staked funds are tracked separately from the reward pool so governance
 *      can never withdraw a keeper's stake via `withdrawRewards`.
 *
 *      NETWORK PAUSE PHILOSOPHY (mirrors `TradingCore`): order/trigger execution
 *      is pausable (governance emergency stop), but `liquidate` is intentionally
 *      NOT pausable so the protocol's primary solvency mechanism cannot be
 *      stranded during the stress events that trigger a pause. The core's own
 *      oracle / TWAP / session / manual-price guards still apply on every path.
 */
contract KeeperNetwork is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------
    error ZeroAddress();
    error NotEligible();
    error InsufficientStake();
    error StakeLocked();
    error NoStake();
    error NothingToClaim();
    error InsufficientRewardPool();
    error EmptyBatch();
    error TransferFailed();

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------
    struct KeeperInfo {
        bool active; // currently registered and eligible (stake-gated mode)
        uint64 registeredAt; // first registration timestamp
        uint64 executions; // successful execution count (reputation)
        uint256 stake; // native tokens currently staked
        uint256 earnedNative; // lifetime native rewards forwarded
        uint64 unstakeReadyAt; // 0 = not unstaking; else timestamp stake is withdrawable
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------
    ITradingCoreKeeperOps public tradingCore;
    /// @notice USDC token used by the core to pay liquidation rewards.
    IERC20 public usdcToken;
    /// @notice Cached OracleAggregator (synced from the core; used for price pushes).
    IOracleUpdater public oracleAggregator;

    /// @notice When true, execution is fully permissionless (no registration).
    bool public permissionlessMode;
    /// @notice Minimum native stake required to be an eligible keeper (stake-gated mode).
    uint256 public minStake;
    /// @notice Delay between `requestUnstake` and `withdrawStake`.
    uint256 public unstakeDelay;
    /// @notice Total native tokens staked across all keepers (segregated from the reward pool).
    uint256 public totalStaked;

    /// @notice Native bounty paid to the caller per executed order, from the reward pool.
    uint256 public orderBounty;
    /// @notice Native bounty paid per position processed in a trigger batch.
    uint256 public triggerBounty;
    /// @notice Native bounty paid per successful liquidation (in addition to the USDC reward).
    uint256 public liquidationBounty;

    mapping(address => KeeperInfo) public keepers;
    /// @notice Native rewards that could not be pushed to a keeper (pull fallback).
    mapping(address => uint256) public claimableNative;

    uint256[40] private __gap;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event KeeperRegistered(address indexed keeper, uint256 stake);
    event KeeperStakeIncreased(address indexed keeper, uint256 added, uint256 total);
    event UnstakeRequested(address indexed keeper, uint256 readyAt);
    event StakeWithdrawn(address indexed keeper, uint256 amount);
    event OrderExecuted(uint256 indexed orderId, address indexed keeper, uint256 nativePaid);
    event TriggersExecuted(address indexed keeper, uint256 requested, uint256 processed, uint256 nativePaid);
    event PositionLiquidated(
        uint256 indexed positionId,
        address indexed keeper,
        uint256 usdcReward,
        uint256 nativePaid
    );
    event RewardForwarded(address indexed keeper, uint256 amount, bool pushed);
    event RewardsFunded(address indexed from, uint256 amount);
    event RewardsWithdrawn(address indexed to, uint256 amount);
    event ConfigUpdated(uint256 orderBounty, uint256 triggerBounty, uint256 liquidationBounty);
    event StakingConfigUpdated(bool permissionlessMode, uint256 minStake, uint256 unstakeDelay);
    event TradingCoreUpdated(address indexed tradingCore);
    event OracleSynced(address indexed oracleAggregator);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @param admin               Governance / DEFAULT_ADMIN_ROLE holder.
     * @param _tradingCore        TradingCore proxy address.
     * @param _usdc               USDC token (for forwarding liquidation rewards).
     * @param _permissionlessMode If true, anyone may execute without staking.
     * @param _minStake           Minimum native stake when not permissionless.
     */
    function initialize(
        address admin,
        address _tradingCore,
        address _usdc,
        bool _permissionlessMode,
        uint256 _minStake
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        if (admin == address(0) || _tradingCore == address(0) || _usdc == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        tradingCore = ITradingCoreKeeperOps(_tradingCore);
        usdcToken = IERC20(_usdc);
        permissionlessMode = _permissionlessMode;
        minStake = _minStake;
        unstakeDelay = 1 days;

        _syncOracle();
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ---------------------------------------------------------------------
    // Eligibility
    // ---------------------------------------------------------------------
    modifier onlyEligible() {
        if (!isEligible(msg.sender)) revert NotEligible();
        _;
    }

    /// @notice Whether `account` may execute through this network right now.
    function isEligible(address account) public view returns (bool) {
        if (permissionlessMode) return true;
        KeeperInfo storage k = keepers[account];
        return k.active && k.stake >= minStake;
    }

    // ---------------------------------------------------------------------
    // Keeper registration / staking
    // ---------------------------------------------------------------------

    /// @notice Register as a keeper, posting (or topping up) native stake.
    function registerKeeper() external payable nonReentrant {
        KeeperInfo storage k = keepers[msg.sender];
        k.stake += msg.value;
        totalStaked += msg.value;
        if (k.stake < minStake) revert InsufficientStake();

        if (!k.active) {
            k.active = true;
            k.unstakeReadyAt = 0;
            if (k.registeredAt == 0) k.registeredAt = uint64(block.timestamp);
            emit KeeperRegistered(msg.sender, k.stake);
        } else {
            emit KeeperStakeIncreased(msg.sender, msg.value, k.stake);
        }
    }

    /// @notice Begin the unstake cooldown. Keeper becomes ineligible immediately.
    function requestUnstake() external {
        KeeperInfo storage k = keepers[msg.sender];
        if (k.stake == 0) revert NoStake();
        k.active = false;
        k.unstakeReadyAt = uint64(block.timestamp + unstakeDelay);
        emit UnstakeRequested(msg.sender, k.unstakeReadyAt);
    }

    /// @notice Withdraw the full stake once the cooldown has elapsed.
    function withdrawStake() external nonReentrant {
        KeeperInfo storage k = keepers[msg.sender];
        uint256 amount = k.stake;
        if (amount == 0) revert NoStake();
        if (k.unstakeReadyAt == 0 || block.timestamp < k.unstakeReadyAt) revert StakeLocked();

        k.stake = 0;
        k.active = false;
        k.unstakeReadyAt = 0;
        totalStaked -= amount;

        _sendNative(msg.sender, amount);
        emit StakeWithdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // On-chain self-execution entry points (decentralized keeper actions)
    // ---------------------------------------------------------------------

    /**
     * @notice Permissionlessly execute a resting order.
     * @param orderId    Order id from `TradingCore.createOrder`.
     * @param updateData Pyth Hermes payload (or empty when not needed).
     * @return nativePaid Native tokens forwarded to the caller (refund + fee + bounty).
     * @dev Forward `msg.value` to cover the Pyth update fee; any refund is returned.
     */
    function executeOrder(
        uint256 orderId,
        bytes[] calldata updateData
    ) external payable nonReentrant whenNotPaused onlyEligible returns (uint256 nativePaid) {
        uint256 reservePre = address(this).balance - msg.value;
        uint256 poolPre = reservePre > totalStaked ? reservePre - totalStaked : 0;

        tradingCore.executeOrder{value: msg.value}(orderId, updateData);
        // Pull the execution fee the core credited to this contract (native).
        tradingCore.withdrawKeeperFees();

        nativePaid = _settle(msg.sender, reservePre, poolPre, orderBounty);
        keepers[msg.sender].executions += 1;
        emit OrderExecuted(orderId, msg.sender, nativePaid);
    }

    /**
     * @notice Permissionlessly execute stop-loss / take-profit / trailing-stop
     *         triggers for a batch of positions (on-chain condition checks run
     *         inside the core / TradingLib).
     * @param positionIds Positions to evaluate and close if their trigger is met.
     * @param updateData  Pyth Hermes payload (or empty).
     * @return processed  Number of positions actually closed by the core.
     */
    function executeTriggers(
        uint256[] calldata positionIds,
        bytes[] calldata updateData
    ) external payable nonReentrant whenNotPaused onlyEligible returns (uint256 processed) {
        if (positionIds.length == 0) revert EmptyBatch();
        uint256 reservePre = address(this).balance - msg.value;
        uint256 poolPre = reservePre > totalStaked ? reservePre - totalStaked : 0;

        processed = tradingCore.executeStopLossTakeProfit{value: msg.value}(positionIds, updateData);

        uint256 bounty = triggerBounty * processed;
        uint256 nativePaid = _settle(msg.sender, reservePre, poolPre, bounty);
        if (processed > 0) keepers[msg.sender].executions += 1;
        emit TriggersExecuted(msg.sender, positionIds.length, processed, nativePaid);
    }

    /**
     * @notice Permissionlessly liquidate an underwater position. The core pays
     *         the USDC liquidation reward to this contract; it is forwarded to
     *         the caller in full, plus a native bounty.
     * @param positionId Position to liquidate.
     * @param updateData Optional Pyth payload to refresh the oracle first.
     * @dev Intentionally NOT `whenNotPaused` (solvency backstop). Uses the
     *      role-gated `liquidatePosition` (this contract must hold
     *      `LIQUIDATOR_ROLE`); falls back to the permissionless core path if not.
     */
    function liquidate(
        uint256 positionId,
        bytes[] calldata updateData
    ) external payable nonReentrant onlyEligible returns (uint256 usdcReward, uint256 nativePaid) {
        uint256 reservePre = address(this).balance - msg.value;
        uint256 poolPre = reservePre > totalStaked ? reservePre - totalStaked : 0;

        if (updateData.length > 0) {
            _oracle().updatePrices{value: msg.value}(updateData);
        }

        uint256 usdcBefore = usdcToken.balanceOf(address(this));
        // Prefer the role-gated path (this contract holds LIQUIDATOR_ROLE).
        try tradingCore.liquidatePosition(positionId) returns (uint256) {
            // ok
        } catch {
            // Backstop: governance-enabled permissionless core path.
            tradingCore.liquidatePositionPermissionless(positionId);
        }
        usdcReward = usdcToken.balanceOf(address(this)) - usdcBefore;
        if (usdcReward > 0) usdcToken.safeTransfer(msg.sender, usdcReward);

        nativePaid = _settle(msg.sender, reservePre, poolPre, liquidationBounty);
        keepers[msg.sender].executions += 1;
        emit PositionLiquidated(positionId, msg.sender, usdcReward, nativePaid);
    }

    /// @notice Claim native rewards that failed to push during execution.
    function claimRewards() external nonReentrant {
        uint256 amount = claimableNative[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimableNative[msg.sender] = 0;
        _sendNative(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Reward settlement internals
    // ---------------------------------------------------------------------

    /**
     * @dev Compute the caller's payout and forward it.
     *      - `reservePre`: contract native balance before `msg.value` arrived.
     *      - `poolPre`:    reward pool (reserve minus staked funds) before the call.
     *      - `bountyReq`:  requested bounty, capped at the available pool.
     *      The caller receives everything the contract gained during the call
     *      (Pyth refund + keeper execution fee) plus the capped bounty.
     */
    function _settle(
        address keeper,
        uint256 reservePre,
        uint256 poolPre,
        uint256 bountyReq
    ) internal returns (uint256 paid) {
        uint256 bounty = bountyReq > poolPre ? poolPre : bountyReq;
        uint256 gained = address(this).balance - reservePre; // refund + execution fee
        paid = gained + bounty;
        if (paid > 0) {
            keepers[keeper].earnedNative += paid;
            _forwardReward(keeper, paid);
        }
    }

    /// @dev Push native reward; on failure (e.g. contract keeper) make it claimable.
    function _forwardReward(address keeper, uint256 amount) internal {
        (bool ok, ) = payable(keeper).call{value: amount, gas: 100000}("");
        if (!ok) {
            claimableNative[keeper] += amount;
        }
        emit RewardForwarded(keeper, amount, ok);
    }

    function _sendNative(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _oracle() internal returns (IOracleUpdater) {
        if (address(oracleAggregator) == address(0)) _syncOracle();
        return oracleAggregator;
    }

    function _syncOracle() internal {
        address oa = tradingCore.oracleAggregator();
        if (oa != address(0)) {
            oracleAggregator = IOracleUpdater(oa);
            emit OracleSynced(oa);
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Native reward pool available for bounties / withdrawal (excludes stakes).
    function rewardPool() public view returns (uint256) {
        uint256 bal = address(this).balance;
        return bal > totalStaked ? bal - totalStaked : 0;
    }

    /// @notice Convenience passthrough: is a position liquidatable right now?
    function canLiquidate(uint256 positionId) external view returns (bool can, uint256 healthFactor) {
        return tradingCore.canLiquidate(positionId);
    }

    // ---------------------------------------------------------------------
    // Governance
    // ---------------------------------------------------------------------

    /// @notice Fund the native reward pool.
    function fundRewards() external payable {
        emit RewardsFunded(msg.sender, msg.value);
    }

    receive() external payable {
        emit RewardsFunded(msg.sender, msg.value);
    }

    /// @notice Withdraw from the reward pool (never touches staked funds).
    function withdrawRewards(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount > rewardPool()) revert InsufficientRewardPool();
        _sendNative(to, amount);
        emit RewardsWithdrawn(to, amount);
    }

    function setBounties(
        uint256 _orderBounty,
        uint256 _triggerBounty,
        uint256 _liquidationBounty
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        orderBounty = _orderBounty;
        triggerBounty = _triggerBounty;
        liquidationBounty = _liquidationBounty;
        emit ConfigUpdated(_orderBounty, _triggerBounty, _liquidationBounty);
    }

    function setStakingConfig(
        bool _permissionlessMode,
        uint256 _minStake,
        uint256 _unstakeDelay
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        permissionlessMode = _permissionlessMode;
        minStake = _minStake;
        unstakeDelay = _unstakeDelay;
        emit StakingConfigUpdated(_permissionlessMode, _minStake, _unstakeDelay);
    }

    function setTradingCore(address _tradingCore) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_tradingCore == address(0)) revert ZeroAddress();
        tradingCore = ITradingCoreKeeperOps(_tradingCore);
        _syncOracle();
        emit TradingCoreUpdated(_tradingCore);
    }

    function setUsdcToken(address _usdc) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_usdc == address(0)) revert ZeroAddress();
        usdcToken = IERC20(_usdc);
    }

    /// @notice Re-read the OracleAggregator from the core (call after the core wires it).
    function syncOracle() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _syncOracle();
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
