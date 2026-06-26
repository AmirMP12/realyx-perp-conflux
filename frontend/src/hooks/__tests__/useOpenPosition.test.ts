import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOpenPosition } from '../useProgram';
import { useAccount, useWriteContract, usePublicClient, useReadContract } from 'wagmi';

vi.mock('wagmi', () => ({
    useAccount: vi.fn(),
    useWriteContract: vi.fn(),
    usePublicClient: vi.fn(),
    useReadContract: vi.fn(),
}));

vi.mock('../useSound', () => ({ useSound: () => ({ playSuccess: vi.fn(), playError: vi.fn() }) }));

vi.mock('../../contracts', () => ({
    TRADING_CORE_ADDRESS: '0xCore',
    VAULT_CORE_ADDRESS: '0xVault',
    ORACLE_AGGREGATOR_ADDRESS: '0xOracle',
    POSITION_TOKEN_ADDRESS: '0xPos',
    MOCK_USDT0_ADDRESS: '0xUSDT0',
    TRADING_CORE_ABI: [],
    ORACLE_ABI: [],
    VAULT_ABI: [],
    COLLATERAL_REGISTRY_ADDRESS: '0xRegistry',
    COLLATERAL_REGISTRY_ABI: [],
}));

const E6 = 10n ** 6n;

function makeReadContract(overrides: Record<string, any> = {}) {
    const defaults: Record<string, any> = {
        getMarketInfo: { isListed: true, isActive: true },
        oracleAggregator: '0xOracleAgg',
        usdc: '0xUSDC',
        isActionAllowed: true,
        balanceOf: 1_000_000n * E6,
        allowance: (2n ** 256n) - 1n,
        minExecutionFee: 0n,
        decimals: 18,
        getTokenAmountForUsdc: 1000n,
        symbol: 'TKN',
    };
    return vi.fn(({ functionName }: any) => {
        const key = functionName as string;
        const val = key in overrides ? overrides[key] : defaults[key];
        return Promise.resolve(val);
    });
}

describe('useOpenPosition.executePosition', () => {
    let writeContractAsync: ReturnType<typeof vi.fn>;
    let publicClient: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser', chainId: 1 });
        writeContractAsync = vi.fn().mockResolvedValue('0xhash');
        (useWriteContract as any).mockReturnValue({ writeContractAsync, isPending: false });
        (useReadContract as any).mockReturnValue({ data: undefined, refetch: vi.fn().mockResolvedValue({ data: undefined }) });
        publicClient = {
            readContract: makeReadContract(),
            getCode: vi.fn().mockResolvedValue('0x'),
            waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
        };
        (usePublicClient as any).mockReturnValue(publicClient);
    });

    const baseParams = { market: '0xMarket', size: '1000', leverage: '10', isLong: true };

    async function run(params: any) {
        const { result } = renderHook(() => useOpenPosition());
        let ok: any;
        await act(async () => { ok = await result.current.executePosition(params); });
        return ok;
    }

    it('returns false when wallet not connected', async () => {
        (useAccount as any).mockReturnValue({ address: undefined, chainId: 1 });
        expect(await run(baseParams)).toBe(false);
    });

    it('returns false when no public client', async () => {
        (usePublicClient as any).mockReturnValue(undefined);
        expect(await run(baseParams)).toBe(false);
    });

    it('rejects a limit order without a trigger price', async () => {
        expect(await run({ ...baseParams, orderType: 2 })).toBe(false);
    });

    it('rejects an unlisted market', async () => {
        publicClient.readContract = makeReadContract({ getMarketInfo: { isListed: false, isActive: false } });
        expect(await run(baseParams)).toBe(false);
    });

    it('rejects a paused market', async () => {
        publicClient.readContract = makeReadContract({ getMarketInfo: { isListed: true, isActive: false } });
        expect(await run(baseParams)).toBe(false);
    });

    it('rejects smart-contract wallets', async () => {
        publicClient.getCode = vi.fn().mockResolvedValue('0xabcdef');
        expect(await run(baseParams)).toBe(false);
    });

    it('rejects when circuit breaker blocks the action', async () => {
        publicClient.readContract = makeReadContract({ isActionAllowed: false });
        expect(await run(baseParams)).toBe(false);
    });

    it('rejects when USDC balance is insufficient', async () => {
        publicClient.readContract = makeReadContract({ balanceOf: 0n });
        expect(await run(baseParams)).toBe(false);
    });

    it('submits a USDC order with sufficient allowance (no approve)', async () => {
        const ok = await run(baseParams);
        expect(ok).toBe(true);
        const fns = writeContractAsync.mock.calls.map((c) => c[0].functionName);
        expect(fns).not.toContain('approve');
        expect(fns).toContain('createOrder');
    });

    it('approves then submits when allowance is insufficient', async () => {
        publicClient.readContract = makeReadContract({ allowance: 0n });
        const ok = await run(baseParams);
        expect(ok).toBe(true);
        const fns = writeContractAsync.mock.calls.map((c) => c[0].functionName);
        expect(fns).toContain('approve');
        expect(fns).toContain('createOrder');
    });

    it('submits a limit order with a trigger price', async () => {
        const ok = await run({ ...baseParams, orderType: 2, triggerPrice: '2500.5' });
        expect(ok).toBe(true);
    });

    it('validates stop-loss direction for longs', async () => {
        const ok = await run({ ...baseParams, expectedPrice: 2000, stopLossTrigger: '2100' });
        expect(ok).toBe(false); // SL above entry for a long is invalid
    });

    it('validates take-profit direction for longs', async () => {
        const ok = await run({ ...baseParams, expectedPrice: 2000, takeProfitTrigger: '1900' });
        expect(ok).toBe(false); // TP below entry for a long is invalid
    });

    it('accepts a valid bracket order', async () => {
        const ok = await run({ ...baseParams, expectedPrice: 2000, stopLossTrigger: '1900', takeProfitTrigger: '2100' });
        expect(ok).toBe(true);
    });

    it('handles the alt-collateral path with approval', async () => {
        publicClient.readContract = makeReadContract({
            decimals: 18,
            getTokenAmountForUsdc: 500n,
            balanceOf: 1000n, // token balance sufficient
            allowance: 0n, // token allowance insufficient -> approve
        });
        const ok = await run({ ...baseParams, collateralToken: '0xToken' });
        expect(ok).toBe(true);
        const fns = writeContractAsync.mock.calls.map((c) => c[0].functionName);
        expect(fns).toContain('approve');
    });

    it('rejects alt-collateral when token balance is insufficient', async () => {
        publicClient.readContract = makeReadContract({
            getTokenAmountForUsdc: 10_000n,
            balanceOf: 1n,
        });
        const ok = await run({ ...baseParams, collateralToken: '0xToken' });
        expect(ok).toBe(false);
    });
});
