// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal mock oracle for testing emergency price operations
contract MockOracleForEmergencyPrice {
    mapping(address => uint256) public prices;
    mapping(address => uint256) public confidences;
    mapping(address => uint256) public publishTimes;
    bool public shouldRevert;

    function setPrice(address collection, uint256 price, uint256 confidence, uint256 publishTime) external {
        prices[collection] = price;
        confidences[collection] = confidence;
        publishTimes[collection] = publishTime;
    }

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function getPrice(address collection) external view returns (uint256, uint256, uint256) {
        if (shouldRevert) revert("oracle error");
        return (prices[collection], confidences[collection], publishTimes[collection]);
    }

    function isActionAllowed(address, uint8) external pure returns (bool) {
        return true;
    }

    function isMarketRestricted(address) external pure returns (bool, uint256) {
        return (false, 0);
    }

    function isGloballyPaused() external pure returns (bool) {
        return false;
    }
}
