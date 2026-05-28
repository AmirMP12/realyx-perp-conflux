// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../interfaces/ICopyRegistry.sol";

/**
 * @title CopyRegistry
 * @notice On-chain registry for social copy trading.
 * @dev Lead traders self-register with a profit-fee percentage and metadata URI.
 *      Copiers emit a `FollowedTrader` event to signal the off-chain CopyBot
 *      to begin mirroring. Profit-fee claims (at close time) are handled by
 *      the backend engine; this contract stores the fee settings.
 *
 *      Architecture note: Copier funds stay in their own TradingCore balance
 *      via the `addSubaccount` mechanism. The CopyBot is a subaccount that
 *      executes mirrored orders on behalf of the copier. No funds are pooled.
 */
contract CopyRegistry is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ICopyRegistry
{
    /// @notice Maximum profit fee a lead trader can charge (20% = 2000 bps).
    uint256 public constant MAX_PROFIT_FEE_BPS = 2000;

    /// @notice incrementing counter for lead trader IDs.
    uint256 public nextLeadTraderId;

    /// @notice leadTraderId => LeadTraderInfo
    mapping(uint256 => LeadTraderInfo) private _leadTraders;

    /// @notice address => leadTraderId (0 if not registered)
    mapping(address => uint256) public addressToLeadTraderId;

    /// @notice copier => leadTrader => CopyRelationship
    mapping(address => mapping(address => CopyRelationship))
        public copyRelationships;

    /// @notice leadTraderId => array of copier addresses (for off-chain enumeration)
    mapping(uint256 => address[]) private _copiersOfLeadTrader;

    /// @notice Reserve gap for future storage variables.
    uint256[45] private __gap;

    // ──────── Events ────────

    event LeadTraderRegistered(
        uint256 indexed leadTraderId,
        address indexed trader,
        uint16 profitFeeBps,
        string metadataURI
    );

    event LeadTraderUpdated(
        uint256 indexed leadTraderId,
        uint16 profitFeeBps,
        string metadataURI
    );

    event FollowedTrader(
        address indexed copier,
        address indexed leadTrader,
        uint256 maxAllocation,
        uint8 maxLeverage
    );

    event UnfollowedTrader(
        address indexed copier,
        address indexed leadTrader
    );

    event CopierConfigUpdated(
        address indexed copier,
        address indexed leadTrader,
        uint256 maxAllocation,
        uint8 maxLeverage
    );

    // ──────── Errors ────────

    error AlreadyRegistered();
    error NotRegistered();
    error ProfitFeeTooHigh(uint256 fee, uint256 maxFee);
    error AlreadyFollowing();
    error NotFollowing();
    error InvalidMaxLeverage();

    // ──────── Initializer ────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner) public initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        nextLeadTraderId = 1;
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    // ──────── Lead Trader Registration ────────

    /// @inheritdoc ICopyRegistry
    function registerAsLeadTrader(
        uint16 profitFeeBps,
        string calldata metadataURI
    ) external override returns (uint256 leadTraderId) {
        if (addressToLeadTraderId[msg.sender] != 0) revert AlreadyRegistered();
        if (profitFeeBps > MAX_PROFIT_FEE_BPS)
            revert ProfitFeeTooHigh(profitFeeBps, MAX_PROFIT_FEE_BPS);

        leadTraderId = nextLeadTraderId++;
        _leadTraders[leadTraderId] = LeadTraderInfo({
            trader: msg.sender,
            profitFeeBps: profitFeeBps,
            metadataURI: metadataURI,
            registeredAt: uint40(block.timestamp),
            activeFollowers: 0
        });
        addressToLeadTraderId[msg.sender] = leadTraderId;

        emit LeadTraderRegistered(
            leadTraderId,
            msg.sender,
            profitFeeBps,
            metadataURI
        );
    }

    /// @inheritdoc ICopyRegistry
    function updateLeadTrader(
        uint16 profitFeeBps,
        string calldata metadataURI
    ) external override {
        uint256 traderId = addressToLeadTraderId[msg.sender];
        if (traderId == 0) revert NotRegistered();
        if (profitFeeBps > MAX_PROFIT_FEE_BPS)
            revert ProfitFeeTooHigh(profitFeeBps, MAX_PROFIT_FEE_BPS);

        LeadTraderInfo storage info = _leadTraders[traderId];
        info.profitFeeBps = profitFeeBps;
        info.metadataURI = metadataURI;

        emit LeadTraderUpdated(traderId, profitFeeBps, metadataURI);
    }

    /// @inheritdoc ICopyRegistry
    function deregisterAsLeadTrader() external override {
        uint256 traderId = addressToLeadTraderId[msg.sender];
        if (traderId == 0) revert NotRegistered();

        // Remove all active followers (they keep their existing open positions
        // but new mirrors stop)
        address[] memory copiers = _copiersOfLeadTrader[traderId];
        for (uint256 i = 0; i < copiers.length; i++) {
            address copier = copiers[i];
            delete copyRelationships[copier][msg.sender];
            emit UnfollowedTrader(copier, msg.sender);
        }
        delete _copiersOfLeadTrader[traderId];
        delete addressToLeadTraderId[msg.sender];
        delete _leadTraders[traderId];
    }

    // ──────── Copier Following ────────

    /// @inheritdoc ICopyRegistry
    function followTrader(
        address leadTrader,
        uint256 maxAllocation,
        uint8 maxLeverage
    ) external override {
        if (addressToLeadTraderId[leadTrader] == 0) revert NotRegistered();
        if (
            copyRelationships[msg.sender][leadTrader].isActive
        ) revert AlreadyFollowing();
        if (maxLeverage == 0 || maxLeverage > 100)
            revert InvalidMaxLeverage();

        uint256 traderId = addressToLeadTraderId[leadTrader];
        copyRelationships[msg.sender][leadTrader] = CopyRelationship({
            isActive: true,
            maxAllocation: maxAllocation,
            maxLeverage: maxLeverage,
            startedAt: uint40(block.timestamp)
        });
        _copiersOfLeadTrader[traderId].push(msg.sender);
        _leadTraders[traderId].activeFollowers = uint32(
            _leadTraders[traderId].activeFollowers + 1
        );

        emit FollowedTrader(msg.sender, leadTrader, maxAllocation, maxLeverage);
    }

    /// @inheritdoc ICopyRegistry
    function unfollowTrader(address leadTrader) external override {
        if (
            !copyRelationships[msg.sender][leadTrader].isActive
        ) revert NotFollowing();

        uint256 traderId = addressToLeadTraderId[leadTrader];
        delete copyRelationships[msg.sender][leadTrader];

        // Remove from _copiersOfLeadTrader array (order not preserved)
        address[] storage arr = _copiersOfLeadTrader[traderId];
        uint256 len = arr.length;
        for (uint256 i = 0; i < len; i++) {
            if (arr[i] == msg.sender) {
                arr[i] = arr[len - 1];
                arr.pop();
                break;
            }
        }

        if (_leadTraders[traderId].activeFollowers > 0) {
            _leadTraders[traderId].activeFollowers = uint32(
                _leadTraders[traderId].activeFollowers - 1
            );
        }

        emit UnfollowedTrader(msg.sender, leadTrader);
    }

    /// @inheritdoc ICopyRegistry
    function updateCopierConfig(
        address leadTrader,
        uint256 maxAllocation,
        uint8 maxLeverage
    ) external override {
        if (
            !copyRelationships[msg.sender][leadTrader].isActive
        ) revert NotFollowing();
        if (maxLeverage == 0 || maxLeverage > 100)
            revert InvalidMaxLeverage();

        copyRelationships[msg.sender][leadTrader]
            .maxAllocation = maxAllocation;
        copyRelationships[msg.sender][leadTrader]
            .maxLeverage = maxLeverage;

        emit CopierConfigUpdated(
            msg.sender,
            leadTrader,
            maxAllocation,
            maxLeverage
        );
    }

    // ──────── Read-Only Views ────────

    /// @inheritdoc ICopyRegistry
    function getLeadTraderInfo(
        address trader
    ) external view override returns (LeadTraderInfo memory) {
        uint256 traderId = addressToLeadTraderId[trader];
        if (traderId == 0) revert NotRegistered();
        return _leadTraders[traderId];
    }

    /// @inheritdoc ICopyRegistry
    function getLeadTraderInfoById(
        uint256 leadTraderId
    ) external view override returns (LeadTraderInfo memory) {
        LeadTraderInfo memory info = _leadTraders[leadTraderId];
        if (info.trader == address(0)) revert NotRegistered();
        return info;
    }

    /// @inheritdoc ICopyRegistry
    function getCopiersOfLeadTrader(
        address leadTrader
    ) external view override returns (address[] memory) {
        uint256 traderId = addressToLeadTraderId[leadTrader];
        if (traderId == 0) revert NotRegistered();
        return _copiersOfLeadTrader[traderId];
    }

    /// @inheritdoc ICopyRegistry
    function getCopiersOfLeadTraderById(
        uint256 leadTraderId
    ) external view override returns (address[] memory) {
        if (leadTraderId >= nextLeadTraderId) revert NotRegistered();
        return _copiersOfLeadTrader[leadTraderId];
    }

    /// @inheritdoc ICopyRegistry
    function getCopierFollowing(
        address copier
    ) external view override returns (address[] memory leadTraders) {
        // We need to iterate all lead traders to find which ones this copier follows.
        // For on-chain enumeration, use events; this is a convenience view limited by gas.
        uint256 count = nextLeadTraderId;
        // First pass: count
        uint256 following;
        for (uint256 i = 1; i < count; i++) {
            if (_leadTraders[i].trader == address(0)) continue;
            if (
                copyRelationships[copier][_leadTraders[i].trader].isActive
            ) {
                following++;
            }
        }
        // Second pass: fill
        leadTraders = new address[](following);
        uint256 idx;
        for (uint256 i = 1; i < count; i++) {
            if (_leadTraders[i].trader == address(0)) continue;
            if (
                copyRelationships[copier][_leadTraders[i].trader].isActive
            ) {
                leadTraders[idx] = _leadTraders[i].trader;
                idx++;
            }
        }
    }
}