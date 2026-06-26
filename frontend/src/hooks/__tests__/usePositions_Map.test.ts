import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePositions } from '../usePositions';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), useReadContract: vi.fn(), useReadContracts: vi.fn() }));
vi.mock('../useProgram', () => ({ TRADING_CORE_ADDRESS: '0xCore', TRADING_CORE_ABI: [] }));
vi.mock('../../contracts', () => ({ POSITION_TOKEN_ADDRESS: '0xPos', POSITION_TOKEN_ABI: [] }));

const E18 = 10n ** 18n;
const USER = '0xUser';

function setup({ positions, pnl, owner }: any) {
    (useReadContract as any).mockReturnValue({ data: [1n], isLoading: false, refetch: vi.fn() });
    (useReadContracts as any).mockImplementation(({ contracts }: any) => {
        const fn = contracts?.[0]?.functionName;
        if (fn === 'getPosition') return { data: positions, isLoading: false, refetch: vi.fn() };
        if (fn === 'getPositionPnL') return { data: pnl, isLoading: false, refetch: vi.fn() };
        if (fn === 'ownerOf') return { data: owner, isLoading: false, refetch: vi.fn() };
        return { data: undefined, isLoading: false, refetch: vi.fn() };
    });
}

describe('usePositions mapping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: USER, isConnected: true });
    });

    it('returns [] when there are no ids', () => {
        (useReadContract as any).mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() });
        (useReadContracts as any).mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });
        const { result } = renderHook(() => usePositions());
        expect(result.current.positions).toEqual([]);
    });

    it('maps a long position with positive pnl', () => {
        setup({
            positions: [{ status: 'success', result: { size: 1000n * E18, entryPrice: 100n * E18, leverage: 10n * E18, stopLossPrice: 90n * E18, takeProfitPrice: 120n * E18, market: '0xMkt', openTimestamp: 1700000000n, flags: 1n, state: 1, liquidationPrice: 92n * E18 } }],
            pnl: [{ status: 'success', result: [50n * E18] }],
            owner: [{ status: 'success', result: USER }],
        });
        const { result } = renderHook(() => usePositions());
        const p = result.current.positions[0];
        expect(p.isLong).toBe(true);
        expect(p.leverage).toBe('10.0');
        expect(Number(p.markPrice)).toBeGreaterThan(100);
        expect(p.stopLossPrice).toBe(90);
        expect(p.takeProfitPrice).toBe(120);
    });

    it('maps a short position (flags even) with mark below entry', () => {
        setup({
            positions: [{ status: 'success', result: { size: 1000n * E18, entryPrice: 100n * E18, leverage: 5n * E18, stopLossPrice: 0n, takeProfitPrice: 0n, market: '0xMkt', openTimestamp: 1700000000n, flags: 0n, state: 1, liquidationPrice: 110n * E18 } }],
            pnl: [{ status: 'success', result: [20n * E18] }],
            owner: [{ status: 'success', result: USER }],
        });
        const { result } = renderHook(() => usePositions());
        const p = result.current.positions[0];
        expect(p.isLong).toBe(false);
        expect(Number(p.markPrice)).toBeLessThan(100);
    });

    it('filters out a position owned by someone else', () => {
        setup({
            positions: [{ status: 'success', result: { size: 1000n * E18, entryPrice: 100n * E18, leverage: 5n * E18, market: '0xMkt', flags: 1n, state: 1, liquidationPrice: 0n } }],
            pnl: [{ status: 'success', result: [0n] }],
            owner: [{ status: 'success', result: '0xSomeoneElse' }],
        });
        const { result } = renderHook(() => usePositions());
        expect(result.current.positions).toEqual([]);
    });

    it('filters out zero-size and failed reads', () => {
        setup({
            positions: [{ status: 'success', result: { size: 0n, entryPrice: 100n * E18, leverage: 5n * E18, market: '0xMkt', flags: 1n, state: 1 } }],
            pnl: [{ status: 'failure' }],
            owner: [{ status: 'success', result: USER }],
        });
        const { result } = renderHook(() => usePositions());
        expect(result.current.positions).toEqual([]);
    });

    it('decodes an array/tuple-shaped position', () => {
        // [0]size [1]entry [2]liq [3]sl [4]tp [5]leverage [6]market [7]openTs [8]trailingStopBps [9]flags [10]collateralType [11]state [12]collateralToken
        const tuple: any[] = [];
        tuple[0] = 1000n * E18;
        tuple[1] = 100n * E18;
        tuple[2] = 92n * E18;
        tuple[3] = 90n * E18;
        tuple[4] = 120n * E18;
        tuple[5] = 8n * E18;
        tuple[6] = '0xMktTuple';
        tuple[7] = 1700000000n;
        tuple[9] = 1n; // long
        tuple[11] = 1; // OPEN
        setup({
            positions: [{ status: 'success', result: tuple }],
            pnl: [{ status: 'success', result: [10n * E18] }],
            owner: [{ status: 'success', result: USER }],
        });
        const { result } = renderHook(() => usePositions());
        const p = result.current.positions[0];
        expect(p.isLong).toBe(true);
        expect(p.marketAddress).toBe('0xMktTuple');
        expect(p.stopLossPrice).toBe(90);
        expect(p.takeProfitPrice).toBe(120);
        expect(p.leverage).toBe('8.0');
    });

    it('includes positions when owner read is unavailable', () => {
        setup({
            positions: [{ status: 'success', result: { size: 1000n * E18, entryPrice: 100n * E18, leverage: 5n * E18, market: '0xMkt', flags: 1n, state: 1, liquidationPrice: 0n } }],
            pnl: [{ status: 'success', result: [0n] }],
            owner: undefined,
        });
        const { result } = renderHook(() => usePositions());
        expect(result.current.positions.length).toBe(1);
    });
});
