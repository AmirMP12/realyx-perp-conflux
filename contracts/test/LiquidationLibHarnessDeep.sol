// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/LiquidationLib.sol";
import "../libraries/DataTypes.sol";

contract LiquidationLibHarnessDeep {
    mapping(uint256 => DataTypes.Position) public positions;
    mapping(uint256 => DataTypes.PositionCollateral) public positionCollateral;
    mapping(address => DataTypes.Market) public markets;
    mapping(address => uint256) public userExposure;

    address public usdc;
    address public vault;
    address public oracle;
    address public positionToken;
    address public treasury;
    address public insuranceFund;

    DataTypes.LiquidationFeeTiers public liqTiers;
    DataTypes.ProtocolHealthState internal _harnessProtocolHealth;
    uint256 public liqDeviationBps;

    constructor(address _usdc, address _vault, address _oracle, address _positionToken, address _treasury) {
        usdc = _usdc;
        vault = _vault;
        oracle = _oracle;
        positionToken = _positionToken;
        treasury = _treasury;
        insuranceFund = _vault;
        liqDeviationBps = 0;
        liqTiers = DataTypes.LiquidationFeeTiers({
            nearThresholdBps: 500,
            mediumRiskBps: 800,
            deeplyUnderwaterBps: 1200,
            liquidatorShareBps: 7000
        });
    }

    function setLiqParams(uint256 deviationBps, DataTypes.LiquidationFeeTiers calldata tiers) external {
        liqDeviationBps = deviationBps;
        liqTiers = tiers;
    }

    function setPosition(
        uint256 id,
        address market,
        uint128 size,
        uint128 entryPrice,
        uint8 flags,
        DataTypes.PosStatus state
    ) external {
        positions[id] = DataTypes.Position({
            size: size,
            entryPrice: entryPrice,
            liquidationPrice: 0,
            stopLossPrice: 0,
            takeProfitPrice: 0,
            leverage: 0,
            lastFundingTime: 0,
            market: market,
            openTimestamp: uint40(block.timestamp),
            trailingStopBps: 0,
            flags: flags,
            collateralType: DataTypes.CollateralType.USDT0,
            state: state,
            collateralToken: address(0)
        });
    }

    function setCollateral(uint256 id, uint256 amount) external {
        positionCollateral[id] = DataTypes.PositionCollateral({
            amount: amount,
            tokenAddress: address(0),
            borrowedAmount: 0
        });
    }

    function setCollateralWithBorrow(uint256 id, uint256 amount, uint256 borrowed) external {
        positionCollateral[id] = DataTypes.PositionCollateral({
            amount: amount,
            tokenAddress: address(0),
            borrowedAmount: borrowed
        });
    }

    function setUserExposure(address user, uint256 amount) external {
        userExposure[user] = amount;
    }

    /// @dev Additive coverage helper: seed market open-interest accumulators so
    ///      the OI-decrement `> sz`/`> cost` true sides in `liquidatePosition`
    ///      are reachable (default zero OI only exercises the floor-to-zero side).
    function setMarketOI(
        address market,
        uint256 longSize,
        uint256 longCost,
        uint256 shortSize,
        uint256 shortCost
    ) external {
        markets[market].totalLongSize = longSize;
        markets[market].totalLongCost = longCost;
        markets[market].totalShortSize = shortSize;
        markets[market].totalShortCost = shortCost;
    }

    /// @dev Stub matching ITradingCore.recordFailedRepayment so the library's
    ///      residual-debt path (ctx.tradingCore == address(this)) does not revert.
    event FailedRepaymentRecordedStub(uint256 positionId, uint256 amount);

    function recordFailedRepayment(
        uint256 positionId,
        uint256 amount,
        address /* market */,
        bool /* isLong */,
        int256 /* pnl */
    ) external {
        emit FailedRepaymentRecordedStub(positionId, amount);
    }

    function liquidate(uint256 id) external returns (uint256) {
        LiquidationLib.LiquidatePositionContext memory ctx = LiquidationLib.LiquidatePositionContext({
            usdc: usdc,
            liquidityVault: vault,
            oracleAggregator: oracle,
            positionToken: positionToken,
            treasury: treasury,
            insuranceFund: insuranceFund,
            tradingCore: address(this),
            collateralRegistry: address(0),
            liquidationTiers: liqTiers,
            liquidationDeviationBps: liqDeviationBps
        });
        return
            LiquidationLib.liquidatePosition(
                id,
                ctx,
                positions,
                positionCollateral,
                markets,
                userExposure,
                _harnessProtocolHealth
            );
    }
}
