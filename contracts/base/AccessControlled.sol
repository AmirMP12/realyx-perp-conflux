// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../libraries/DataTypes.sol";

/**
 * @title AccessControlled
 * @notice Base contract providing role-based access control and pausability
 * @dev Inherits from OpenZeppelin's upgradeable access control
 */
abstract contract AccessControlled is Initializable, AccessControlUpgradeable, PausableUpgradeable {
    error NotAdmin();
    error NotOperator();
    error NotGuardian();
    error NotOracle();
    error NotLiquidator();
    error NotKeeper();
    error NotTradingCore();
    error ZeroAddress();
    error BatchSizeExceeded();
    error DuplicateAddress();

    bytes32 public constant ADMIN_ROLE = DataTypes.ADMIN_ROLE;
    bytes32 public constant OPERATOR_ROLE = DataTypes.OPERATOR_ROLE;
    bytes32 public constant GUARDIAN_ROLE = DataTypes.GUARDIAN_ROLE;
    bytes32 public constant ORACLE_ROLE = DataTypes.ORACLE_ROLE;
    bytes32 public constant LIQUIDATOR_ROLE = DataTypes.LIQUIDATOR_ROLE;
    bytes32 public constant KEEPER_ROLE = DataTypes.KEEPER_ROLE;
    bytes32 public constant TRADING_CORE_ROLE = DataTypes.TRADING_CORE_ROLE;

    address public circuitBreakerHub;

    uint256 internal constant UPGRADE_TIMELOCK = 48 hours;
    address internal _pendingImplementation;
    uint256 internal _pendingImplementationEffective;
    bytes32 internal _pendingImplementationHash;

    uint256[47] private __gap;

    /// @dev Emitted on every batch role mutation so off-chain monitoring can audit
    ///      privileged changes without iterating individual `RoleGranted` events.
    event RolesBatchUpdated(bytes32 indexed role, address[] accounts, bool granted);

    function __AccessControlled_init(address admin) internal onlyInitializing {
        if (admin == address(0)) revert ZeroAddress();

        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);

        _setRoleAdmin(OPERATOR_ROLE, ADMIN_ROLE);
        _setRoleAdmin(GUARDIAN_ROLE, ADMIN_ROLE);
        _setRoleAdmin(ORACLE_ROLE, ADMIN_ROLE);
        _setRoleAdmin(LIQUIDATOR_ROLE, ADMIN_ROLE);
        _setRoleAdmin(KEEPER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(TRADING_CORE_ROLE, ADMIN_ROLE);
    }

    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert NotAdmin();
        _;
    }

    modifier onlyOperator() {
        if (!hasRole(OPERATOR_ROLE, msg.sender)) revert NotOperator();
        _;
    }

    modifier onlyGuardian() {
        if (!hasRole(GUARDIAN_ROLE, msg.sender)) revert NotGuardian();
        _;
    }

    modifier onlyOracle() {
        if (!hasRole(ORACLE_ROLE, msg.sender)) revert NotOracle();
        _;
    }

    modifier onlyLiquidator() {
        if (!hasRole(LIQUIDATOR_ROLE, msg.sender)) revert NotLiquidator();
        _;
    }

    modifier onlyKeeper() {
        if (!hasRole(KEEPER_ROLE, msg.sender)) revert NotKeeper();
        _;
    }

    modifier onlyTradingCore() {
        if (!hasRole(TRADING_CORE_ROLE, msg.sender)) revert NotTradingCore();
        _;
    }

    modifier onlyAdminOrOperator() {
        if (!hasRole(ADMIN_ROLE, msg.sender) && !hasRole(OPERATOR_ROLE, msg.sender)) {
            revert NotOperator();
        }
        _;
    }

    modifier onlyAdminOrGuardian() {
        if (!hasRole(ADMIN_ROLE, msg.sender) && !hasRole(GUARDIAN_ROLE, msg.sender)) {
            revert NotGuardian();
        }
        _;
    }

    function pause() external virtual onlyAdminOrGuardian {
        _pause();
    }

    function unpause() external virtual onlyAdmin {
        _unpause();
    }

    event CircuitBreakerHubUpdated(address indexed hub);

    function setCircuitBreakerHub(address _hub) external onlyAdmin {
        if (_hub == address(0)) revert ZeroAddress();
        circuitBreakerHub = _hub;
        emit CircuitBreakerHubUpdated(_hub);
    }

    function batchGrantRole(bytes32 role, address[] calldata accounts) external onlyAdmin {
        uint256 len = accounts.length;
        if (len > DataTypes.MAX_BATCH_SIZE) revert BatchSizeExceeded();

        for (uint256 i = 0; i < len; ) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            if (!hasRole(role, accounts[i])) {
                _grantRole(role, accounts[i]);
            }
            unchecked {
                ++i;
            }
        }
        emit RolesBatchUpdated(role, accounts, true);
    }

    function batchRevokeRole(bytes32 role, address[] calldata accounts) external onlyAdmin {
        uint256 len = accounts.length;
        if (len > DataTypes.MAX_BATCH_SIZE) revert BatchSizeExceeded();

        for (uint256 i = 0; i < len; ) {
            _revokeRole(role, accounts[i]);
            unchecked {
                ++i;
            }
        }
        emit RolesBatchUpdated(role, accounts, false);
    }

    function _getAllRoles() internal pure returns (bytes32[8] memory roles) {
        roles[0] = DEFAULT_ADMIN_ROLE;
        roles[1] = ADMIN_ROLE;
        roles[2] = OPERATOR_ROLE;
        roles[3] = GUARDIAN_ROLE;
        roles[4] = ORACLE_ROLE;
        roles[5] = LIQUIDATOR_ROLE;
        roles[6] = KEEPER_ROLE;
        roles[7] = TRADING_CORE_ROLE;
    }

    function hasAnyRole(address account) public view returns (bool) {
        bytes32[8] memory roles = _getAllRoles();
        for (uint256 i = 0; i < roles.length; ) {
            if (hasRole(roles[i], account)) return true;
            unchecked {
                ++i;
            }
        }
        return false;
    }

    error PendingImplementationMismatch();
    error UpgradeTimelockActive();

    event ImplementationProposed(address indexed pending, uint256 effective);
    event ImplementationCancelled(address indexed pending);

    /// @notice Stage a UUPS upgrade. Effective `UPGRADE_TIMELOCK` later.
    /// @dev Children call this from `proposeUpgrade(...)` wrappers; the actual
    ///      upgrade authorization (`_authorizeUpgrade`) checks the staged
    ///      proposal matches the live request.
    function proposeImplementation(address newImplementation) external onlyAdmin {
        if (newImplementation == address(0)) revert ZeroAddress();
        _pendingImplementation = newImplementation;
        _pendingImplementationEffective = block.timestamp + UPGRADE_TIMELOCK;
        emit ImplementationProposed(newImplementation, _pendingImplementationEffective);
    }

    /// @notice Cancel a pending UUPS upgrade.
    function cancelPendingImplementation() external onlyAdmin {
        emit ImplementationCancelled(_pendingImplementation);
        delete _pendingImplementation;
        delete _pendingImplementationEffective;
    }

    /// @notice Read-only view of any staged UUPS upgrade.
    function pendingImplementation() external view returns (address pending, uint256 effective) {
        return (_pendingImplementation, _pendingImplementationEffective);
    }

    /// @dev Helper called by child `_authorizeUpgrade` overrides. Reverts
    ///      unless `newImplementation` exactly matches the staged proposal
    ///      and the timelock has elapsed.
    function _enforceUpgradeTimelock(address newImplementation) internal {
        if (newImplementation != _pendingImplementation) revert PendingImplementationMismatch();
        if (block.timestamp < _pendingImplementationEffective) revert UpgradeTimelockActive();
        delete _pendingImplementation;
        delete _pendingImplementationEffective;
    }
}
