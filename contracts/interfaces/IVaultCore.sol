// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/DataTypes.sol";

/**
 * @title IVaultCore
 * @notice Interface for the unified vault (LP + Insurance)
 */
interface IVaultCore {
    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event Withdraw(address indexed user, uint256 assets, uint256 shares);
    event WithdrawalQueued(address indexed user, uint256 shares, uint256 requestId);
    event WithdrawalProcessed(uint256 indexed requestId, address indexed user, uint256 assets);
    event ExposureUpdated(address indexed market, uint256 longExposure, uint256 shortExposure);
    event PnLSettled(address indexed market, int256 pnl, bool isProfit);
    event EmergencyModeActivated(uint256 timestamp);
    event EmergencyModeDeactivated(uint256 timestamp);

    event InsuranceStaked(address indexed user, uint256 assets, uint256 shares);
    event InsuranceUnstaked(address indexed user, uint256 assets, uint256 shares);
    event BadDebtCovered(uint256 indexed claimId, uint256 amount, uint256 positionId);
    event ClaimSubmitted(uint256 indexed claimId, uint256 amount, uint256 positionId);
    event FeeReceived(uint256 amount, string feeType);
    event SurplusDistributed(uint256 total, uint256 stakerShare, uint256 treasuryShare);

    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    
    function withdraw(
        uint256 shares, 
        address receiver, 
        address owner
    ) external returns (uint256 assets);
    
    function queueWithdrawal(
        uint256 shares, 
        uint256 minAssets
    ) external returns (uint256 requestId);

    function processWithdrawals(uint256[] calldata requestIds) external returns (uint256 processed);

    function borrow(
        uint256 amount, 
        address market, 
        bool isLong
    ) external returns (bool success);
    
    function repay(
        uint256 amount, 
        address market, 
        bool isLong, 
        int256 pnl
    ) external;
    
    function updateExposure(
        address market, 
        int256 sizeDelta, 
        bool isLong
    ) external;

    function stakeInsurance(
        uint256 assets, 
        address receiver
    ) external returns (uint256 shares);
    
    function unstakeInsurance(
        uint256 shares, 
        address receiver
    ) external returns (uint256 assets);
    
    function requestUnstake() external;
    
    function coverBadDebt(
        uint256 amount, 
        uint256 positionId
    ) external returns (uint256 covered);
    
    function submitClaim(
        uint256 amount, 
        uint256 positionId
    ) external returns (uint256 claimId);
    
    function approveClaim(uint256 claimId) external;
    
    function processClaim(uint256 claimId) external returns (uint256 paid);
    
    function receiveFees(uint256 amount) external;
    
    function distributeSurplus() external;

    function triggerEmergencyMode() external;
    function stopEmergencyMode() external;

    function totalAssets() external view returns (uint256);
    function insuranceAssets() external view returns (uint256);
    function lpTotalShares() external view returns (uint256);
    function insTotalShares() external view returns (uint256);
    function getUtilization() external view returns (uint256);
    function getAvailableLiquidity() external view returns (uint256);
    function getLPSharePrice() external view returns (uint256);
    function getMarketExposure(address market) external view returns (DataTypes.MarketExposure memory);
    function isEmergencyMode() external view returns (bool);
    function lpBalanceOf(address user) external view returns (uint256);
    function insBalanceOf(address user) external view returns (uint256);
    function previewDeposit(uint256 assets) external view returns (uint256);
    function previewWithdraw(uint256 shares) external view returns (uint256);
    function getWithdrawalRequest(uint256 requestId) external view returns (DataTypes.WithdrawalRequest memory);
    function getClaim(uint256 claimId) external view returns (DataTypes.BadDebtClaim memory);
    function getInsuranceHealthRatio() external view returns (uint256);
    function isInsuranceHealthy() external view returns (bool);

    function asset() external view returns (address);
    function convertToShares(uint256 assets) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function maxDeposit(address) external view returns (uint256);
    function maxRedeem(address owner) external view returns (uint256);
}
