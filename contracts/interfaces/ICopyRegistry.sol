// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title ICopyRegistry
 * @notice Interface for the social copy trading registry.
 */
interface ICopyRegistry {
    /**
     * @notice Information about a registered lead trader.
     * @param trader Address of the lead trader.
     * @param profitFeeBps Profit fee in basis points (e.g., 1000 = 10%).
     * @param metadataURI IPFS or HTTPS URI pointing to trader profile metadata JSON.
     * @param registeredAt Unix timestamp of registration.
     * @param activeFollowers Number of active copiers currently following this trader.
     */
    struct LeadTraderInfo {
        address trader;
        uint16 profitFeeBps;
        string metadataURI;
        uint40 registeredAt;
        uint32 activeFollowers;
    }

    /**
     * @notice Relationship between a copier and a lead trader.
     * @param isActive Whether the copier is currently following.
     * @param maxAllocation Maximum USDC allocation for copied trades (in USDC decimals = 6).
     * @param maxLeverage Maximum leverage allowed for copied positions.
     * @param startedAt Unix timestamp when the copier started following.
     */
    struct CopyRelationship {
        bool isActive;
        uint256 maxAllocation;
        uint8 maxLeverage;
        uint40 startedAt;
    }

    /// @notice Register the caller as a lead trader.
    function registerAsLeadTrader(
        uint16 profitFeeBps,
        string calldata metadataURI
    ) external returns (uint256 leadTraderId);

    /// @notice Update profit fee and/or metadata for the calling lead trader.
    function updateLeadTrader(uint16 profitFeeBps, string calldata metadataURI) external;

    /// @notice Remove the caller from the lead trader registry and unfollow all copiers.
    function deregisterAsLeadTrader() external;

    /// @notice Follow a lead trader with configurable limits.
    function followTrader(address leadTrader, uint256 maxAllocation, uint8 maxLeverage) external;

    /// @notice Stop following a lead trader.
    function unfollowTrader(address leadTrader) external;

    /// @notice Update maxAllocation and maxLeverage for an existing follow relationship.
    function updateCopierConfig(address leadTrader, uint256 maxAllocation, uint8 maxLeverage) external;

    /// @notice Get lead trader info by address.
    function getLeadTraderInfo(address trader) external view returns (LeadTraderInfo memory);

    /// @notice Get lead trader info by numeric ID.
    function getLeadTraderInfoById(uint256 leadTraderId) external view returns (LeadTraderInfo memory);

    /// @notice Get the list of copier addresses following a lead trader.
    function getCopiersOfLeadTrader(address leadTrader) external view returns (address[] memory);

    /// @notice Get the list of copier addresses following a lead trader by numeric ID.
    function getCopiersOfLeadTraderById(uint256 leadTraderId) external view returns (address[] memory);

    /// @notice Get all lead traders a given copier is following (gas-limited convenience view).
    function getCopierFollowing(address copier) external view returns (address[] memory leadTraders);
}
