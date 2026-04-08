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

    function collateralAmount() external view returns (uint256) {
        return _collateral.amount;
    }
}
