// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IComplianceManager
 * @notice Interface for pluggable regulatory compliance checks
 */
interface IComplianceManager {
    /**
     * @notice Check if a user is allowed to interact with a market
     * @param user The address of the user initiating the transaction
     * @param market The market address (or asset address)
     * @param data Additional context data (e.g., function signature, amount)
     * @return allowed True if interaction is permitted
     */
    function isAllowed(address user, address market, bytes calldata data) external view returns (bool allowed);

    /**
     * @notice Register a market contract so policy can key rules by address.
     * @param market Market (or collection) contract added to the compliance module.
     */
    function registerMarket(address market) external;
}
