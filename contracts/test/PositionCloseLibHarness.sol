// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/PositionCloseLib.sol";
import "../libraries/DataTypes.sol";

contract PositionCloseLibHarness {
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

    DataTypes.FeeConfig public feeConfig;

    constructor(address _usdc, address _vault, address _oracle, address _positionToken, address _treasury) {
        usdc = _usdc;
        vault = _vault;
        oracle = _oracle;
        positionToken = _positionToken;
        treasury = _treasury;
        insuranceFund = _vault;
        feeConfig = DataTypes.FeeConfig({
            makerFeeBps: 0,
            takerFeeBps: 10,
            minFeeUsdc: 0,
            lpShareBps: 7000,
            insuranceShareBps: 2000,
            treasuryShareBps: 1000
        });
    }

    function setMarket(address m, uint16 mmBps) external {
        markets[m].maintenanceMargin = mmBps;
        markets[m].isActive = true;
        markets[m].isListed = true;
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

    function close(uint256 id, uint256 closeSize, uint256 minReceive) external returns (int256) {
        PositionCloseLib.ClosePositionContext memory ctx = PositionCloseLib.ClosePositionContext({
            usdc: usdc,
            liquidityVault: vault,
            oracleAggregator: oracle,
            positionToken: positionToken,
            treasury: treasury,
            insuranceFund: insuranceFund,
            feeConfig: feeConfig
        });
        return
            PositionCloseLib.closePosition(
                id,
                closeSize,
                minReceive,
                ctx,
                positions,
                positionCollateral,
                markets,
                userExposure
            );
    }
}
