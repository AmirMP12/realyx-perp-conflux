// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/IComplianceManager.sol";

/**
 * @title AllowListCompliance
 * @notice Basic implementation of compliance verification via Admin-managed Whitelist.
 */
contract AllowListCompliance is Initializable, AccessControlUpgradeable, UUPSUpgradeable, IComplianceManager {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    mapping(address => bool) public isWhitelisted;
    mapping(address => bool) public userCountryBlocked;

    event UserWhitelisted(address indexed user, bool status);
    event UserCountryBlockUpdated(address indexed user, bool blocked);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        /* _disableInitializers(); */
    }

    function initialize(address admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function setWhitelist(address user, bool status) external onlyRole(MANAGER_ROLE) {
        isWhitelisted[user] = status;
        emit UserWhitelisted(user, status);
    }

    function batchSetWhitelist(address[] calldata users, bool status) external onlyRole(MANAGER_ROLE) {
        for (uint256 i = 0; i < users.length; i++) {
            isWhitelisted[users[i]] = status;
            emit UserWhitelisted(users[i], status);
        }
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
