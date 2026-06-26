// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@redstone-finance/evm-connector/contracts/data-services/PrimaryProdDataServiceConsumerBase.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

import "../interfaces/IPriceSource.sol";

/**
 * @title RedStoneAdapter
 * @notice Independent SECOND price source for `OracleAggregator`, backed by the
 *         RedStone Pull oracle. Covers both crypto and RWA feeds on Conflux
 *         eSpace, where RedStone's pull model works on any EVM chain by
 *         injecting a signed price payload into the calldata of the update
 *         transaction (verified on-chain by `PrimaryProdDataServiceConsumerBase`).
 *
 * @dev WHY A CACHE INSTEAD OF A DIRECT READ:
 *      RedStone's `getOracleNumericValueFromTxMsg` reads the signed payload from
 *      THIS transaction's calldata. `OracleAggregator._getPriceView` is a plain
 *      `view` invoked deep inside trading paths (open/close/liquidate) where no
 *      RedStone payload is present on the inner call. So this adapter splits the
 *      flow:
 *        1. A keeper periodically calls `pushPrice`/`pushPrices` with the
 *           RedStone payload appended (via `WrapperBuilder.usingDataService`).
 *           Signatures, unique-signer threshold (>=3) and timestamp freshness
 *           are verified on-chain by the RedStone base, then the normalized
 *           price is cached with `block.timestamp`.
 *        2. `OracleAggregator` reads the cached value through the plain
 *           `IPriceSource.getPrice` view and applies its own staleness +
 *           deviation guard. No RedStone calldata is needed at read time.
 *
 *      This adapter is intentionally NOT upgradeable: it is a peripheral,
 *      hot-swappable component. To rotate data providers or fix a bug, deploy a
 *      new adapter and repoint `OracleAggregator.setSecondarySource`.
 *
 *      LICENSE NOTE: the imported RedStone base contracts are BUSL-1.1; this
 *      adapter only consumes them.
 */
contract RedStoneAdapter is PrimaryProdDataServiceConsumerBase, AccessControl, IPriceSource {
    /// @notice Role allowed to push fresh RedStone prices into the cache.
    bytes32 public constant KEEPER_ROLE = keccak256("REDSTONE_KEEPER_ROLE");

    uint256 private constant PRECISION = 1e18;
    /// @dev Upper bound on configurable feed decimals to keep `_normalize` safe.
    uint8 private constant MAX_FEED_DECIMALS = 36;
    /// @dev Hard ceiling on staleness to prevent misconfiguring a stale-forever feed.
    uint256 private constant MAX_STALENESS = 7 days;

    struct FeedConfig {
        bytes32 feedId; // RedStone data-feed id, e.g. bytes32("BTC") or bytes32("TSLA")
        uint8 feedDecimals; // decimals of the RedStone value (8 for most feeds)
        uint64 maxStaleness; // seconds; 0 disables the freshness gate (not recommended)
        bool configured;
    }

    struct CachedPrice {
        uint256 price; // normalized to 1e18
        uint256 timestamp; // block.timestamp at push
    }

    /// @notice market => RedStone feed configuration.
    mapping(address => FeedConfig) public feeds;
    /// @dev market => last cached, normalized price.
    mapping(address => CachedPrice) private _prices;

    event FeedConfigured(address indexed market, bytes32 feedId, uint8 feedDecimals, uint64 maxStaleness);
    event FeedRemoved(address indexed market);
    event PricePushed(address indexed market, bytes32 indexed feedId, uint256 price, uint256 timestamp);

    error ZeroAddress();
    error ZeroFeedId();
    error InvalidDecimals();
    error StalenessTooHigh();
    error FeedNotConfigured(address market);
    error InvalidRedStoneValue();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(KEEPER_ROLE, admin);
    }

    /* ============================ ADMIN CONFIG ============================ */

    /// @notice Bind a RedStone data-feed id and freshness bounds to `market`.
    /// @param market Market/collection address (same key as the aggregator).
    /// @param feedId RedStone data-feed identifier (e.g. `bytes32("BTC")`).
    /// @param feedDecimals Decimals of the RedStone numeric value (commonly 8).
    /// @param maxStaleness Max age (seconds) of a cached price before it is invalid.
    function setFeed(
        address market,
        bytes32 feedId,
        uint8 feedDecimals,
        uint64 maxStaleness
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (market == address(0)) revert ZeroAddress();
        if (feedId == bytes32(0)) revert ZeroFeedId();
        if (feedDecimals == 0 || feedDecimals > MAX_FEED_DECIMALS) revert InvalidDecimals();
        if (maxStaleness > MAX_STALENESS) revert StalenessTooHigh();

        feeds[market] = FeedConfig({
            feedId: feedId,
            feedDecimals: feedDecimals,
            maxStaleness: maxStaleness,
            configured: true
        });
        emit FeedConfigured(market, feedId, feedDecimals, maxStaleness);
    }

    /// @notice Remove a market's feed config and clear its cached price.
    function removeFeed(address market) external onlyRole(DEFAULT_ADMIN_ROLE) {
        delete feeds[market];
        delete _prices[market];
        emit FeedRemoved(market);
    }

    /* ============================ KEEPER PUSH ============================ */

    /// @notice Push a fresh RedStone-verified price for a single market.
    /// @dev The caller (keeper) MUST append the RedStone signed payload to this
    ///      transaction's calldata (e.g. via `WrapperBuilder.usingDataService`).
    ///      `getOracleNumericValueFromTxMsg` reverts if signatures, the
    ///      unique-signer threshold, or timestamp freshness do not check out.
    /// @return normalized The 1e18-scaled price that was cached.
    function pushPrice(address market) external onlyRole(KEEPER_ROLE) returns (uint256 normalized) {
        FeedConfig memory cfg = feeds[market];
        if (!cfg.configured) revert FeedNotConfigured(market);
        normalized = _ingest(market, cfg);
    }

    /// @notice Batch variant of {pushPrice}; all markets share one RedStone payload.
    function pushPrices(address[] calldata markets) external onlyRole(KEEPER_ROLE) {
        uint256 len = markets.length;
        for (uint256 i = 0; i < len; ) {
            FeedConfig memory cfg = feeds[markets[i]];
            if (!cfg.configured) revert FeedNotConfigured(markets[i]);
            _ingest(markets[i], cfg);
            unchecked {
                ++i;
            }
        }
    }

    function _ingest(address market, FeedConfig memory cfg) private returns (uint256 normalized) {
        uint256 raw = getOracleNumericValueFromTxMsg(cfg.feedId);
        if (raw == 0) revert InvalidRedStoneValue();
        normalized = _normalize(raw, cfg.feedDecimals);
        if (normalized == 0) revert InvalidRedStoneValue();
        _prices[market] = CachedPrice({price: normalized, timestamp: block.timestamp});
        emit PricePushed(market, cfg.feedId, normalized, block.timestamp);
    }

    /* ============================ READ (VIEW) ============================ */

    /// @inheritdoc IPriceSource
    /// @dev Never reverts: returns `valid == false` when unconfigured, unpushed,
    ///      or stale, so the aggregator can fall back to single-source cleanly.
    function getPrice(
        address market
    ) external view returns (uint256 price, uint256 confidence, uint256 timestamp, bool valid) {
        FeedConfig memory cfg = feeds[market];
        if (!cfg.configured) return (0, 0, 0, false);

        CachedPrice memory cp = _prices[market];
        if (cp.price == 0 || cp.timestamp == 0) return (0, 0, 0, false);

        bool fresh = cfg.maxStaleness == 0 ? true : block.timestamp <= cp.timestamp + cfg.maxStaleness;
        // RedStone aggregates multiple signers but does not expose a confidence
        // band, so confidence is reported as 0 (unknown).
        return (cp.price, 0, cp.timestamp, fresh);
    }

    /// @notice Convenience read of the raw cached entry (price + push time).
    function getCachedPrice(address market) external view returns (uint256 price, uint256 timestamp) {
        CachedPrice memory cp = _prices[market];
        return (cp.price, cp.timestamp);
    }

    function _normalize(uint256 value, uint8 decimals) private pure returns (uint256) {
        if (decimals == 18) return value;
        if (decimals < 18) return value * (10 ** (18 - decimals));
        return value / (10 ** (decimals - 18));
    }
}
