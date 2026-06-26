// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../modules/RedStoneAdapter.sol";
import "@redstone-finance/evm-connector/contracts/mocks/AuthorisedMockSignersBase.sol";

/**
 * @title RedStoneAdapterHarness
 * @notice TEST-ONLY subclass of {RedStoneAdapter} that accepts RedStone's
 *         well-known MOCK signer set (the default Hardhat accounts) and a single
 *         required signer, so tests can inject locally-signed price payloads
 *         without the production `redstone-primary-prod` signer keys.
 * @dev Mirrors `RedstoneConsumerNumericMock`'s overrides. Never deploy this:
 *      it trusts mock signers. The production path is {RedStoneAdapter}.
 */
contract RedStoneAdapterHarness is RedStoneAdapter, AuthorisedMockSignersBase {
    uint256 internal constant MIN_TIMESTAMP_MILLISECONDS = 1654353400000;

    error TimestampIsNotValid();

    constructor(address admin) RedStoneAdapter(admin) {}

    function getUniqueSignersThreshold() public view virtual override returns (uint8) {
        return 1;
    }

    function getAuthorisedSignerIndex(address signerAddress) public view virtual override returns (uint8) {
        return getAuthorisedMockSignerIndex(signerAddress);
    }

    function validateTimestamp(uint256 receivedTimestampMilliseconds) public view virtual override {
        if (receivedTimestampMilliseconds < MIN_TIMESTAMP_MILLISECONDS) revert TimestampIsNotValid();
    }
}
