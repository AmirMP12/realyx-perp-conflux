import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePartialClose } from '../useProgram';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import toast from 'react-hot-toast';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), useWriteContract: vi.fn(), usePublicClient: vi.fn() }));
vi.mock('../useSound', () => ({ useSound: () => ({ playSuccess: vi.fn(), playError: vi.fn() }) }));

const E18 = 10n ** 18n;
const BIG_SIZE = (1000n * E18).toString();

function reads(overrides: Record<string, any> = {}) {
    const past = BigInt(Math.floor(Date.now() / 1000) - 100000);
    const defaults: Record<string, any> = {
        minPositionDuration: 0n,
        minPositionSize: 0n,
        getPosition: { openTimestamp: past },
    };
    return vi.fn(({ functionName }: any) => Promise.resolve(functionName in overrides ? overrides[functionName] : defaults[functionName]));
}

describe('usePartialClose preflight', () => {
    let write: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser', chainId: 1 });
        write = vi.fn().mockResolvedValue('0x');
        (useWriteContract as any).mockReturnValue({ writeContractAsync: write, isPending: false });
        (usePublicClient as any).mockReturnValue({ readContract: reads() });
    });

    async function run(percent: number, sizeRaw: string) {
        const { result } = renderHook(() => usePartialClose());
        let ok: any;
        await act(async () => { ok = await result.current.partialClose(1, percent, sizeRaw); });
        return ok;
    }

    it('rejects a non-numeric size', async () => {
        expect(await run(50, 'abc')).toBe(false);
    });

    it('rejects a zero size', async () => {
        expect(await run(50, '0')).toBe(false);
    });

    it('rejects a percentage that rounds to zero', async () => {
        expect(await run(1, '1')).toBe(false);
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('rounds to zero'));
    });

    it('blocks when minimum open time is not met', async () => {
        (usePublicClient as any).mockReturnValue({
            readContract: reads({ minPositionDuration: 100000n, getPosition: { openTimestamp: BigInt(Math.floor(Date.now() / 1000)) } }),
        });
        expect(await run(50, BIG_SIZE)).toBe(false);
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Minimum open time'));
    });

    it('blocks when remaining size is below the protocol minimum', async () => {
        (usePublicClient as any).mockReturnValue({
            readContract: reads({ minPositionSize: 10n ** 30n }),
        });
        expect(await run(50, BIG_SIZE)).toBe(false);
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('below the protocol minimum'));
    });

    it('submits a valid partial close', async () => {
        const ok = await run(50, BIG_SIZE);
        expect(ok).toBe(true);
        expect(write).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'partialClose' }));
    });

    it('returns false and maps the error when the tx reverts', async () => {
        write.mockRejectedValue({ code: 4001 });
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(await run(50, BIG_SIZE)).toBe(false);
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('rejected'));
        errSpy.mockRestore();
    });
});
