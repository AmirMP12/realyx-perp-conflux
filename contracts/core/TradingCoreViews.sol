// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../libraries/DataTypes.sol";
import "../libraries/PositionMath.sol";
import "../interfaces/IVaultCore.sol";
import "../interfaces/IOracleAggregator.sol";
import "../interfaces/ITradingCore.sol";

/**
 * @title TradingCoreViews
 * @notice View-only facade for TradingCore monitoring
 * @dev This contract is intentionally **not** UUPS-upgradeable. It is a
 *      stateless view facade pinned by `TradingCore.tradingViews`. To swap the views
 *      logic, deploy a new instance and call `TradingCore.setTradingViews(newAddr)`.
 *      The constructor immediately transfers ownership semantics via `Ownable` so
 *      no `_disableInitializers` is needed (there is no proxy implementation slot
 *      to lock).
 */
contract TradingCoreViews is Ownable {
    error AlreadyInitialized();
    error ZeroAddress();

    uint256 private constant BPS = 10000;

    ITradingCore public tradingCore;
    IVaultCore public vaultCore;
    IOracleAggregator public oracleAggregator;

    event Initialized(address indexed tradingCore, address indexed vaultCore, address indexed oracleAggregator);

    constructor() Ownable(msg.sender) {}

    function initialize(address _tradingCore, address _vaultCore, address _oracleAggregator) external onlyOwner {
        if (address(tradingCore) != address(0)) revert AlreadyInitialized();
        if (_tradingCore == address(0) || _vaultCore == address(0) || _oracleAggregator == address(0))
            revert ZeroAddress();
        tradingCore = ITradingCore(_tradingCore);
        vaultCore = IVaultCore(_vaultCore);
        oracleAggregator = IOracleAggregator(_oracleAggregator);
        emit Initialized(_tradingCore, _vaultCore, _oracleAggregator);
    }

    function getProtocolHealth()
        external
        view
        returns (
            bool isHealthy,
            uint256 totalBadDebt,
            uint256 totalAssets,
            uint256 badDebtRatioBps,
            uint256 lastHealthCheck,
            int256 globalPnL
        )
    {
        (bool healthy, uint256 badDebt, uint64 lastCheck) = _getProtocolHealthState();
        totalAssets = vaultCore.totalAssets();
        totalBadDebt = badDebt;
        isHealthy = healthy;
        lastHealthCheck = lastCheck;
        badDebtRatioBps = totalAssets > 0 ? (totalBadDebt * BPS) / totalAssets : 0;
        globalPnL = tradingCore.getGlobalUnrealizedPnL();
    }

    function getCircuitBreakerStatus(
        address market
    ) external view returns (bool isRestricted, uint256 activeBreakers, bool globalPause) {
        (isRestricted, activeBreakers) = oracleAggregator.isMarketRestricted(market);
        globalPause = oracleAggregator.isGloballyPaused();
    }

    function getPositionHealth(
        uint256 positionId
    )
        external
        view
        returns (
            bool isLiquidatable,
            uint256 healthFactor,
            int256 unrealizedPnL,
            uint256 currentPrice,
            bool stopLossTriggered,
            bool takeProfitTriggered
        )
    {
        DataTypes.Position memory pos = tradingCore.getPosition(positionId);
        if (pos.state != DataTypes.PosStatus.OPEN) {
            return (false, type(uint256).max, 0, 0, false, false);
        }
        (currentPrice, , ) = oracleAggregator.getPrice(pos.market);
        (unrealizedPnL, healthFactor) = tradingCore.getPositionPnL(positionId);
        (isLiquidatable, ) = tradingCore.canLiquidate(positionId);
        stopLossTriggered = _shouldTriggerStopLoss(pos, currentPrice);
        takeProfitTriggered = _shouldTriggerTakeProfit(pos, currentPrice);
    }

    function getPositionPnL(address core, uint256 id) external view returns (int256 pnl, uint256 hf) {
        DataTypes.Position memory p = ITradingCore(core).getPosition(id);
        if (p.state != DataTypes.PosStatus.OPEN) return (0, 0);
        (uint256 amount, ) = ITradingCoreExtended(core).getPositionCollateral(id);
        (uint256 price, , ) = oracleAggregator.getPrice(p.market);
        return PositionMath.getPositionPnLExt(p, amount, price);
    }

    function canLiquidate(address core, uint256 id) external view returns (bool, uint256 hf) {
        DataTypes.Position memory p = ITradingCore(core).getPosition(id);
        if (p.state != DataTypes.PosStatus.OPEN) return (false, type(uint256).max);
        (uint256 amount, ) = ITradingCoreExtended(core).getPositionCollateral(id);
        (uint256 price, , ) = oracleAggregator.getPrice(p.market);
        return PositionMath.canLiquidateExt(p, amount, price);
    }

    function getGlobalUnrealizedPnL(address core) external view returns (int256 totalPnL) {
        uint256 count = ITradingCoreExtended(core).activeMarketCount();
        for (uint256 i = 0; i < count; ) {
            address market = ITradingCoreExtended(core).activeMarketAt(i);
            DataTypes.Market memory m = ITradingCore(core).getMarketInfo(market);
            if (m.isActive && (m.totalLongSize > 0 || m.totalShortSize > 0)) {
                // Per-market fault isolation: a single stale / over-confidence /
                // unconfigured feed must NOT revert the whole aggregation.
                // Previously any reverting market poisoned this view, and the
                // vault's `try/catch` then fell back to a ZERO trader-PnL
                // adjustment on the conservative (withdrawal) path — letting
                // LPs over-withdraw against unpriced, possibly-profitable
                // trader positions. We instead skip the unreadable market's
                // contribution here; the vault treats an unreadable market as
                // "no offsetting credit", which is conservative for LP exits.
                try oracleAggregator.getPrice(market) returns (uint256 price, uint256, uint256) {
                    if (price > 0) {
                        // Bound `size * price` to prevent silent int256
                        // overflow on extreme OI configs. With internal
                        // precision (1e18) sizes and ~1e18 prices, the
                        // product can grow large; we conservatively cap at
                        // half int256.max so the subtraction below cannot
                        // wrap. A position too large to compute PnL safely
                        // is reported as zero for the purposes of the
                        // global aggregate (a position cap upstream is the
                        // correct fix; this is defense in depth).
                        uint256 longCurrent = (m.totalLongSize * price) / 1e18;
                        uint256 shortCurrent = (m.totalShortSize * price) / 1e18;
                        uint256 maxSafe = uint256(type(int256).max) / 2;
                        if (
                            longCurrent <= maxSafe &&
                            shortCurrent <= maxSafe &&
                            m.totalLongCost <= maxSafe &&
                            m.totalShortCost <= maxSafe
                        ) {
                            int256 longPnL = int256(longCurrent) - int256(m.totalLongCost);
                            int256 shortPnL = int256(m.totalShortCost) - int256(shortCurrent);
                            totalPnL += longPnL + shortPnL;
                        }
                    }
                } catch {
                    // Unreadable market: skip its contribution. Combined with
                    // the vault's conservative-total consumer (which subtracts
                    // only positive aggregate trader PnL), skipping cannot
                    // inflate LP withdrawable value beyond the priced markets.
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _getProtocolHealthState()
        internal
        view
        returns (bool isHealthy, uint256 totalBadDebt, uint64 lastHealthCheck)
    {
        return ITradingCoreExtended(address(tradingCore)).getProtocolHealthState();
    }

    function _shouldTriggerStopLoss(DataTypes.Position memory pos, uint256 price) internal pure returns (bool) {
        if (pos.stopLossPrice == 0) return false;
        return DataTypes.isLong(pos.flags) ? price <= pos.stopLossPrice : price >= pos.stopLossPrice;
    }

    function _shouldTriggerTakeProfit(DataTypes.Position memory pos, uint256 price) internal pure returns (bool) {
        if (pos.takeProfitPrice == 0) return false;
        return DataTypes.isLong(pos.flags) ? price >= pos.takeProfitPrice : price <= pos.takeProfitPrice;
    }
}

/**
 * @title ITradingCoreExtended
 * @notice Extended read interface used by TradingCoreViews helper methods.
 * @dev Exposes additional getters not present on the base `ITradingCore`.
 */
interface ITradingCoreExtended {
    function getProtocolHealthState()
        external
        view
        returns (bool isHealthy, uint256 totalBadDebt, uint64 lastHealthCheck);
    function getPositionCollateral(uint256 id) external view returns (uint256 amount, address tokenAddress);
    function activeMarketCount() external view returns (uint256);
    function activeMarketAt(uint256 index) external view returns (address);
}
