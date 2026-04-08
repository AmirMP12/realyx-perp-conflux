// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockPositionTokenSimple {
    mapping(uint256 => address) public owners;

    function setOwner(uint256 id, address owner) external {
        owners[id] = owner;
    }

    function ownerOf(uint256 id) external view returns (address) {
        address o = owners[id];
        require(o != address(0), "no-owner");
        return o;
    }

    function burn(uint256 id) external {
        owners[id] = address(0);
    }
}
