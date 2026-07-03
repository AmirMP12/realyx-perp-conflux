import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSingleMarketData } from '../useMarketData';
import { useReadContracts } from 'wagmi';

vi.mock('wagmi', () => ({ useReadContracts: vi.fn() }));
vi.mock('../useProgram', () => ({
    TRADING_CORE_ADDRESS: '0xCore', TRADING_CORE_ABI: [],
    ORACLE_AGGREGATOR_ADDRESS: '0xOracle', ORACLE_ABI: [],
    VAULT_CORE_ADDRESS: '0xVault', VAULT_ABI: [],
}));

function mockCore(core: any, price: any) {
    (useReadContracts as any).mockImplementation(({ contracts }: any) => {
        const fn = contracts?.[0]?.functionName;
        if (fn === 'getMarketInfo') return { data: core, refetch: vi.fn(), isPending: false };
        if (fn === 'getPrice') return { data: price, refetch: vi.fn(), isPending: false };
        return { data: undefined, refetch: vi.fn(), isPending: false };
    });
}

describe('useMarketData tuple decoding', () => {
    beforeEach(() => vi.clearAllMocks());

    it('catches non-numeric BigInt conversions and returns zero', () => {
        const badInfo = { totalLongSize: 'not-a-number', totalShortSize: 'x', maxLeverage: 'y', maxPositionSize: 'z', maxTotalExposure: 'q', maintenanceMargin: 'w', initialMargin: 'e' };
        mockCore(
            [{ status: 'success', result: badInfo }, { status: 'success', result: { fundingRate: 0n } }],
            [{ result: undefined }],
        );
        const { result } = renderHook(() => useSingleMarketData('0xMarket' as any));
        expect(result.current.formatted?.longOI).toBe(0);
        expect(result.current.formatted?.maxLeverage).toBe(0);
    });

    it('returns undefined market info for a short tuple (<10 entries)', () => {
        mockCore(
            [{ status: 'success', result: [1n, 2n, 3n] }, { status: 'success', result: [] }],
            [{ result: undefined }],
        );
        const { result } = renderHook(() => useSingleMarketData('0xMarket' as any));
        expect(result.current.formatted?.longOI).toBe(0);
        expect(result.current.raw?.fundingState).toBeUndefined();
    });

    it('returns undefined funding state for an empty funding array', () => {
        mockCore(
            [{ status: 'success', result: { totalLongSize: 0n, totalShortSize: 0n, maxLeverage: 1n, maxPositionSize: 0n, maxTotalExposure: 0n, maintenanceMargin: 0n, initialMargin: 0n } }, { status: 'success', result: [] }],
            [{ result: undefined }],
        );
        const { result } = renderHook(() => useSingleMarketData('0xMarket' as any));
        expect(result.current.raw?.fundingState).toBeUndefined();
    });
});
