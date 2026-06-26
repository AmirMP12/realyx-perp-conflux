// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/CollateralRouterLib.sol";
import "../libraries/PortfolioRiskLib.sol";
import "../libraries/RateLimitLib.sol";
import "../libraries/PositionMath.sol";
import "../libraries/PositionTriggersLib.sol";
import "../libraries/DataTypes.sol";
import "../core/CollateralRegistry.sol";

/**
 * @title ExtraCoverageHarness
 * @notice Exposes internal library functions that are not reachable via the
 *         primary CoverageHarness, so every library line can be exercised
 *         directly: CollateralRouterLib, PortfolioRiskLib, RateLimitLib
 *         (checkOnly / checkAndUpdateFor), and PositionMath trailing/anchor.
 */
contract ExtraCoverageHarness {
    mapping(address => uint256[]) private _userPositions;
    mapping(uint256 => DataTypes.Position) private _positions;
    mapping(uint256 => DataTypes.PositionCollateral) private _positionCollateral;
    mapping(address => uint256) private _lastLargeActionTime;

    // ── CollateralRouterLib ──
    function selectBestCollateral(
        address user,
        address[] calldata tokens,
        CollateralRegistry registry,
        uint256 requiredUsdcValue,
        bool useLiquidationHaircut
    ) external view returns (address token, uint256 tokenAmount, uint256 usdcValue) {
        CollateralRouterLib.SelectionResult memory r = CollateralRouterLib.selectBestCollateral(
            user,
            tokens,
            registry,
            requiredUsdcValue,
            useLiquidationHaircut
        );
        return (r.token, r.tokenAmount, r.usdcValue);
    }

    function selectBestCollateralBasket(
        address user,
        address[] calldata tokens,
        CollateralRegistry registry,
        uint256 requiredUsdcValue,
        bool useLiquidationHaircut
    ) external view returns (uint256 totalUsdcValue, uint256 count) {
        DataTypes.BasketAllocation memory a = CollateralRouterLib.selectBestCollateralBasket(
            user,
            tokens,
            registry,
            requiredUsdcValue,
            useLiquidationHaircut
        );
        return (a.totalUsdcValue, a.tokens.length);
    }

    function getUserTotalCollateralValue(
        address user,
        address[] calldata tokens,
        CollateralRegistry registry,
        bool useLiquidationHaircut
    ) external view returns (uint256) {
        return CollateralRouterLib.getUserTotalCollateralValue(user, tokens, registry, useLiquidationHaircut);
    }

    // ── PortfolioRiskLib ──
    function setPosition(
        address owner,
        uint256 id,
        uint128 size,
        uint128 entryPrice,
        uint8 flags,
        DataTypes.PosStatus state,
        address market
    ) external {
        _positions[id] = DataTypes.Position({
            size: size,
            entryPrice: entryPrice,
            liquidationPrice: 0,
            stopLossPrice: 0,
            takeProfitPrice: 0,
            leverage: 10,
            lastFundingTime: 0,
            market: market,
            openTimestamp: uint40(block.timestamp),
            trailingStopBps: 0,
            flags: flags,
            collateralType: DataTypes.CollateralType.USDT0,
            state: state,
            collateralToken: address(0)
        });
        _userPositions[owner].push(id);
    }

    function setCollateral(uint256 id, uint256 amount) external {
        _positionCollateral[id].amount = amount;
    }

    /// @dev Zero a position's stored leverage to exercise PortfolioRiskLib's
    ///      flat-config maintenance-bps fallback (`_effectiveMmBps`).
    function setPositionLeverage(uint256 id, uint128 leverage) external {
        _positions[id].leverage = leverage;
    }

    function getAccountRisk(
        address account,
        address oracle,
        bool enabled,
        uint16 mmBps,
        uint16 concentrationLimitBps,
        uint8 maxCrossPositions
    ) external view returns (DataTypes.AccountRiskSnapshot memory snapshot) {
        DataTypes.PortfolioRiskConfig memory cfg = DataTypes.PortfolioRiskConfig({
            maintenanceMarginBps: mmBps,
            concentrationLimitBps: concentrationLimitBps,
            maxCrossPositions: maxCrossPositions,
            enabled: enabled
        });
        return PortfolioRiskLib.getAccountRisk(account, oracle, cfg, _userPositions, _positions, _positionCollateral);
    }

    function validateOpenPosition(
        DataTypes.AccountRiskSnapshot calldata snapshot,
        bool enabled,
        uint16 mmBps,
        uint16 concentrationLimitBps,
        uint8 maxCrossPositions
    ) external pure returns (bool) {
        DataTypes.PortfolioRiskConfig memory cfg = DataTypes.PortfolioRiskConfig({
            maintenanceMarginBps: mmBps,
            concentrationLimitBps: concentrationLimitBps,
            maxCrossPositions: maxCrossPositions,
            enabled: enabled
        });
        return PortfolioRiskLib.validateOpenPosition(snapshot, cfg);
    }

    // ── PositionTriggersLib (state-guard branches) ──
    function triggerSetStopLoss(
        uint256 id,
        uint256 sl,
        address positionTokenAddr,
        address oracleAggregatorAddr,
        uint256 maxOracleUncertainty
    ) external {
        PositionTriggersLib.setStopLoss(
            id,
            sl,
            positionTokenAddr,
            oracleAggregatorAddr,
            maxOracleUncertainty,
            _positions
        );
    }

    function triggerSetTakeProfit(
        uint256 id,
        uint256 tp,
        address positionTokenAddr,
        address oracleAggregatorAddr,
        uint256 maxOracleUncertainty
    ) external {
        PositionTriggersLib.setTakeProfit(
            id,
            tp,
            positionTokenAddr,
            oracleAggregatorAddr,
            maxOracleUncertainty,
            _positions
        );
    }

    function triggerSetTrailingStop(
        uint256 id,
        uint256 bps,
        uint256 maxTrailingBps,
        address positionTokenAddr
    ) external {
        PositionTriggersLib.setTrailingStop(id, bps, maxTrailingBps, positionTokenAddr, _positions);
    }

    // ── RateLimitLib ──
    function checkOnly(address actor, uint256 size, uint256 threshold, uint256 interval) external view {
        RateLimitLib.checkOnly(actor, size, threshold, interval, block.timestamp, _lastLargeActionTime);
    }

    function checkAndUpdateFor(address actor, uint256 size, uint256 threshold, uint256 interval) external {
        RateLimitLib.checkAndUpdateFor(actor, size, threshold, interval, block.timestamp, _lastLargeActionTime);
    }

    function lastLargeActionTime(address actor) external view returns (uint256) {
        return _lastLargeActionTime[actor];
    }

    // ── PositionMath trailing/anchor ──
    function updateTrailingAnchor(
        bool isLong,
        uint256 currentPrice,
        uint256 anchorPrice
    ) external pure returns (uint256) {
        return PositionMath.updateTrailingAnchor(isLong, currentPrice, anchorPrice);
    }

    function shouldTriggerTrailingStop(
        bool isLong,
        uint16 trailingStopBps,
        uint256 currentPrice,
        uint256 anchorPrice
    ) external pure returns (bool) {
        DataTypes.Position memory p;
        p.flags = isLong ? 1 : 0;
        p.trailingStopBps = trailingStopBps;
        return PositionMath.shouldTriggerTrailingStop(p, currentPrice, anchorPrice);
    }

    function calculateLiquidationFeeTiered(uint256 size, uint256 healthFactor) external pure returns (uint256) {
        DataTypes.LiquidationFeeTiers memory tiers = DataTypes.LiquidationFeeTiers({
            nearThresholdBps: 250,
            mediumRiskBps: 500,
            deeplyUnderwaterBps: 750,
            liquidatorShareBps: 5000
        });
        return PositionMath.calculateLiquidationFee(size, healthFactor, tiers);
    }

    function absInt(int256 x) external pure returns (uint256) {
        return PositionMath.abs(x);
    }

    function maxU(uint256 a, uint256 b) external pure returns (uint256) {
        return PositionMath.max(a, b);
    }

    function minU(uint256 a, uint256 b) external pure returns (uint256) {
        return PositionMath.min(a, b);
    }
}
