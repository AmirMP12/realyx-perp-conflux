import { useCallback, useState } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import type { Address } from 'viem';
import toast from 'react-hot-toast';
import {
    ORACLE_ABI,
    ORACLE_AGGREGATOR_ADDRESS,
    TRADING_CORE_ADDRESS,
    TRADING_CORE_ABI,
} from '../contracts';

const HERMES_BASE = (import.meta.env.VITE_HERMES_URL as string | undefined)?.replace(/\/+$/, '') || 'https://hermes.pyth.network';
const ZERO_ORACLE = '0x0000000000000000000000000000000000000000' as Address;
const ZERO_FEED = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

const PYTH_ABI = [
    {
        name: 'getUpdateFee',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'updateData', type: 'bytes[]' }],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'updatePriceFeeds',
        type: 'function',
        stateMutability: 'payable',
        inputs: [{ name: 'updateData', type: 'bytes[]' }],
        outputs: [],
    },
] as const;

function isHexAddr(s: string): s is Address {
    return /^0x[a-fA-F0-9]{40}$/.test(s);
}

async function fetchHermesUpdateDataHex(feedIds: `0x${string}`[]): Promise<`0x${string}`[] | null> {
    if (feedIds.length === 0) return null;
    const q = feedIds.map((id) => `ids[]=${id.replace(/^0x/i, '').toLowerCase()}`).join('&');
    const url = `${HERMES_BASE}/v2/updates/price/latest?encoding=hex&${q}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Hermes ${res.status}`);
    }
    const body = (await res.json()) as { binary?: { data?: string[] } };
    const raw = body.binary?.data ?? [];
    const updates = raw.filter(Boolean).map((d) => (d.startsWith('0x') ? d : `0x${d}`)) as `0x${string}`[];
    return updates.length > 0 ? updates : null;
}

function feedIdFromOracleConfig(cfg: unknown): `0x${string}` | null {
    if (cfg == null) return null;
    if (Array.isArray(cfg)) {
        const v = cfg[0];
        if (typeof v === 'string' && v.startsWith('0x')) return v as `0x${string}`;
        return null;
    }
    if (typeof cfg === 'object' && 'feedId' in cfg) {
        const v = (cfg as { feedId?: string }).feedId;
        if (typeof v === 'string' && v.startsWith('0x')) return v as `0x${string}`;
    }
    return null;
}

/**
 * Push latest Pyth VAAs on-chain (Hermes → Pyth `updatePriceFeeds`).
 * Anyone can pay the small update fee in native gas token; fixes `StalePrice()` when feeds lag.
 */
export function usePythOnChainUpdater() {
    const { address, chainId, isConnected } = useAccount();
    const publicClient = usePublicClient();
    const { writeContractAsync, isPending: isWritePending } = useWriteContract();
    const [isPreflight, setIsPreflight] = useState(false);

    const resolveOracle = useCallback(async (): Promise<Address> => {
        if (!publicClient) throw new Error('No RPC client');
        if (ORACLE_AGGREGATOR_ADDRESS && ORACLE_AGGREGATOR_ADDRESS !== ZERO_ORACLE) {
            return ORACLE_AGGREGATOR_ADDRESS;
        }
        const o = await publicClient.readContract({
            address: TRADING_CORE_ADDRESS,
            abi: TRADING_CORE_ABI,
            functionName: 'oracleAggregator',
        });
        return o as Address;
    }, [publicClient]);

    const pushLatestForMarkets = useCallback(
        async (marketAddresses: readonly string[]): Promise<boolean> => {
            if (!isConnected || !address) {
                toast.error('Connect your wallet to update on-chain prices.');
                return false;
            }
            if (!publicClient || !chainId) {
                toast.error('Network not ready.');
                return false;
            }
            const markets = [...new Set(marketAddresses.filter(isHexAddr))];
            if (markets.length === 0) {
                return true;
            }

            setIsPreflight(true);
            try {
                const oracle = await resolveOracle();
                const [pythAddrResult, ...configs] = await Promise.all([
                    publicClient.readContract({
                        address: oracle,
                        abi: ORACLE_ABI,
                        functionName: 'pyth',
                    }),
                    ...markets.map((m) =>
                        publicClient.readContract({
                            address: oracle,
                            abi: ORACLE_ABI,
                            functionName: 'getOracleConfig',
                            args: [m],
                        })
                    ),
                ]);
                const pythAddr = pythAddrResult as Address;

                const feedSet = new Map<string, `0x${string}`>();
                configs.forEach((cfg) => {
                    const fid = feedIdFromOracleConfig(cfg);
                    if (fid && fid.toLowerCase() !== ZERO_FEED.toLowerCase()) {
                        feedSet.set(fid.toLowerCase(), fid);
                    }
                });
                const feeds = [...feedSet.values()];
                if (feeds.length === 0) {
                    toast.error('No Pyth feed configured for this market.');
                    return false;
                }

                const updateData = await fetchHermesUpdateDataHex(feeds);
                if (!updateData) {
                    toast.error('Could not fetch price update from Hermes.');
                    return false;
                }

                const fee = (await publicClient.readContract({
                    address: pythAddr,
                    abi: PYTH_ABI,
                    functionName: 'getUpdateFee',
                    args: [updateData],
                })) as bigint;

                const hash = await writeContractAsync({
                    chainId,
                    address: pythAddr,
                    abi: PYTH_ABI,
                    functionName: 'updatePriceFeeds',
                    args: [updateData],
                    value: fee,
                });
                
                const toastId = toast.loading('Waiting for price confirmation...');
                try {
                    await publicClient.waitForTransactionReceipt({ hash });
                    toast.success('On-chain Pyth prices updated.', { id: toastId });
                } catch (err) {
                    toast.error('Price update failed or timed out.', { id: toastId });
                    return false;
                }
                return true;


            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('[pyth refresh]', e);
                toast.error(msg.length > 120 ? `${msg.slice(0, 117)}…` : msg);
                return false;
            } finally {
                setIsPreflight(false);
            }
        },
        [address, chainId, isConnected, publicClient, resolveOracle, writeContractAsync],
    );

    return {
        pushLatestForMarkets,
        isPending: isPreflight || isWritePending,
    };
}
