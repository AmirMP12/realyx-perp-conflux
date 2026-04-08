// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/TradingLib.sol";
import "../libraries/DataTypes.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IVaultCore.sol";

/// @dev Isolated harness to keep `CoverageHarness` bytecode under deploy limits.
contract TradingLibFailedRepaymentHarness {
    DataTypes.ProtocolHealthState private _harnessHealth;
    mapping(uint256 => DataTypes.FailedRepayment) private _harnessFailedRepayments;
    uint256[] private _harnessFailedRepaymentIds;
    mapping(uint256 => uint256) private _harnessFailedRepaymentIndex;

    function boostApplyLiquidatePostProcess(
        uint256 positionId,
        bool didRecordFailed,
        uint256 totalBadDebt,
        uint256 failedAmount,
        uint256 totalFailedRepayments
    ) external returns (uint256 newTotal, uint256 badDebt) {
        DataTypes.ProtocolHealthState storage health = _harnessHealth;
        health.totalBadDebt = totalBadDebt;
        _harnessFailedRepayments[positionId].amount = failedAmount;

        newTotal = TradingLib.applyLiquidatePostProcess(
            positionId,
            didRecordFailed,
            health,
            _harnessFailedRepayments,
            totalFailedRepayments
        );
        badDebt = health.totalBadDebt;
    }

    function boostRecordFailedRepayment(
        uint256 positionId,
        uint256 amount,
        address market,
        bool isLong,
        int256 pnl
    ) external {
        TradingLib.recordFailedRepayment(
            positionId,
            amount,
            market,
            isLong,
            pnl,
            _harnessFailedRepayments,
            _harnessFailedRepaymentIds,
            _harnessFailedRepaymentIndex
        );
    }

    function boostResolveFailedRepayment(
        uint256 positionId,
        address msgSender,
        address self,
        IERC20 usdcToken,
        IVaultCore vaultCore
    ) external {
        TradingLib.resolveFailedRepayment(positionId, msgSender, self, usdcToken, vaultCore, _harnessFailedRepayments);
    }

    function boostResolveFailedRepaymentFull(
        uint256 positionId,
        address msgSender,
        address self,
        IERC20 usdcToken,
        IVaultCore vaultCore,
        uint256 totalFailedRepayments
    ) external returns (uint256 newTotal, uint256 badDebt) {
        newTotal = TradingLib.resolveFailedRepaymentFull(
            positionId,
            msgSender,
            self,
            usdcToken,
            vaultCore,
            _harnessFailedRepayments,
            _harnessFailedRepaymentIds,
            _harnessFailedRepaymentIndex,
            _harnessHealth,
            totalFailedRepayments
        );
        badDebt = _harnessHealth.totalBadDebt;
    }
}
