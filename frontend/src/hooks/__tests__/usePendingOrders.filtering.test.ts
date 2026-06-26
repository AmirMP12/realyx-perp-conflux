import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePendingOrders, getOrderTypeLabel } from '../usePendingOrders';
import { useAccount, usePublicClient } from 'wagmi';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), usePublicClient: vi.fn() }));
vi.mock('../useProgram', () => ({ TRADING_CORE_ADDRESS: '0xCore' }));

describe('usePendingOrders extra', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser' });
    });

    it('getOrderTypeLabel covers known and unknown types', () => {
        expect(getOrderTypeLabel(0)).toBe('Market Increase');
        expect(getOrderTypeLabel(3)).toBe('Limit Decrease');
        expect(getOrderTypeLabel(99)).toContain('Unknown');
    });

    it('returns [] when no public client or address', () => {
        (usePublicClient as any).mockReturnValue(undefined);
        const { result } = renderHook(() => usePendingOrders());
        expect(result.current.orders).toEqual([]);
    });

    it('filters out executed and cancelled orders', async () => {
        const publicClient = {
            getBlockNumber: vi.fn().mockResolvedValue(100_000n),
            getLogs: vi.fn().mockImplementation(({ event }: any) => {
                if (event.name === 'OrderCreated') return Promise.resolve([
                    { args: { orderId: 1n, orderType: 2, market: '0xM' } },
                    { args: { orderId: 2n, orderType: 0, market: '0xM' } },
                    { args: { orderId: undefined } }, // skipped (no id)
                ]);
                if (event.name === 'OrderExecuted') return Promise.resolve([{ args: { orderId: 2n } }]);
                if (event.name === 'OrderCancelled') return Promise.resolve([]);
                return Promise.resolve([]);
            }),
        };
        (usePublicClient as any).mockReturnValue(publicClient);
        const { result } = renderHook(() => usePendingOrders());
        await waitFor(() => expect(result.current.orders.length).toBe(1));
        expect(result.current.orders[0].orderId).toBe(1n);
    });

    it('returns [] when there are no created logs', async () => {
        const publicClient = {
            getBlockNumber: vi.fn().mockResolvedValue(10n),
            getLogs: vi.fn().mockResolvedValue([]),
        };
        (usePublicClient as any).mockReturnValue(publicClient);
        const { result } = renderHook(() => usePendingOrders());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.orders).toEqual([]);
    });

    it('handles getLogs errors gracefully', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const publicClient = {
            getBlockNumber: vi.fn().mockResolvedValue(100_000n),
            getLogs: vi.fn().mockRejectedValue(new Error('rpc')),
        };
        (usePublicClient as any).mockReturnValue(publicClient);
        const { result } = renderHook(() => usePendingOrders());
        await waitFor(() => expect(spy).toHaveBeenCalled());
        expect(result.current.orders).toEqual([]);
        spy.mockRestore();
    });
});
