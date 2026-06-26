// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/FundingLib.sol";
import "../libraries/DataTypes.sol";

contract FundingLibHarness {
    DataTypes.PositionCollateral internal _collateral;

    function setCollateral(uint256 amount) external {
        _collateral.amount = amount;
        _collateral.tokenAddress = address(0);
    }

    function applyFunding(
        int256 fundingPaid,
        uint256 positionId
    ) external returns (uint256 newCollateral, uint256 shortfall) {
        return FundingLib.applyFundingToCollateral(_collateral, fundingPaid, positionId);
    }

    DataTypes.FundingState internal _fundingState;
    DataTypes.Market internal _market;

    function setupMarket(uint64 lastSettlement, uint256 totalLongSize, uint256 totalShortSize) external {
        _fundingState.lastSettlement = lastSettlement;
        _market.totalLongSize = uint128(totalLongSize);
        _market.totalShortSize = uint128(totalShortSize);
    }

    function settleWithCap(uint256 cap) external returns (int256) {
        return FundingLib.settleFundingWithCap(_fundingState, _market, address(this), cap);
    }

    function fundingState() external view returns (int256 rate, int256 cum, uint64 last) {
        return (_fundingState.fundingRate, _fundingState.cumulativeFunding, _fundingState.lastSettlement);
    }

    function collateralAmount() external view returns (uint256) {
        return _collateral.amount;
    }
}
