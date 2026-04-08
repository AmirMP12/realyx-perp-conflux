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
            collateralType: DataTypes.CollateralType.USDC,
            state: state
        });
    }

    function setCollateral(uint256 id, uint256 amount) external {
        positionCollateral[id] = DataTypes.PositionCollateral({amount: amount, tokenAddress: address(0)});
    }

    function setUserExposure(address user, uint256 amount) external {
        userExposure[user] = amount;
    }

    function liquidate(uint256 id) external returns (uint256) {
        LiquidationLib.LiquidatePositionContext memory ctx = LiquidationLib.LiquidatePositionContext({
            usdc: usdc,
            liquidityVault: vault,
            oracleAggregator: oracle,
            positionToken: positionToken,
            treasury: treasury,
            insuranceFund: insuranceFund,
            liquidationTiers: liqTiers,
            liquidationDeviationBps: liqDeviationBps
        });
        return LiquidationLib.liquidatePosition(id, ctx, positions, positionCollateral, markets, userExposure);
    }
}
