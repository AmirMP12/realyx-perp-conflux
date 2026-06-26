import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCollateralAssets, formatHaircut } from '../useCollateral';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), useReadContract: vi.fn(), useReadContracts: vi.fn() }));
vi.mock('../../contracts', () => ({
    COLLATERAL_REGISTRY_ADDRESS: '0xRegistry', COLLATERAL_REGISTRY_ABI: [], MULTI_COLLATERAL_ORDERS_ENABLED: true,
}));
vi.mock('../useProgram', () => ({ useUSDC: () => ({ address: '0xUSDC' }), useUSDCDecimals: () => ({ decimals: 6 }) }));

const E18 = 10n ** 18n;
const E6 = 10n ** 6n;
const TOKEN = '0xAaa0000000000000000000000000000000000001';

describe('useCollateralAssets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser' });
    });

    it('formatHaircut formats basis points', () => {
        expect(formatHaircut(200)).toBe('2%');
        expect(formatHaircut(0)).toBe('0%');
    });

    it('maps a registered token with config, balance and exposure utilization', () => {
        (useReadContract as any).mockReturnValue({ data: [TOKEN], isLoading: false, refetch: vi.fn() });
        (useReadContracts as any).mockImplementation(({ contracts }: any) => {
            const fn = contracts?.[0]?.functionName;
            if (fn === 'getCollateralConfig') {
                return {
                    data: [
                        { result: { enabled: true, baseHaircutBps: 200, liquidationHaircutBps: 300, maxHaircutBps: 500, maxProtocolExposure: 10n * E6, decimals: 18 }, status: 'success' },
                        { result: 5n * E18, status: 'success' }, // totalDeposited
                        { result: 'WBTC', status: 'success' }, // symbol
                        { result: 2n * E18, status: 'success' }, // balance
                    ],
                    isLoading: false, refetch: vi.fn(),
                };
            }
            if (fn === 'getCollateralValue') {
                return {
                    data: [
                        { result: 90000n * E6, status: 'success' }, // effective user value
                        { result: 5n * E6, status: 'success' }, // exposure value
                    ],
                    refetch: vi.fn(),
                };
            }
            return { data: undefined, isLoading: false, refetch: vi.fn() };
        });
        const { result } = renderHook(() => useCollateralAssets());
        expect(result.current.registryConfigured).toBe(true);
        const alt = result.current.altAssets[0];
        expect(alt.symbol).toBe('WBTC');
        expect(alt.enabled).toBe(true);
        expect(alt.baseHaircutBps).toBe(200);
        expect(alt.exposureUtilization).not.toBeNull();
        // refetch wires through without throwing
        act(() => { result.current.refetch(); });
    });

    it('falls back for missing config/symbol/value (uncapped exposure, failed value reads)', () => {
        (useReadContract as any).mockReturnValue({ data: [TOKEN], isLoading: false, refetch: vi.fn() });
        (useReadContracts as any).mockImplementation(({ contracts }: any) => {
            const fn = contracts?.[0]?.functionName;
            if (fn === 'getCollateralConfig') {
                return {
                    data: [
                        { result: undefined, status: 'failure' }, // no config -> decimals default, disabled
                        { result: undefined, status: 'failure' }, // no totalDeposited
                        { result: undefined, status: 'failure' }, // no symbol -> truncated fallback
                        { result: undefined, status: 'failure' }, // no balance
                    ],
                    isLoading: false, refetch: vi.fn(),
                };
            }
            if (fn === 'getCollateralValue') {
                return { data: [{ status: 'failure' }, { status: 'failure' }], refetch: vi.fn() };
            }
            return { data: undefined, isLoading: false, refetch: vi.fn() };
        });
        const { result } = renderHook(() => useCollateralAssets());
        const alt = result.current.altAssets[0];
        expect(alt.enabled).toBe(false);
        expect(alt.exposureUtilization).toBeNull(); // uncapped
        expect(alt.symbol).toContain('…');
    });

    it('returns only USDT0 when no tokens are registered', () => {
        (useReadContract as any).mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() });
        (useReadContracts as any).mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });
        const { result } = renderHook(() => useCollateralAssets());
        expect(result.current.altAssets).toEqual([]);
        expect(result.current.usdc.symbol).toBe('USDT0');
        expect(result.current.assets.length).toBe(1);
    });
});
