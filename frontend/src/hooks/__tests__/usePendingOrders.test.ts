import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePendingOrders, getOrderTypeLabel } from '../usePendingOrders';
import { useAccount, usePublicClient } from 'wagmi';

vi.mock('wagmi', async (importOriginal) => {
    const original = await importOriginal<any>();
    return {
        ...original,
        useAccount: vi.fn(),
        usePublicClient: vi.fn(),
    };
});

describe('usePendingOrders', () => {
    const mockAddress = '0x123';
    const mockPublicClient = {
        getBlockNumber: vi.fn().mockResolvedValue(100000n),
        getLogs: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: mockAddress });
        (usePublicClient as any).mockReturnValue(mockPublicClient);
    });

    describe('getOrderTypeLabel', () => {
        it('should return correct labels', () => {
            expect(getOrderTypeLabel(0)).toBe('Market Increase');
            expect(getOrderTypeLabel(2)).toBe('Limit Increase');
            expect(getOrderTypeLabel(99)).toBe('Unknown (99)');
        });
    });

    it('should return empty orders when disconnected', async () => {
        (useAccount as any).mockReturnValue({ address: undefined });
        const { result } = renderHook(() => usePendingOrders());
        expect(result.current.orders).toEqual([]);
    });

    it('should fetch and filter pending orders', async () => {
        // Mock getLogs responses:
        // 1. Created: Order 1, 2, 3
        // 2. Executed: Order 1
        // 3. Cancelled: Order 2
        // Result should be: Order 3
        
        mockPublicClient.getLogs.mockImplementation(({ event }: any) => {
            if (event.name === 'OrderCreated') {
                return Promise.resolve([
                    { args: { orderId: 1n, orderType: 0, market: '0xM1' } },
                    { args: { orderId: 2n, orderType: 2, market: '0xM1' } },
                    { args: { orderId: 3n, orderType: 0, market: '0xM2' } },
                ]);
            }
            if (event.name === 'OrderExecuted') {
                return Promise.resolve([
                    { args: { orderId: 1n } },
                ]);
            }
            if (event.name === 'OrderCancelled') {
                return Promise.resolve([
                    { args: { orderId: 2n } },
                ]);
            }
            return Promise.resolve([]);
        });

        const { result } = renderHook(() => usePendingOrders());

        await waitFor(() => expect(result.current.loading).toBe(false));
        
        expect(result.current.orders).toHaveLength(1);
        expect(result.current.orders[0].orderId).toBe(3n);
        expect(result.current.orders[0].market).toBe('0xM2');
    });

    it('should handle getLogs error gracefully', async () => {
        mockPublicClient.getLogs.mockRejectedValue(new Error('RPC Error'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { result } = renderHook(() => usePendingOrders());
        await waitFor(() => expect(result.current.loading).toBe(false));
        
        expect(result.current.orders).toEqual([]);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('should calculate fromBlock correctly', async () => {
        mockPublicClient.getBlockNumber.mockResolvedValue(100000n);
        mockPublicClient.getLogs.mockResolvedValue([]);

        renderHook(() => usePendingOrders());
        
        await waitFor(() => {
            expect(mockPublicClient.getLogs).toHaveBeenCalledWith(expect.objectContaining({
                fromBlock: 100000n - 49000n
            }));
        });
    });

    it('should use fromBlock 0 if blockNumber is small', async () => {
        mockPublicClient.getBlockNumber.mockResolvedValue(100n);
        mockPublicClient.getLogs.mockResolvedValue([]);

        renderHook(() => usePendingOrders());
        
        await waitFor(() => {
            expect(mockPublicClient.getLogs).toHaveBeenCalledWith(expect.objectContaining({
                fromBlock: 0n
            }));
        });
    });
});
