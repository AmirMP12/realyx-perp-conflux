import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePositions } from '../usePositions';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { parseUnits } from 'viem';

vi.mock('wagmi', async (importOriginal) => {
    const original = await importOriginal<any>();
    return {
        ...original,
        useAccount: vi.fn(),
        useReadContract: vi.fn(),
        useReadContracts: vi.fn(),
    };
});

describe('usePositions', () => {
    const mockAddress = '0x123';

    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: mockAddress, isConnected: true });
        (useReadContract as any).mockReturnValue({ data: null, isLoading: false, refetch: vi.fn() });
        (useReadContracts as any).mockReturnValue({ data: null, isLoading: false, refetch: vi.fn() });
    });

    it('should return empty positions when wallet is disconnected', () => {
        (useAccount as any).mockReturnValue({ address: undefined, isConnected: false });
        const { result } = renderHook(() => usePositions());
        expect(result.current.positions).toEqual([]);
        expect(result.current.isLoading).toBe(false);
    });

    it('should show loading state when fetching ids or details', () => {
        (useReadContract as any).mockReturnValue({ data: null, isLoading: true });
        const { result } = renderHook(() => usePositions());
        expect(result.current.isLoading).toBe(true);
    });

    it('should format positions correctly on success', () => {
        const mockIds = [1n, 2n];
        (useReadContract as any).mockReturnValue({ data: mockIds, isLoading: false, refetch: vi.fn() });

        (useReadContracts as any).mockImplementation(({ contracts }: any) => {
            const functionName = contracts[0]?.functionName;
            
            if (functionName === 'getPosition') {
                return {
                    data: [
                        {
                            status: 'success',
                            result: {
                                size: parseUnits('1000', 18),
                                entryPrice: parseUnits('2000', 18),
                                leverage: parseUnits('5', 18),
                                stopLossPrice: parseUnits('1800', 18),
                                takeProfitPrice: parseUnits('2500', 18),
                                market: '0xMarket',
                                openTimestamp: 1600000000n,
                                flags: 1n, // Long
                                state: 1, // OPEN
                                liquidationPrice: parseUnits('1600', 18),
                            }
                        },
                        {
                            status: 'success',
                            result: {
                                size: parseUnits('500', 18),
                                entryPrice: parseUnits('3000', 18),
                                leverage: parseUnits('10', 18),
                                stopLossPrice: 0n,
                                takeProfitPrice: 0n,
                                market: '0xMarket2',
                                openTimestamp: 1600000100n,
                                flags: 0n, // Short
                                state: 2, // CLOSED
                                liquidationPrice: parseUnits('3300', 18),
                            }
                        }
                    ],
                    isLoading: false,
                    refetch: vi.fn()
                };
            }

            if (functionName === 'getPositionPnL') {
                return {
                    data: [
                        { status: 'success', result: [parseUnits('100', 18)] }, // +100 PnL
                        { status: 'success', result: [parseUnits('-20', 18)] }  // -20 PnL
                    ],
                    isLoading: false,
                    refetch: vi.fn()
                };
            }

            if (functionName === 'ownerOf') {
                return {
                    data: [
                        { status: 'success', result: mockAddress },
                        { status: 'success', result: mockAddress }
                    ],
                    isLoading: false,
                    refetch: vi.fn()
                };
            }

            return { data: null, isLoading: false, refetch: vi.fn() };
        });

        const { result } = renderHook(() => usePositions());

        expect(result.current.positions).toHaveLength(1);
        expect(result.current.closedPositions).toHaveLength(1);
        
        const openPos = result.current.positions[0];
        expect(openPos.id).toBe('1');
        expect(openPos.size).toBe('1000.0000');
        expect(openPos.pnl).toBe('100.00');
        expect(openPos.isLong).toBe(true);
        expect(openPos.leverage).toBe('5.0');
        expect(openPos.marketAddress).toBe('0xMarket');

        const closedPos = result.current.closedPositions[0];
        expect(closedPos.id).toBe('2');
        expect(closedPos.isLong).toBe(false);
    });

    it('should ignore positions not owned by the user', () => {
        (useReadContract as any).mockReturnValue({ data: [1n], isLoading: false, refetch: vi.fn() });
        (useReadContracts as any).mockImplementation(({ contracts }: any) => {
            const functionName = contracts[0]?.functionName;
            if (functionName === 'getPosition') {
                return {
                    data: [{ status: 'success', result: { size: 1000n, state: 1, flags: 1n } }],
                    isLoading: false
                };
            }
            if (functionName === 'ownerOf') {
                return {
                    data: [{ status: 'success', result: '0xSomeoneElse' }],
                    isLoading: false
                };
            }
            return { data: [], isLoading: false };
        });

        const { result } = renderHook(() => usePositions());
        expect(result.current.positions).toHaveLength(0);
    });

    it('should handle refetch', async () => {
        const refetchIds = vi.fn().mockResolvedValue({});
        const refetchDetails = vi.fn().mockResolvedValue({});
        (useReadContract as any).mockReturnValue({ data: [], isLoading: false, refetch: refetchIds });
        (useReadContracts as any).mockReturnValue({ data: [], isLoading: false, refetch: refetchDetails });

        const { result } = renderHook(() => usePositions());
        await result.current.refetch();

        expect(refetchIds).toHaveBeenCalled();
        expect(refetchDetails).toHaveBeenCalled();
    });
});
