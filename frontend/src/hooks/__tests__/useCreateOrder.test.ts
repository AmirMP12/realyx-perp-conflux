import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCreateOrder } from '../useProgram';
import { useAccount, useWriteContract, usePublicClient, useReadContract } from 'wagmi';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), useWriteContract: vi.fn(), usePublicClient: vi.fn(), useReadContract: vi.fn() }));
vi.mock('../useSound', () => ({ useSound: () => ({ playSuccess: vi.fn(), playError: vi.fn() }) }));

const MARKET = '0xMarket';

describe('useCreateOrder', () => {
    let write: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser', chainId: 1 });
        write = vi.fn().mockResolvedValue('0xorder');
        (useWriteContract as any).mockReturnValue({ writeContractAsync: write, isPending: false });
        (usePublicClient as any).mockReturnValue({ readContract: vi.fn().mockResolvedValue(50000n) });
        (useReadContract as any).mockReturnValue({ data: 50000n });
    });

    async function call(params: any) {
        const { result } = renderHook(() => useCreateOrder());
        let r: any;
        await act(async () => { r = await result.current.createOrder(params); });
        return r;
    }

    it('throws when wallet not connected', async () => {
        (useAccount as any).mockReturnValue({ address: undefined, chainId: 1 });
        const { result } = renderHook(() => useCreateOrder());
        await expect(result.current.createOrder({ market: MARKET, sizeDelta: '1', collateralDelta: '1', isLong: true })).rejects.toThrow('Wallet not connected');
    });

    it('uses the legacy positional path for a simple market order', async () => {
        await call({ market: MARKET, sizeDelta: '1000', collateralDelta: '100', isLong: true });
        expect(Array.isArray(write.mock.calls[0][0].args)).toBe(true);
        expect(write.mock.calls[0][0].args[0]).toBe(0); // MARKET_INCREASE
    });

    it('uses the struct USDT0 path when advanced fields (SL/TP) are set', async () => {
        await call({ market: MARKET, sizeDelta: '1000', collateralDelta: '100', isLong: true, stopLossPriceWei: '90', takeProfitPriceWei: '120' });
        const arg = write.mock.calls[0][0].args[0];
        expect(arg.collateralType).toBeDefined();
        expect(arg.stopLossPrice).toBe(90n);
    });

    it('uses the struct MULTI path for alt collateral', async () => {
        await call({ market: MARKET, sizeDelta: '1000', collateralDelta: '100', isLong: false, collateralToken: '0xToken' });
        const arg = write.mock.calls[0][0].args[0];
        expect(arg.collateralToken).toBe('0xToken');
    });

    it('encodes a limit order trigger price', async () => {
        await call({ market: MARKET, sizeDelta: '1000', collateralDelta: '100', isLong: true, orderType: 2, triggerPriceWei: '2500', tif: 3 });
        const arg = write.mock.calls[0][0].args[0];
        expect(arg.triggerPrice).toBe(2500n);
        expect(arg.tif).toBe(3);
    });

    it('reads minExecutionFee from publicClient when the hook read is empty', async () => {
        (useReadContract as any).mockReturnValue({ data: undefined });
        const readContract = vi.fn().mockResolvedValue(99999n);
        (usePublicClient as any).mockReturnValue({ readContract });
        await call({ market: MARKET, sizeDelta: '1', collateralDelta: '1', isLong: true });
        expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'minExecutionFee' }));
    });

    it('defaults fee to 0 when neither read source is available', async () => {
        (useReadContract as any).mockReturnValue({ data: undefined });
        (usePublicClient as any).mockReturnValue(undefined);
        await call({ market: MARKET, sizeDelta: '1', collateralDelta: '1', isLong: true });
        expect(write.mock.calls[0][0].value).toBe(0n);
    });
});
