import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { 
    useUSDC, 
    useUSDCBalance, 
    useCreateOrder, 
    useOpenPosition,
    usePositions,
    useAddCollateral,
    useClosePosition,
    useModifyMargin,
    useSetStopLoss,
    useSetTakeProfit,
    useSetTrailingStop,
    usePartialClose,
    useCancelOrder,
    calculatePnL,
    MOCK_USDC_ADDRESS,
} from '../useProgram';
import { useReadContract, useAccount, useWriteContract, usePublicClient } from 'wagmi';

// Mock wagmi
vi.mock('wagmi', () => ({
    useAccount: vi.fn(() => ({ address: '0xUser', isConnected: true, chainId: 1 })),
    useReadContract: vi.fn(() => ({ data: undefined, isLoading: false, refetch: vi.fn() })),
    useWriteContract: vi.fn(() => ({ writeContractAsync: vi.fn(), isPending: false })),
    usePublicClient: vi.fn(() => ({ readContract: vi.fn() })),
}));

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
    default: {
        success: vi.fn(),
        error: vi.fn(),
    }
}));

// Mock useSound
vi.mock('../useSound', () => ({
    useSound: () => ({ playSuccess: vi.fn(), playError: vi.fn() }),
}));

describe('useProgram hooks - Full Coverage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser', isConnected: true, chainId: 1 });
    });

    describe('useUSDC', () => {
        it('returns MOCK_USDC_ADDRESS when contract read fails', () => {
            (useReadContract as any).mockReturnValue({ data: undefined });
            const { result } = renderHook(() => useUSDC());
            expect(result.current.address).toBe(MOCK_USDC_ADDRESS);
        });

        it('returns contract address when read succeeds', () => {
            (useReadContract as any).mockReturnValue({ data: '0xContractUSDC' });
            const { result } = renderHook(() => useUSDC());
            expect(result.current.address).toBe('0xContractUSDC');
        });
    });

    describe('useUSDCBalance', () => {
        it('returns formatted balance', () => {
            (useReadContract as any).mockReturnValue({ data: BigInt(2000000), isLoading: false });
            const { result } = renderHook(() => useUSDCBalance());
            expect(result.current.balance).toBe(2);
        });
    });

    describe('useCreateOrder', () => {
        it('calls writeContractAsync with correct args', async () => {
            const mockWrite = vi.fn().mockResolvedValue('0xHash');
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite, isPending: false });
            (useReadContract as any).mockReturnValue({ data: BigInt(50000) }); // minFee

            const { result } = renderHook(() => useCreateOrder());
            await act(async () => {
                await result.current.createOrder({
                    market: '0xMarket',
                    sizeDelta: '1000',
                    collateralDelta: '100',
                    isLong: true
                });
            });

            expect(mockWrite).toHaveBeenCalled();
            expect(mockWrite.mock.calls[0][0].functionName).toBe('createOrder');
        });
    });

    describe('useOpenPosition', () => {
        it('handles the full multi-step execution', async () => {
            const mockWrite = vi.fn().mockResolvedValue('0xHash');
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite, isPending: false });
            (useReadContract as any).mockReturnValue({ data: BigInt(50000) });

            const { result } = renderHook(() => useOpenPosition());
            
            await act(async () => {
                await result.current.executePosition({
                    market: '0xMarket',
                    size: '100',
                    leverage: '10',
                    isLong: true
                });
            });

            expect(mockWrite).toHaveBeenCalled(); // Approve OR CreateOrder
        });
    });

    describe('usePositions', () => {
        it('fetches and formats positions', async () => {
            const mockRead = vi.fn()
                .mockResolvedValueOnce({ size: BigInt(1000000), leverage: BigInt(10), state: 1, flags: 1 }) // getPosition
                .mockResolvedValueOnce([BigInt(100000), BigInt(1e18)]); // getPositionPnL
            
            (useReadContract as any).mockReturnValue({ data: [BigInt(1)], isLoading: false });
            (usePublicClient as any).mockReturnValue({ readContract: mockRead });

            const { result } = renderHook(() => usePositions());
            
            await waitFor(() => {
                expect(result.current.positions.length).toBeGreaterThan(0);
            });
            expect(result.current.positions[0].id).toBe(1);
        });
    });

    describe('useAddCollateral', () => {
        it('calls addCollateral', async () => {
            const mockWrite = vi.fn();
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite });
            const { result } = renderHook(() => useAddCollateral());
            await act(async () => {
                await result.current.addCollateral(1, 100);
            });
            expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'addCollateral' }));
        });
    });

    describe('useClosePosition', () => {
        it('calls closePosition', async () => {
            const mockWrite = vi.fn();
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite });
            const { result } = renderHook(() => useClosePosition());
            await act(async () => {
                await result.current.closePosition(1);
            });
            expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'closePosition' }));
        });
    });

    describe('useModifyMargin', () => {
        it('calls addCollateral for positive delta', async () => {
            const mockWrite = vi.fn();
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite });
            const { result } = renderHook(() => useModifyMargin());
            await act(async () => {
                await result.current.modifyMargin(1, 100);
            });
            expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'addCollateral' }));
        });

        it('calls withdrawCollateral for negative delta', async () => {
            const mockWrite = vi.fn();
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite });
            const { result } = renderHook(() => useModifyMargin());
            await act(async () => {
                await result.current.modifyMargin(1, -100);
            });
            expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'withdrawCollateral' }));
        });
    });

    describe('useSetStopLoss', () => {
        it('calls setStopLoss', async () => {
            const mockWrite = vi.fn();
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite });
            const { result } = renderHook(() => useSetStopLoss());
            await act(async () => {
                await result.current.setStopLoss(1, 2500);
            });
            expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'setStopLoss' }));
        });
    });

    describe('useSetTakeProfit', () => {
        it('calls setTakeProfit', async () => {
            const mockWrite = vi.fn();
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite });
            const { result } = renderHook(() => useSetTakeProfit());
            await act(async () => {
                await result.current.setTakeProfit(1, 3000);
            });
            expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'setTakeProfit' }));
        });
    });

    describe('useSetTrailingStop', () => {
        it('calls setTrailingStop', async () => {
            const mockWrite = vi.fn();
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite });
            const { result } = renderHook(() => useSetTrailingStop());
            await act(async () => {
                await result.current.setTrailingStop(1, 100);
            });
            expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'setTrailingStop' }));
        });
    });

    describe('usePartialClose', () => {
        it('calls partialClose', async () => {
            const mockWrite = vi.fn();
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite });
            const { result } = renderHook(() => usePartialClose());
            await act(async () => {
                await result.current.partialClose(1, 50);
            });
            expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'partialClose' }));
        });
    });

    describe('useCancelOrder', () => {
        it('calls cancelOrder', async () => {
            const mockWrite = vi.fn();
            (useWriteContract as any).mockReturnValue({ writeContractAsync: mockWrite });
            const { result } = renderHook(() => useCancelOrder());
            await act(async () => {
                await result.current.cancelOrder(1);
            });
            expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'cancelOrder' }));
        });
    });

    describe('calculatePnL', () => {
        it('calculates long pnl', () => {
            const p = { size: 1, entryPrice: 100, margin: 10, isLong: true };
            const { pnl, pnlPercent } = calculatePnL(p, 110);
            expect(pnl).toBe(10);
            expect(pnlPercent).toBe(100);
        });
    });
});
