// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../interfaces/IReferralRegistry.sol";

/// @notice Configurable referral registry mock for exercising the referral
///         resolution branches in TradingContextLib / TradingLib (valid config,
///         clamp-to-BPS, unsafe discount+rebate > 100%, and a reverting call).
contract MockReferralRegistryConfigurable {
    IReferralRegistry.ReferralData private _data;
    bool public shouldRevert;

    function setData(address referrer, uint16 discountBps, uint16 rebateBps, uint32 tierIndex) external {
        _data = IReferralRegistry.ReferralData({
            referrer: referrer,
            discountBps: discountBps,
            rebateBps: rebateBps,
            tierIndex: tierIndex
        });
    }

    function setShouldRevert(bool flag) external {
        shouldRevert = flag;
    }

    function getTraderReferralData(address) external view returns (IReferralRegistry.ReferralData memory) {
        if (shouldRevert) revert("referral-revert");
        return _data;
    }
}
