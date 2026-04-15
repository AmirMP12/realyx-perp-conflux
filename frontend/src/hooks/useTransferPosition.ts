import { useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { type Address, type Hex, isAddress, getAddress } from 'viem';
import toast from 'react-hot-toast';
import { POSITION_TOKEN_ADDRESS, POSITION_TOKEN_ABI } from '../contracts';

const ZERO = '0x0000000000000000000000000000000000000000' as Address;

/**
 * Transfer the ERC721 position token (tokenId === on-chain position id).
 * TradingCore rejects contract recipients and enforces new owner exposure limits.
 */
export function useTransferPosition() {
    const { address } = useAccount();
    const publicClient = usePublicClient();
    const { writeContractAsync, isPending } = useWriteContract();

    const isConfigured = Boolean(POSITION_TOKEN_ADDRESS && POSITION_TOKEN_ADDRESS !== ZERO);

    const recipientHasCode = useCallback(
        async (to: Address): Promise<boolean> => {
            if (!publicClient) return false;
            try {
                const code = await publicClient.getBytecode({ address: to });
                return Boolean(code && code !== '0x');
            } catch {
                return false;
            }
        },
        [publicClient],
    );

    const transfer = useCallback(
        async (toInput: string, tokenId: string): Promise<boolean> => {
            if (!address) {
                toast.error('Connect your wallet.');
                return false;
            }
            if (!isConfigured) {
                toast.error('Position token is not configured (VITE_POSITION_TOKEN_ADDRESS).');
                return false;
            }
            const trimmed = toInput.trim();
            if (!trimmed || !isAddress(trimmed)) {
                toast.error('Enter a valid recipient address.');
                return false;
            }
            let to: Address;
            try {
                to = getAddress(trimmed);
            } catch {
                toast.error('Invalid address checksum.');
                return false;
            }
            if (to.toLowerCase() === address.toLowerCase()) {
                toast.error('Recipient must be a different wallet.');
                return false;
            }
            if (await recipientHasCode(to)) {
                toast.error('Recipient cannot be a contract (protocol only allows EOAs).');
                return false;
            }
            let tid: bigint;
            try {
                tid = BigInt(tokenId);
            } catch {
                toast.error('Invalid position id.');
                return false;
            }
            try {
                /** Use 4-arg overload so viem/wagmi does not collide with the 3-arg `safeTransferFrom`. */
                const hash = await writeContractAsync({
                    address: POSITION_TOKEN_ADDRESS,
                    abi: POSITION_TOKEN_ABI,
                    functionName: 'safeTransferFrom',
                    args: [address, to, tid, '0x' as Hex],
                });
                if (publicClient) {
                    const receipt = await publicClient.waitForTransactionReceipt({ hash });
                    if (receipt.status !== 'success') {
                        toast.error('Transfer transaction reverted.');
                        return false;
                    }
                }
                toast.success('Position transferred');
                return true;
            } catch (e: unknown) {
                const err = e as { shortMessage?: string; message?: string };
                const msg = err?.shortMessage || err?.message || 'Transfer failed';
                toast.error(String(msg).slice(0, 220));
                return false;
            }
        },
        [address, isConfigured, publicClient, recipientHasCode, writeContractAsync],
    );

    return { transfer, loading: isPending, isConfigured, recipientHasCode };
}
