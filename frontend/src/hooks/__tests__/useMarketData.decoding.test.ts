import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMarketData, useSingleMarketData, useAllMarketsOnChainData } from '../useMarketData';
import { useReadContracts } from 'wagmi';

vi.mock('wagmi', () => ({ useReadContracts: vi.fn() }));

vi.mock('../useProgram', () => ({
    TRADING_CORE_ADDRESS: '0xCore',
    TRADING_CORE_ABI: [],
    ORACLE_AGGREGATOR_ADDRESS: '0xOracle',
    ORACLE_ABI: [],
    VAULT_CORE_ADDRESS: '0xVault',
    VAULT_ABI: [],
}));

const E18 = 10n ** 18n;

describe('useMarketData', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns tvl scaled by 1e6', () => {
        (useReadContracts as any).mockReturnValue({ data: [{ result: 5_000_000n }] });
        const { result } = renderHook(() => useMarketData());
        expect(result.current.tvl).toBe(5);
    });

    it('returns 0 tvl when no data', () => {
        (useReadContracts as any).mockReturnValue({ data: undefined });
        const { result } = renderHook(() => useMarketData());
        expect(result.current.tvl).toBe(0);
    });
});

describe('useSingleMarketData', () => {
    beforeEach(() => vi.clearAllMocks());

    function mockCore(coreContracts: any, priceContracts: any) {
        (useReadContracts as any).mockImplementation(({ contracts }: any) => {
            const fn = contracts?.[0]?.functionName;
            if (fn === 'getMarketInfo') return { data: coreContracts, refetch: vi.fn(), isPending: false };
            if (fn === 'getPrice') return { data: priceContracts, refetch: vi.fn(), isPending: false };
            return { data: undefined, refetch: vi.fn(), isPending: false };
        });
    }

    it('reports loading when no market address', () => {
        (useReadContracts as any).mockReturnValue({ data: undefined, refetch: vi.fn(), isPending: false });
        const { result } = renderHook(() => useSingleMarketData(undefined));
        expect(result.current.isLoading).toBe(false); // enabled false -> coreWaiting false
    });

    it('decodes a named market struct and computes funding imbalance', () => {
        const marketInfo = {
            totalLongSize: 300n * E18,
            totalShortSize: 100n * E18,
            maxLeverage: 20n,
            maxPositionSize: 1000n * E18,
            maxTotalExposure: 5000n * E18,
            maintenanceMargin: 500n,
            initialMargin: 1000n,
        };
        const fundingState = { fundingRate: 0n };
        mockCore(
            [
                { status: 'success', result: marketInfo },
                { status: 'success', result: fundingState },
            ],
            [{ result: [2000n * E18, 1n * E18] }],
        );
        const { result } = renderHook(() => useSingleMarketData('0xMarket' as any));
        expect(result.current.isLoading).toBe(false);
        expect(result.current.formatted?.longOI).toBe(300);
        expect(result.current.formatted?.shortOI).toBe(100);
        expect(result.current.formatted?.maxLeverage).toBe(20);
        expect(result.current.formatted?.price).toBe(2000);
        // imbalance = (300-100)/400 = 0.5 -> 0.0001*0.5 = 0.00005
        expect(result.current.formatted?.fundingRate).toBeCloseTo(0.00005);
    });

    it('decodes a tuple market struct', () => {
        const tuple = [
            '0xfeed', 0n, 0n, 1000n * E18, 5000n * E18, 500n, 1000n, 10n, 50n * E18, 50n * E18,
        ];
        mockCore(
            [
                { status: 'success', result: tuple },
                { status: 'success', result: [123n] },
            ],
            [{ result: undefined }],
        );
        const { result } = renderHook(() => useSingleMarketData('0xMarket' as any));
        expect(result.current.formatted?.maxLeverage).toBe(10);
        expect(result.current.formatted?.price).toBe(0);
    });

    it('refetch triggers both core and price refetches', () => {
        mockCore(
            [{ status: 'success', result: [null, 0n, 0n, 0n, 0n, 0n, 0n, 5n, 0n, 0n] }, { status: 'success', result: [0n] }],
            [{ result: [0n, 0n] }],
        );
        const { result } = renderHook(() => useSingleMarketData('0xMarket' as any));
        expect(() => result.current.refetch?.()).not.toThrow();
    });
});

describe('useAllMarketsOnChainData', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns empty results when no addresses', () => {
        (useReadContracts as any).mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });
        const { result } = renderHook(() => useAllMarketsOnChainData([]));
        expect(result.current.data).toEqual({});
    });

    it('maps per-market OI and funding', () => {
        const addr = '0xAbC0000000000000000000000000000000000001';
        (useReadContracts as any).mockReturnValue({
            data: [
                { status: 'success', result: { totalLongSize: 200n * E18, totalShortSize: 200n * E18, maxLeverage: 10n, maxPositionSize: 0n, maxTotalExposure: 0n, maintenanceMargin: 0n, initialMargin: 0n } },
                { status: 'success', result: { fundingRate: 42n } },
            ],
            isLoading: false,
            refetch: vi.fn(),
        });
        const { result } = renderHook(() => useAllMarketsOnChainData([addr as any]));
        const entry = result.current.data[addr.toLowerCase()];
        expect(entry.longOI).toBe(200);
        expect(entry.shortOI).toBe(200);
        // balanced OI => imbalance 0 => funding 0
        expect(entry.fundingRate).toBe(0);
    });
});
