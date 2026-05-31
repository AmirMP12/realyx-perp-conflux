// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/IComplianceManager.sol";
import "../libraries/DataTypes.sol";

/**
 * @title AllowListCompliance
 * @notice Basic implementation of compliance verification via Admin-managed Whitelist.
 */
contract AllowListCompliance is Initializable, AccessControlUpgradeable, UUPSUpgradeable, IComplianceManager {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    error BatchSizeExceeded();
    error ZeroAddress();
    /// @dev 48h UUPS upgrade timelock errors.
    error PendingImplementationMismatch();
    error UpgradeTimelockActive();

    mapping(address => bool) public isWhitelisted;
    mapping(address => bool) public userCountryBlocked;

    // ── 48h UUPS upgrade timelock ──
    uint256 private constant UPGRADE_TIMELOCK = 48 hours;
    address private _pendingImpl;
    uint256 private _pendingImplEffective;

    event UserWhitelisted(address indexed user, bool status);
    event WhitelistBatchUpdated(address[] users, bool status);
    event UserCountryBlockUpdated(address indexed user, bool blocked);
    event ImplementationProposed(address indexed pending, uint256 effective);
    event ImplementationCancelled(address indexed pending);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // lock implementation initializers.
        _disableInitializers();
    }

    function initialize(address admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {
        // 48h staged-implementation timelock. A compromised admin
        // cannot immediately replace the compliance module to silently
        // flip users to "not allowed" (DoS) or whitelist sanctioned
        // addresses; the swap must be staged for 48h first.
        if (newImplementation != _pendingImpl) revert PendingImplementationMismatch();
        if (_pendingImplEffective == 0 || block.timestamp < _pendingImplEffective) revert UpgradeTimelockActive();
        delete _pendingImpl;
        delete _pendingImplEffective;
    }

    /// @notice Stage a UUPS upgrade. Effective `UPGRADE_TIMELOCK` later.
    function proposeImplementation(address newImplementation) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newImplementation == address(0)) revert ZeroAddress();
        _pendingImpl = newImplementation;
        _pendingImplEffective = block.timestamp + UPGRADE_TIMELOCK;
        emit ImplementationProposed(newImplementation, _pendingImplEffective);
    }

    /// @notice Cancel a pending UUPS upgrade.
    function cancelPendingImplementation() external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit ImplementationCancelled(_pendingImpl);
        delete _pendingImpl;
        delete _pendingImplEffective;
    }

    /// @notice Read-only view of any staged UUPS upgrade.
    function pendingImplementation() external view returns (address pending, uint256 effective) {
        return (_pendingImpl, _pendingImplEffective);
    }

    function setWhitelist(address user, bool status) external onlyRole(MANAGER_ROLE) {
        isWhitelisted[user] = status;
        emit UserWhitelisted(user, status);
    }

    function batchSetWhitelist(address[] calldata users, bool status) external onlyRole(MANAGER_ROLE) {
        if (users.length > DataTypes.MAX_BATCH_SIZE) revert BatchSizeExceeded();
        for (uint256 i = 0; i < users.length; ) {
            isWhitelisted[users[i]] = status;
            unchecked {
                ++i;
            }
        }
        emit WhitelistBatchUpdated(users, status);
    }

    function setUserCountryBlocked(address user, bool blocked) external onlyRole(MANAGER_ROLE) {
        userCountryBlocked[user] = blocked;
        emit UserCountryBlockUpdated(user, blocked);
    }

    function isAllowed(address user, address, bytes calldata) external view override returns (bool) {
        return isWhitelisted[user] && !userCountryBlocked[user];
    }

    function registerMarket(address) external override onlyRole(MANAGER_ROLE) {}
}
