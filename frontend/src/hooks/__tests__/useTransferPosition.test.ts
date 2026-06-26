import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransferPosition } from '../useTransferPosition';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import toast from 'react-hot-toast';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), useWriteContract: vi.fn(), usePublicClient: vi.fn() }));
vi.mock('../../contracts', () => ({ POSITION_TOKEN_ADDRESS: '0xPosToken', POSITION_TOKEN_ABI: [] }));

const SELF = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

describe('useTransferPosition', () => {
    let writeContractAsync: ReturnType<typeof vi.fn>;
    let publicClient: any;
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: SELF });
        writeContractAsync = vi.fn().mockResolvedValue('0xhash');
        (useWriteContract as any).mockReturnValue({ writeContractAsync, isPending: false });
        publicClient = {
            getBytecode: vi.fn().mockResolvedValue('0x'),
            waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
        };
        (usePublicClient as any).mockReturnValue(publicClient);
    });

    async function transfer(to: string, tokenId: string) {
        const { result } = renderHook(() => useTransferPosition());
        let ok: any;
        await act(async () => { ok = await result.current.transfer(to, tokenId); });
        return ok;
    }

    it('rejects when wallet not connected', async () => {
        (useAccount as any).mockReturnValue({ address: undefined });
        expect(await transfer(OTHER, '1')).toBe(false);
    });

    it('rejects an invalid recipient address', async () => {
        expect(await transfer('not-an-address', '1')).toBe(false);
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('valid recipient'));
    });

    it('rejects transferring to your own wallet', async () => {
        expect(await transfer(SELF, '1')).toBe(false);
    });

    it('rejects a contract recipient', async () => {
        publicClient.getBytecode.mockResolvedValue('0xdeadbeef');
        expect(await transfer(OTHER, '1')).toBe(false);
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('cannot be a contract'));
    });

    it('rejects an invalid token id', async () => {
        expect(await transfer(OTHER, 'abc')).toBe(false);
    });

    it('transfers successfully to an EOA', async () => {
        expect(await transfer(OTHER, '5')).toBe(true);
        expect(writeContractAsync).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'safeTransferFrom' }));
        expect(toast.success).toHaveBeenCalledWith('Position transferred');
    });

    it('returns false when the tx reverts on-chain', async () => {
        publicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' });
        expect(await transfer(OTHER, '5')).toBe(false);
    });

    it('returns false when writeContract throws', async () => {
        writeContractAsync.mockRejectedValue({ shortMessage: 'user rejected' });
        expect(await transfer(OTHER, '5')).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('user rejected');
    });

    it('recipientHasCode returns false when getBytecode throws', async () => {
        publicClient.getBytecode.mockRejectedValue(new Error('rpc'));
        const { result } = renderHook(() => useTransferPosition());
        let has: any;
        await act(async () => { has = await result.current.recipientHasCode(OTHER as any); });
        expect(has).toBe(false);
    });
});
