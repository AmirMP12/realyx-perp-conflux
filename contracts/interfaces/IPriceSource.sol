// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IPriceSource
 * @notice Minimal, source-agnostic price feed facade used by `OracleAggregator`
 *         as an INDEPENDENT SECOND source for cross-source deviation checks.
 * @dev Pyth remains the primary source inside `OracleAggregator`. An adapter
 *      implementing this interface (e.g. `RedStoneAdapter`) is consulted only
 *      as a secondary cross-check; it must therefore expose a pure `view` read
 *      that never reverts for an unconfigured/stale market — instead returning
 *      `valid == false` so the aggregator can cleanly fall back to single
 *      source rather than bricking a price read.
 *
 *      UNITS: `price` and `confidence` are normalized to 1e18 price units, the
 *      same scale family the aggregator uses for its Pyth-derived prices, so a
 *      consumer can compare the two sources directly.
 */
interface IPriceSource {
    /**
     * @notice Latest price for `market` from this secondary source.
     * @param market Market/collection address (same key space as the aggregator).
     * @return price 1e18-scaled price, or 0 when unavailable.
     * @return confidence Absolute uncertainty band in 1e18 price units; 0 when the
     *         source does not expose a confidence band (e.g. RedStone).
     * @return timestamp Observation time (e.g. the keeper push time for a cached source).
     * @return valid True only when `price` is configured and fresh enough to use.
     */
    function getPrice(
        address market
    ) external view returns (uint256 price, uint256 confidence, uint256 timestamp, bool valid);
}
