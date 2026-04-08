// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockOracleSimple {
    mapping(address => uint256) public prices;
    mapping(address => uint256) public twaps;

    function setPrice(address market, uint256 price) external {
        prices[market] = price;
    }

    function getPrice(address market) external view returns (uint256, uint256, uint8) {
        return (prices[market], 0, 0);
    }

    function setTWAP(address market, uint256 twap) external {
        twaps[market] = twap;
    }

    function getTWAP(address market, uint256) external view returns (uint256) {
        return twaps[market];
    }
}
