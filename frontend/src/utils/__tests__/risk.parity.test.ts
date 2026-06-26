import { describe, it, expect } from 'vitest';
import {
    dynamicMaintenanceMargin,
    isolatedLiquidationPrice,
    distanceToLiquidationPct,
} from '../risk';

/**
 * Parity tests for the client-side risk math in `utils/risk.ts` against a
 * BigInt fixed-point reference that mirrors `contracts/libraries/PositionMath.sol`
 * exactly (same integer-division truncation, same constants).
 *
 * A divergence here means the liquidation price shown to a leveraged trader no
 * longer matches what the contract will actually enforce — the single highest-
 * trust failure mode in the app. These tests fail loudly if either side drifts.
 */

// ── Solidity constants (1e18 fixed point) ──
const PRECISION = 10n ** 18n;
const BPS = 10000n;
const DEFAULT_MAINTENANCE_MARGIN_BPS = 500n;
const MAX_DYNAMIC_MAINTENANCE_BPS = 2000n;
const MAINTENANCE_TO_INITIAL_CAP_BPS = 5000n;
// NO_LIQUIDATION_PRICE sentinel: type(uint256).max in the contract. The TS port
// returns null in that case; the reference returns null too for comparison.

/** Faithful BigInt port of PositionMath.calculateDynamicMaintenanceMargin. */
function refMaintenanceMargin(size18: bigint, leverage18: bigint): bigint {
    const leverageMultiplier = leverage18 / PRECISION; // integer truncation
    let additionalBps = 0n;
    if (leverageMultiplier > 5n) {
        additionalBps = ((leverageMultiplier - 5n) / 5n) * 50n;
    }
    let totalBps = DEFAULT_MAINTENANCE_MARGIN_BPS + additionalBps;
    if (totalBps > MAX_DYNAMIC_MAINTENANCE_BPS) totalBps = MAX_DYNAMIC_MAINTENANCE_BPS;

    let margin = (size18 * totalBps) / BPS;

    if (leverage18 > 0n) {
        const initialMargin = (size18 * PRECISION) / leverage18;
        const cap = (initialMargin * MAINTENANCE_TO_INITIAL_CAP_BPS) / BPS;
        if (margin > cap) margin = cap;
    }
    return margin;
}

/** Faithful BigInt port of PositionMath.calculateLiquidationPrice. Returns null on sentinel. */
function refLiquidationPrice(
    entryPrice18: bigint,
    leverage18: bigint,
    size18: bigint,
    isLong: boolean,
): bigint | null {
    const mmMargin = refMaintenanceMargin(size18, leverage18);
    const mmFraction =
        size18 > 0n ? (mmMargin * PRECISION) / size18 : (DEFAULT_MAINTENANCE_MARGIN_BPS * PRECISION) / BPS;
    const inverseL = (PRECISION * PRECISION) / leverage18;

    if (isLong) {
        if (PRECISION + mmFraction <= inverseL) return null;
        const factor = PRECISION + mmFraction - inverseL;
        return (entryPrice18 * factor) / PRECISION;
    }
    if (mmFraction >= PRECISION) return null;
    const factor = PRECISION + inverseL - mmFraction;
    return (entryPrice18 * factor) / PRECISION;
}

const toF = (x18: bigint) => Number(x18) / 1e18;

/** Relative tolerance: float64 vs. 1e18 fixed point. 1e-6 is comfortably tight. */
function expectClose(actual: number, expected: number, rel = 1e-6) {
    if (expected === 0) {
        expect(Math.abs(actual)).toBeLessThan(1e-9);
        return;
    }
    expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(rel);
}

const LEVERAGES = [1, 2, 3, 5, 6, 10, 15, 16, 20, 25, 50, 100];
const PRICES = [1, 27.35, 100, 4231.78, 68000];
const SIZES = [10, 100, 1000, 250000];

describe('risk.ts ↔ PositionMath.sol parity', () => {
    describe('dynamicMaintenanceMargin', () => {
        it('matches the on-chain margin across leverage/size grid', () => {
            for (const lev of LEVERAGES) {
                for (const size of SIZES) {
                    const ref = toF(refMaintenanceMargin(BigInt(size) * PRECISION, BigInt(lev) * PRECISION));
                    expectClose(dynamicMaintenanceMargin(size, lev), ref);
                }
            }
        });

        it('returns 0 for non-positive inputs', () => {
            expect(dynamicMaintenanceMargin(0, 10)).toBe(0);
            expect(dynamicMaintenanceMargin(100, 0)).toBe(0);
        });
    });

    describe('isolatedLiquidationPrice', () => {
        it('matches on-chain liq price for longs across the grid', () => {
            for (const lev of LEVERAGES) {
                for (const size of SIZES) {
                    for (const price of PRICES) {
                        const ref = refLiquidationPrice(
                            BigInt(Math.round(price * 1e18)),
                            BigInt(lev) * PRECISION,
                            BigInt(size) * PRECISION,
                            true,
                        );
                        const got = isolatedLiquidationPrice(price, lev, size, true);
                        if (ref === null) {
                            expect(got).toBeNull();
                        } else {
                            expect(got).not.toBeNull();
                            expectClose(got as number, toF(ref), 1e-5);
                        }
                    }
                }
            }
        });

        it('matches on-chain liq price for shorts across the grid', () => {
            for (const lev of LEVERAGES) {
                for (const size of SIZES) {
                    for (const price of PRICES) {
                        const ref = refLiquidationPrice(
                            BigInt(Math.round(price * 1e18)),
                            BigInt(lev) * PRECISION,
                            BigInt(size) * PRECISION,
                            false,
                        );
                        const got = isolatedLiquidationPrice(price, lev, size, false);
                        if (ref === null) {
                            expect(got).toBeNull();
                        } else {
                            expect(got).not.toBeNull();
                            expectClose(got as number, toF(ref), 1e-5);
                        }
                    }
                }
            }
        });

        it('returns null for invalid inputs (sentinel parity)', () => {
            expect(isolatedLiquidationPrice(0, 10, 1000, true)).toBeNull();
            expect(isolatedLiquidationPrice(100, 0, 1000, true)).toBeNull();
        });

        it('places long liquidation below entry and short above entry', () => {
            const entry = 1000;
            const longLiq = isolatedLiquidationPrice(entry, 10, 5000, true);
            const shortLiq = isolatedLiquidationPrice(entry, 10, 5000, false);
            expect(longLiq).not.toBeNull();
            expect(shortLiq).not.toBeNull();
            expect(longLiq as number).toBeLessThan(entry);
            expect(shortLiq as number).toBeGreaterThan(entry);
        });
    });

    describe('distanceToLiquidationPct', () => {
        it('is a positive percentage on both sides', () => {
            const entry = 1000;
            const longLiq = isolatedLiquidationPrice(entry, 10, 5000, true);
            const shortLiq = isolatedLiquidationPrice(entry, 10, 5000, false);
            const dl = distanceToLiquidationPct(entry, longLiq, true);
            const ds = distanceToLiquidationPct(entry, shortLiq, false);
            expect(dl).toBeGreaterThan(0);
            expect(ds).toBeGreaterThan(0);
        });

        it('returns null when liq price is null or mark <= 0', () => {
            expect(distanceToLiquidationPct(1000, null, true)).toBeNull();
            expect(distanceToLiquidationPct(0, 900, true)).toBeNull();
        });
    });
});
