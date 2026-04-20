import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOnChainHistory } from '../useOnChainHistory';
import { useAccount, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { parseUnits } from 'viem';

vi.mock('wagmi', async (importOriginal) => {
    const original = await importOriginal<any>();
    return {
        ...original,
        useAccount: vi.fn(),
        usePublicClient: vi.fn(),
    };
});

vi.mock('@tanstack/react-query', () => ({
    useQuery: vi.fn(),
}));

describe('useOnChainHistory', () => {
    const mockAddress = '0x123';
    const mockPublicClient = {
        getLogs: vi.fn(),
        getBlock: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: mockAddress });
        (usePublicClient as any).mockReturnValue(mockPublicClient);
        
        // Mock useQuery to actually execute queryFn if enabled
        (useQuery as any).mockImplementation(({ queryFn, enabled }: any) => {
            if (enabled === false) return { data: [], isLoading: false };
            
            // We'll mock the query result manually in tests or call queryFn
            return { data: undefined, isLoading: true, queryFn };
        });
    });

    it('should return empty array if disconnected', () => {
        (useAccount as any).mockReturnValue({ address: undefined });
        (useQuery as any).mockReturnValue({ data: [] });
        
        const { result } = renderHook(() => useOnChainHistory());
        expect(result.current.data).toEqual([]);
    });

    it('should fetch and combine logs correctly', async () => {
        const queryResult = {
            data: [],
            isLoading: false,
        };
        (useQuery as any).mockReturnValue(queryResult);

        // Get the queryFn from the hook call
        const { result } = renderHook(() => useOnChainHistory());
        const queryFn = (useQuery as any).mock.calls[0][0].queryFn;

        // Mock Logs
        const openLog = {
            args: { 
                positionId: 1n, 
                trader: mockAddress, 
                market: '0xM1', 
                isLong: true, 
                size: parseUnits('100', 18), 
                leverage: parseUnits('5', 18),
                entryPrice: parseUnits('2000', 18)
            },
            blockNumber: 100n,
            transactionHash: '0xH1'
        };
        const closeLog = {
            args: {
                positionId: 1n,
                trader: mockAddress,
                realizedPnL: parseUnits('10', 18),
                exitPrice: parseUnits('2100', 18),
                closingFee: parseUnits('1', 18)
            },
            blockNumber: 110n,
            transactionHash: '0xH2'
        };

        mockPublicClient.getLogs.mockImplementation(({ event }: any) => {
            // Check event logic or just index
            if (event.name === 'PositionOpened') return Promise.resolve([openLog]);
            if (event.name === 'PositionClosed') return Promise.resolve([closeLog]);
            if (event.name === 'PositionLiquidated') return Promise.resolve([]);
            return Promise.resolve([]);
        });

        mockPublicClient.getBlock.mockImplementation(({ blockNumber }: any) => {
            if (blockNumber === 100n) return Promise.resolve({ number: 100n, timestamp: 1600000000n });
            if (blockNumber === 110n) return Promise.resolve({ number: 110n, timestamp: 1600010000n });
            return Promise.resolve({ number: blockNumber, timestamp: 0n });
        });

        const data = await queryFn();

        expect(data).toHaveLength(2);
        // Sorted by timestamp desc
        expect(data[0].type).toBe('CLOSE');
        expect(data[1].type).toBe('OPEN');
        expect(data[0].pnl).toBe('10');
    });

    it('should handle liquidations', async () => {
        const { result } = renderHook(() => useOnChainHistory());
        const queryFn = (useQuery as any).mock.calls[0][0].queryFn;

        const openLog = { args: { positionId: 1n, market: '0xM1', isLong: true, size: 100n * 10n**18n, leverage: 5n * 10n**18n }, blockNumber: 100n };
        const liqLog = { args: { positionId: 1n, liquidationPrice: 1800n * 10n**18n, liquidationFee: 2n * 10n**18n }, blockNumber: 105n, transactionHash: '0xL' };

        mockPublicClient.getLogs.mockImplementation(({ event }: any) => {
            if (event.name === 'PositionOpened') return Promise.resolve([openLog]);
            if (event.name === 'PositionClosed') return Promise.resolve([]);
            if (event.name === 'PositionLiquidated') return Promise.resolve([liqLog]);
            return Promise.resolve([]);
        });
        mockPublicClient.getBlock.mockResolvedValue({ number: 100n, timestamp: 1600000000n });

        const data = await queryFn();
        const liq = data.find((d: any) => d.type === 'LIQUIDATED');
        expect(liq).toBeDefined();
        // Lost margin = 100 / 5 = 20
        expect(liq.pnl).toBe('-20.00');
    });

    it('should handle fetch errors gracefully', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useOnChainHistory());
        const queryFn = (useQuery as any).mock.calls[0][0].queryFn;

        mockPublicClient.getLogs.mockRejectedValue(new Error('RPC FAIL'));
        
        const data = await queryFn();
        expect(data).toEqual([]);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
});
