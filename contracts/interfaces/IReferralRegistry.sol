// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IReferralRegistry
 * @notice External-facing surface used by `TradingCore` to look up a trader's
 *         referrer and active fee tier, and to record per-trade volume for
 *         tier progression. Off-chain integrators (backend/frontend) only need
 *         the read-side; mutators are gated to TRADING_CORE_ROLE.
 *
 * @dev Hot path notes:
 *      - `getTraderReferralData` is O(1) thanks to a cached tier index in
 *         the implementation; callers never pay for tier-array iteration.
 *      - All bps values are in basis points (1 bp = 0.01%, 10000 bps = 100%).
 *      - Volume is tracked in USDC precision (6 decimals).
 */
interface IReferralRegistry {
    struct ReferralData {
        address referrer;       // address(0) when trader is unreferred
        uint16 discountBps;     // fee discount applied to the referee
        uint16 rebateBps;       // fee rebate paid to the referrer
        uint32 tierIndex;       // 0 = base/default, otherwise (qualified tiers + 1)
    }

    struct Tier {
        uint128 minVolumeUsdc;  // cumulative referee volume (USDC, 6 dp) to qualify
        uint16 discountBps;     // fee discount granted to the referee at this tier
        uint16 rebateBps;       // fee rebate granted to the referrer at this tier
    }

    // ── Read ──────────────────────────────────────────────────────────────
    function getTraderReferralData(address trader) external view returns (ReferralData memory);
    function getReferrer(address trader) external view returns (address);
    function isCodeAvailable(string calldata code) external view returns (bool);
    function codeOf(address owner) external view returns (string memory);
    function ownerOfCode(string calldata code) external view returns (address);
    function refereeCount(bytes32 codeHash) external view returns (uint256);
    function traderCumulativeVolume(address trader) external view returns (uint256);
    function getTiers() external view returns (Tier[] memory);
    function tierCount() external view returns (uint256);
    function defaultDiscountBps() external view returns (uint16);
    function defaultRebateBps() external view returns (uint16);

    // ── Write (user) ──────────────────────────────────────────────────────
    function registerCode(string calldata code) external returns (bytes32 codeHash);
    function setTraderReferralCode(string calldata code) external;
    function transferCode(string calldata code, address newOwner) external;

    // ── Write (TRADING_CORE_ROLE) ─────────────────────────────────────────
    function recordReferralVolume(address trader, uint256 sizeUsdc) external;
}
