// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DustLib.sol";
import "../libraries/DataTypes.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DustLibHarness {
    DataTypes.DustAccumulator public dust;

    function setDust(uint256 totalDust, uint256 lastSweepTimestamp) external {
        dust.totalDust = totalDust;
        dust.lastSweepTimestamp = lastSweepTimestamp;
    }

    function sweepDust(IERC20 usdc, address treasury) external returns (uint256 swept) {
        return DustLib.sweepDust(usdc, treasury, dust);
    }

    function getTotalDust() external view returns (uint256) {
        return dust.totalDust;
    }

    function getLastSweepTimestamp() external view returns (uint256) {
        return dust.lastSweepTimestamp;
    }
}
