import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOpenPosition } from '../useProgram';
import { useAccount, useWriteContract, usePublicClient, useReadContract } from 'wagmi';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), useWriteContract: vi.fn(), usePublicClient: vi.fn(), useReadContract: vi.fn() }));
vi.mock('../useSound', () => ({ useSound: () => ({ playSuccess: vi.fn(), playError: vi.fn() }) }));
vi.mock('../../contracts', () => ({
    TRADING_CORE_ADDRESS: '0xCore', VAULT_CORE_ADDRESS: '0xVault', ORACLE_AGGREGATOR_ADDRESS: '0xOracle',
    POSITION_TOKEN_ADDRESS: '0xPos', MOCK_USDT0_ADDRESS: '0xUSDT0', TRADING_CORE_ABI: [], ORACLE_ABI: [], VAULT_ABI: [],
    COLLATERAL_REGISTRY_ADDRESS: '0xRegistry', COLLATERAL_REGISTRY_ABI: [],
}));

const E6 = 10n ** 6n;

function reads(overrides: Record<string, any> = {}) {
    const d: Record<string, any> = {
        getMarketInfo: { isListed: true, isActive: true }, oracleAggregator: '0xOracleAgg', usdc: '0xUSDC',
        isActionAllowed: true, balanceOf: 1_000_000n * E6, allowance: (2n ** 256n) - 1n, minExecutionFee: 0n,
    };
    return vi.fn(({ functionName }: any) => Promise.resolve(functionName in overrides ? overrides[functionName] : d[functionName]));
}

describe('useOpenPosition bracket validation', () => {
    let write: ReturnType<typeof vi.fn>;
    let publicClient: any;
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser', chainId: 1 });
        write = vi.fn().mockResolvedValue('0x');
        (useWriteContract as any).mockReturnValue({ writeContractAsync: write, isPending: false });
        (useReadContract as any).mockReturnValue({ data: undefined, refetch: vi.fn().mockResolvedValue({ data: undefined }) });
        publicClient = { readContract: reads(), getCode: vi.fn().mockResolvedValue('0x'), waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }) };
        (usePublicClient as any).mockReturnValue(publicClient);
    });

    const base = { market: '0xMarket', size: '1000', leverage: '10', isLong: false };

    async function run(params: any) {
        const { result } = renderHook(() => useOpenPosition());
        let ok: any;
        await act(async () => { ok = await result.current.executePosition(params); });
        return ok;
    }

    it('rejects a short stop-loss below entry', async () => {
        expect(await run({ ...base, expectedPrice: 2000, stopLossTrigger: '1900' })).toBe(false);
    });

    it('rejects a short take-profit above entry', async () => {
        expect(await run({ ...base, expectedPrice: 2000, takeProfitTrigger: '2100' })).toBe(false);
    });

    it('accepts a valid short bracket (TP below, SL above)', async () => {
        expect(await run({ ...base, expectedPrice: 2000, takeProfitTrigger: '1900', stopLossTrigger: '2100' })).toBe(true);
    });

    it('sets bracket prices without validation when no expected price is given', async () => {
        expect(await run({ ...base, stopLossTrigger: '1900', takeProfitTrigger: '2100' })).toBe(true);
    });

    it('rejects a limit order without a trigger price', async () => {
        expect(await run({ ...base, orderType: 2 })).toBe(false);
    });
});
