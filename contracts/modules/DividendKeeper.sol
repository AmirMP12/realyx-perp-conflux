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
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    IDividendManager public dividendManager;

    event DividendTriggered(string indexed marketId, uint256 amountPerShare, address indexed keeper);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        /* _disableInitializers(); */
    }

    function initialize(address admin, address _dividendManager) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

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
        dividendManager = IDividendManager(_dividendManager);
    }
}
