import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useOnChainHistory } from '../useOnChainHistory';
import { useAccount, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), usePublicClient: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
vi.mock('../../contracts', () => ({ TRADING_CORE_ADDRESS: '0xCore' }));

describe('useOnChainHistory falsy-arg fallbacks', () => {
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

    it('defaults missing size/leverage/price args to zero', async () => {
        // open log with undefined size/leverage/entryPrice -> exercise the `|| 0n` fallbacks
        const bareOpen = { args: { positionId: 1n, market: '0xM', isLong: true }, blockNumber: 10n, transactionHash: '0xA' };
        // close matched to the open but with undefined pnl/price/fee
        const bareClose = { args: { positionId: 1n }, blockNumber: 11n, transactionHash: '0xB' };
        // liquidation matched with undefined price/fee
        const bareLiq = { args: { positionId: 1n }, blockNumber: 12n, transactionHash: '0xC' };
        client.getLogs.mockImplementation(({ event }: any) => {
            if (event.name === 'PositionOpened') return Promise.resolve([bareOpen]);
            if (event.name === 'PositionClosed') return Promise.resolve([bareClose]);
            if (event.name === 'PositionLiquidated') return Promise.resolve([bareLiq]);
            return Promise.resolve([]);
        });
        const data = await queryFn()();
        const open = data.find((d: any) => d.type === 'OPEN');
        expect(open.size).toBe('0');
        expect(open.leverage).toBe(0);
        const close = data.find((d: any) => d.type === 'CLOSE');
        expect(close.pnl).toBe('0');
        const liq = data.find((d: any) => d.type === 'LIQUIDATED');
        expect(liq.fee).toBe('0');
    });
});
