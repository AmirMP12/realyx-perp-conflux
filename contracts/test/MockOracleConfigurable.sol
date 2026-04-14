// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockOracleConfigurable {
    mapping(address => uint256) public prices;
    mapping(address => uint256) public confidences;
    mapping(address => uint256) public timestamps;
    mapping(address => uint256) public twaps;
    bool public isActionAllowedResult = true;

    function setPrice(address market, uint256 price, uint256 confidence, uint256 timestamp) external {
        prices[market] = price;
        confidences[market] = confidence;
        timestamps[market] = timestamp;
    }

    function getPrice(address market) external view returns (uint256, uint256, uint256) {
        return (prices[market], confidences[market], timestamps[market]);
    }

    function setTWAP(address market, uint256 twap) external {
        twaps[market] = twap;
    }

    function getTWAP(address market, uint256) external view returns (uint256) {
        return twaps[market];
    }

    function setActionAllowed(bool allowed) external {
        isActionAllowedResult = allowed;
    }

    function isActionAllowed(address, uint8) external view returns (bool) {
        return isActionAllowedResult;
    }

    function getValidSourceCount(address) external pure returns (uint256) {
        return 1;
    }
}
