import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useOnChainHistory } from '../useOnChainHistory';
import { useAccount, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), usePublicClient: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
vi.mock('../../contracts', () => ({ TRADING_CORE_ADDRESS: '0xCore' }));

const E18 = 10n ** 18n;

describe('useOnChainHistory queryFn', () => {
    let client: any;
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser' });
        (useQuery as any).mockReturnValue({ data: [], isLoading: false });
        client = {
            getLogs: vi.fn(),
            getBlock: vi.fn(({ blockNumber }: any) => Promise.resolve({ number: blockNumber, timestamp: 1700000000n })),
        };
        (usePublicClient as any).mockReturnValue(client);
    });

    function queryFn() {
        renderHook(() => useOnChainHistory());
        return (useQuery as any).mock.calls[0][0].queryFn;
    }

    it('returns [] when disconnected', async () => {
        (useAccount as any).mockReturnValue({ address: undefined });
        await expect(queryFn()()).resolves.toEqual([]);
    });

    it('combines opens, closes (matched + unmatched), and liquidations', async () => {
        const openLong = { args: { positionId: 1n, market: '0xM1', isLong: true, size: 100n * E18, leverage: 5n * E18, entryPrice: 2000n * E18 }, blockNumber: 100n, transactionHash: '0xA' };
        const openShort = { args: { positionId: 2n, market: '0xM2', isLong: false, size: 50n * E18, leverage: 3n * E18, entryPrice: 1000n * E18 }, blockNumber: 101n, transactionHash: '0xB' };
        const closeMatched = { args: { positionId: 1n, realizedPnL: 10n * E18, exitPrice: 2100n * E18, closingFee: 1n * E18 }, blockNumber: 110n, transactionHash: '0xC' };
        const closeUnmatched = { args: { positionId: 999n, realizedPnL: -5n * E18, exitPrice: 50n * E18, closingFee: 0n }, blockNumber: 111n, transactionHash: '0xD' };
        const liq = { args: { positionId: 2n, liquidationPrice: 900n * E18, liquidationFee: 2n * E18 }, blockNumber: 112n, transactionHash: '0xE' };
        client.getLogs.mockImplementation(({ event }: any) => {
            if (event.name === 'PositionOpened') return Promise.resolve([openLong, openShort]);
            if (event.name === 'PositionClosed') return Promise.resolve([closeMatched, closeUnmatched]);
            if (event.name === 'PositionLiquidated') return Promise.resolve([liq, { args: { positionId: 12345n } }]);
            return Promise.resolve([]);
        });
        const data = await queryFn()();
        const types = data.map((d: any) => d.type).sort();
        expect(types).toContain('OPEN');
        expect(types).toContain('CLOSE');
        expect(types).toContain('LIQUIDATED');
        // unmatched close defaults to SHORT side and '0x' market
        const unmatched = data.find((d: any) => d.id === 999);
        expect(unmatched.market).toBe('0x');
    });

    it('skips the liquidation query when there are no opens', async () => {
        client.getLogs.mockImplementation(({ event }: any) => {
            if (event.name === 'PositionClosed') return Promise.resolve([{ args: { positionId: 5n, realizedPnL: 0n, exitPrice: 0n, closingFee: 0n }, blockNumber: 5n, transactionHash: '0xF' }]);
            return Promise.resolve([]);
        });
        const data = await queryFn()();
        expect(data.every((d: any) => d.type !== 'LIQUIDATED')).toBe(true);
    });

    it('returns [] on RPC error', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        client.getLogs.mockRejectedValue(new Error('rpc'));
        await expect(queryFn()()).resolves.toEqual([]);
        spy.mockRestore();
    });
});
