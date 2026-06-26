import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReadContract, useReadContracts } from 'wagmi';
import { useCollateralAssets, formatHaircut } from '../useCollateral';

// useUSDC / useUSDCDecimals read via useReadContract; provide sane defaults.
vi.mock('../useProgram', () => ({
    useUSDC: () => ({ address: '0xUSDC' }),
    useUSDCDecimals: () => ({ decimals: 6 }),
}));

// Force a configured registry address for these tests.
vi.mock('../../contracts', () => ({
    COLLATERAL_REGISTRY_ADDRESS: '0x00000000000000000000000000000000000000Ce',
    COLLATERAL_REGISTRY_ABI: [],
    MULTI_COLLATERAL_ORDERS_ENABLED: false,
}));

const TOKEN = '0x00000000000000000000000000000000000000A1';

describe('formatHaircut', () => {
    it('converts bps to a percent string', () => {
        expect(formatHaircut(250)).toBe('2.5%');
        expect(formatHaircut(0)).toBe('0%');
        expect(formatHaircut(10000)).toBe('100%');
    });
});

describe('useCollateralAssets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('always exposes USDC as the canonical settlement asset', () => {
        (useReadContract as any).mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() });
        (useReadContracts as any).mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });

        const { result } = renderHook(() => useCollateralAssets());
        expect(result.current.usdc.isUSDC).toBe(true);
        expect(result.current.usdc.symbol).toBe('USDT0');
        expect(result.current.assets[0].isUSDC).toBe(true);
        expect(result.current.hasAltCollateral).toBe(false);
    });

    it('maps a registered alt token with haircut, balance and effective value', () => {
        (useReadContract as any).mockReturnValue({ data: [TOKEN], isLoading: false, refetch: vi.fn() });

        (useReadContracts as any).mockImplementation(({ contracts }: any) => {
            const fn = contracts?.[0]?.functionName;
            if (fn === 'getCollateralConfig') {
                // base data batch: [config, totalDeposited, symbol, balanceOf]
                return {
                    data: [
                        { status: 'success', result: {
                            enabled: true,
                            baseHaircutBps: 200,
                            liquidationHaircutBps: 500,
                            maxHaircutBps: 3000,
                            utilizationSlopeBps: 0,
                            volatilityAdderBps: 0,
                            maxProtocolExposure: 1_000_000n, // 1 USDC-equiv (6 dp) cap
                            oracleFeed: '0xFEED',
                            decimals: 18,
                        } },
                        { status: 'success', result: 5_000_000_000_000_000_000n }, // totalDeposited (18dp) = 5
                        { status: 'success', result: 'WETH' },
                        { status: 'success', result: 2_000_000_000_000_000_000n }, // balance (18dp) = 2
                    ],
                    isLoading: false,
                    refetch: vi.fn(),
                };
            }
            // value batch: [effectiveUsdc(user), exposureUsdc(protocol)]
            return {
                data: [
                    { status: 'success', result: 1_960_000n }, // ≈ 1.96 USDC for the user
                    { status: 'success', result: 500_000n },   // 0.5 USDC protocol exposure
                ],
                isLoading: false,
                refetch: vi.fn(),
            };
        });

        const { result } = renderHook(() => useCollateralAssets());
        expect(result.current.hasAltCollateral).toBe(true);

        const alt = result.current.altAssets[0];
        expect(alt.symbol).toBe('WETH');
        expect(alt.baseHaircutBps).toBe(200);
        expect(alt.decimals).toBe(18);
        expect(alt.balanceFormatted).toBeCloseTo(2);
        expect(alt.effectiveUsdcFormatted).toBeCloseTo(1.96);
        // 0.5 / 1.0 cap = 50% utilization
        expect(alt.exposureUtilization).toBeCloseTo(0.5);
    });
});
