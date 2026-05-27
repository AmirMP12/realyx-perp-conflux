// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/IDividendManager.sol";

/**
 * @title DividendKeeper
 * @notice Trusted keeper contract to trigger dividend distributions from off-chain sources.
 */
contract DividendKeeper is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    error ZeroAddress();

    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    IDividendManager public dividendManager;

    event DividendTriggered(string indexed marketId, uint256 amountPerShare, address indexed keeper);
    event DividendManagerUpdated(address indexed oldManager, address indexed newManager);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // lock implementation initializers.
        _disableInitializers();
    }

    function initialize(address admin, address _dividendManager) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        if (admin == address(0) || _dividendManager == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(DISTRIBUTOR_ROLE, admin);
        dividendManager = IDividendManager(_dividendManager);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function distribute(string calldata marketId, uint256 amountPerShare) external onlyRole(DISTRIBUTOR_ROLE) {
        dividendManager.distributeDividend(marketId, amountPerShare);
        emit DividendTriggered(marketId, amountPerShare, msg.sender);
    }

    function setDividendManager(address _dividendManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_dividendManager == address(0)) revert ZeroAddress();
        address old = address(dividendManager);
        dividendManager = IDividendManager(_dividendManager);
        emit DividendManagerUpdated(old, _dividendManager);
    }
}
