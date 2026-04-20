
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransferPosition } from '../useTransferPosition';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import toast from 'react-hot-toast';

vi.mock('wagmi', () => ({
    useAccount: vi.fn(),
    usePublicClient: vi.fn(),
    useWriteContract: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
    default: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

vi.mock('../contracts', () => ({
    POSITION_TOKEN_ADDRESS: '0xNFT',
    POSITION_TOKEN_ABI: [],
}));

describe('useTransferPosition', () => {
    const mockWriteContractAsync = vi.fn();
    const mockPublicClient = {
        getBytecode: vi.fn(),
        waitForTransactionReceipt: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0x0000000000000000000000000000000000000123' });
        (usePublicClient as any).mockReturnValue(mockPublicClient);
        (useWriteContract as any).mockReturnValue({
            writeContractAsync: mockWriteContractAsync,
            isPending: false,
        });
    });

    it('fails if wallet is not connected', async () => {
        (useAccount as any).mockReturnValue({ address: null });
        const { result } = renderHook(() => useTransferPosition());
        const success = await result.current.transfer('0x0000000000000000000000000000000000000001', '1');
        expect(success).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Connect your wallet.');
    });

    it('validates recipient address', async () => {
        const { result } = renderHook(() => useTransferPosition());
        const success = await result.current.transfer('invalid-address', '1');
        expect(success).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Enter a valid recipient address.');
    });

    it('fails if recipient is the user', async () => {
        const { result } = renderHook(() => useTransferPosition());
        const success = await result.current.transfer('0x0000000000000000000000000000000000000123', '1');
        expect(success).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Recipient must be a different wallet.');
    });

    it('fails if recipient is a contract', async () => {
        mockPublicClient.getBytecode.mockResolvedValue('0x1234');
        const { result } = renderHook(() => useTransferPosition());
        const success = await result.current.transfer('0x0000000000000000000000000000000000000001', '1');
        expect(success).toBe(false);
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('cannot be a contract'));
    });

    it('handles bytecode fetch error', async () => {
        mockPublicClient.getBytecode.mockRejectedValue(new Error('RPC Error'));
        const { result } = renderHook(() => useTransferPosition());
        const hasCode = await result.current.recipientHasCode('0xRecipient' as any);
        expect(hasCode).toBe(false); // Catch block returns false
    });

    it('fails on invalid tokenId', async () => {
        mockPublicClient.getBytecode.mockResolvedValue('0x');
        const { result } = renderHook(() => useTransferPosition());
        const success = await result.current.transfer('0x0000000000000000000000000000000000000001', 'abc');
        expect(success).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Invalid position id.');
    });

    it('successfully transfers position', async () => {
        mockPublicClient.getBytecode.mockResolvedValue('0x');
        mockWriteContractAsync.mockResolvedValue('0xHash');
        mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

        const { result } = renderHook(() => useTransferPosition());
        
        let success;
        await act(async () => {
            success = await result.current.transfer('0x0000000000000000000000000000000000000001', '1');
        });

        expect(success).toBe(true);
        expect(mockWriteContractAsync).toHaveBeenCalledWith(expect.objectContaining({
            functionName: 'safeTransferFrom',
            args: expect.arrayContaining(['0x0000000000000000000000000000000000000123', '0x0000000000000000000000000000000000000001', 1n]),
        }));
        expect(toast.success).toHaveBeenCalledWith('Position transferred');
    });

    it('handles transaction revert', async () => {
        mockPublicClient.getBytecode.mockResolvedValue('0x');
        mockWriteContractAsync.mockResolvedValue('0xHash');
        mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' });

        const { result } = renderHook(() => useTransferPosition());
        const success = await result.current.transfer('0x0000000000000000000000000000000000000001', '1');
        
        expect(success).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Transfer transaction reverted.');
    });

    it('handles generic transfer error', async () => {
        mockPublicClient.getBytecode.mockResolvedValue('0x');
        mockWriteContractAsync.mockRejectedValue(new Error('User rejected'));

        const { result } = renderHook(() => useTransferPosition());
        const success = await result.current.transfer('0x0000000000000000000000000000000000000001', '1');
        
        expect(success).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('User rejected');
    });
});
