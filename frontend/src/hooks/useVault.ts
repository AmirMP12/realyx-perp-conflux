import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from "react-hot-toast";
import { formatUnits, parseAbiItem, parseUnits, type Log } from 'viem';
import { useQuery } from '@tanstack/react-query';
import { VAULT_CORE_ADDRESS, VAULT_ABI, useUSDC } from './useProgram';

const ERC20_ABI = [
    { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
    { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
    { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
] as const;

const UNSTAKE_REQUESTED = parseAbiItem('event UnstakeRequested(address indexed user, uint256 timestamp)');
const INSURANCE_UNSTAKED = parseAbiItem('event InsuranceUnstaked(address indexed user, uint256 assets, uint256 shares)');

function compareLogOrder(a: Log, b: Log): number {
    const ba = BigInt(a.blockNumber ?? 0);
    const bb = BigInt(b.blockNumber ?? 0);
    if (ba > bb) return 1;
    if (ba < bb) return -1;
    const ia = Number(a.logIndex ?? 0);
    const ib = Number(b.logIndex ?? 0);
    if (ia > ib) return 1;
    if (ia < ib) return -1;
    return 0;
}

function pickLatestLog(logs: Log[]): Log | undefined {
    if (logs.length === 0) return undefined;
    return logs.reduce((best, cur) => (compareLogOrder(cur, best) > 0 ? cur : best));
}

function messageForUnstakeRevert(err: unknown): string | undefined {
    const walk = (x: unknown): string | undefined => {
        if (!x || typeof x !== 'object') return undefined;
        const o = x as { data?: unknown; cause?: unknown };
        const d = o.data;
        if (typeof d === 'string' && d.startsWith('0x') && d.length >= 10) {
            const sel = d.slice(0, 10).toLowerCase();
            const map: Record<string, string> = {
                '0x30c6feeb': 'Start the unstake timer first (use “Begin unstake waiting period”).',
                '0x88dd9788': 'The unstake waiting period is not over yet.',
                '0x39996567': 'Not enough insurance shares for this amount.',
                '0xfe7cb88a': 'This unstake would leave the pool below the minimum health ratio.',
                '0x32d971dc': 'Invalid amount.',
            };
            if (map[sel]) return map[sel];
        }
        return walk(o.cause);
    };
    return walk(err);
}

function useVaultAssetDecimals() {
    const { data: vaultAssetAddress } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'asset',
    });
    const { data: decimalsData } = useReadContract({
        address: vaultAssetAddress as `0x${string}` | undefined,
        abi: ERC20_ABI,
        functionName: 'decimals',
        query: { enabled: !!vaultAssetAddress },
    });
    return Number(decimalsData ?? 6);
}

export function useVaultDeposit() {
    const { address, chainId } = useAccount();
    const { writeContractAsync } = useWriteContract();
    const { address: usdcAddress } = useUSDC();
    const assetDecimals = useVaultAssetDecimals();
    const [loading, setLoading] = useState(false);

    const deposit = async (amount: number) => {
        if (!address) {
            toast.error("Connect wallet");
            return false;
        }
        if (!usdcAddress) {
            toast.error("USDC address not found");
            return false;
        }
        setLoading(true);
        try {
            const wei = parseUnits(amount.toFixed(assetDecimals), assetDecimals);
            await writeContractAsync({
                chainId,
                address: usdcAddress,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [VAULT_CORE_ADDRESS, (2n ** 256n) - 1n],
            });
            await writeContractAsync({
                chainId,
                address: VAULT_CORE_ADDRESS,
                abi: VAULT_ABI,
                functionName: 'deposit',
                args: [wei, address],
            });
            toast.success("Deposit successful");
            return true;
        } catch (e: any) {
            console.error(e);
            toast.error(e?.shortMessage ?? e?.message ?? "Deposit failed");
            return false;
        } finally {
            setLoading(false);
        }
    };
    return { deposit, loading };
}

export function useVaultWithdraw() {
    const { address, chainId } = useAccount();
    const { writeContractAsync } = useWriteContract();
    const publicClient = usePublicClient();
    const assetDecimals = useVaultAssetDecimals();
    const [loading, setLoading] = useState(false);

    const withdraw = async (amountUSDC: number) => {
        if (!address || !publicClient) {
            toast.error("Connect wallet");
            return false;
        }
        setLoading(true);
        try {
            const assetsWei = parseUnits(amountUSDC.toFixed(assetDecimals), assetDecimals);

            const shares = await publicClient.readContract({
                address: VAULT_CORE_ADDRESS,
                abi: VAULT_ABI,
                functionName: 'convertToShares',
                args: [assetsWei]
            });

            await writeContractAsync({
                chainId,
                address: VAULT_CORE_ADDRESS,
                abi: VAULT_ABI,
                functionName: 'withdraw',
                args: [shares, address, address]
            });
            toast.success("Withdrawal successful");
            return true;
        } catch (e: any) {
            console.error(e);
            toast.error(e.message || "Withdrawal failed");
            return false;
        } finally {
            setLoading(false);
        }
    };
    return { withdraw, loading };
}

export function useVaultStats() {
    const { address } = useAccount();
    const assetDecimals = useVaultAssetDecimals();

    const { data: totalAssets, isLoading: isLoadingTotalAssets } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'totalAssets',
        query: { refetchInterval: 10000 }
    });

    const { data: assetAddress } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'asset',
    });

    const { data: lpTotalShares } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'lpTotalShares',
        query: { refetchInterval: 10000 }
    });

    const { data: userShares } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'lpBalanceOf',
        args: address ? [address] : undefined,
        query: { enabled: !!address, refetchInterval: 10000 }
    });

    const { data: accumulatedFees } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'accumulatedFees',
        query: { refetchInterval: 60000 }
    });

    const { data: availableLiquidityWei } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'getAvailableLiquidity',
        query: { refetchInterval: 10000 }
    });

    const { data: isPaused } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'paused',
        query: { refetchInterval: 10000 }
    });

    // VaultCore.totalAssets() returns internal precision (USDC * 1e12), i.e. 18 decimals.
    const tvl = totalAssets !== undefined ? parseFloat(formatUnits(totalAssets as bigint, 18)) : 0;
    const availableLiquidity = availableLiquidityWei !== undefined ? parseFloat(formatUnits(availableLiquidityWei as bigint, assetDecimals)) : 0;
    const totalSharesNum = lpTotalShares !== undefined ? parseFloat(formatUnits(lpTotalShares as bigint, 18)) : 0;

    const sharePrice = (tvl > 0 && totalSharesNum > 0) ? tvl / totalSharesNum : 1.0;
    const userSharesNum = userShares !== undefined ? parseFloat(formatUnits(userShares as bigint, 18)) : 0;
    const userBalanceUSDC = userSharesNum * sharePrice;

    const fees = accumulatedFees !== undefined ? parseFloat(formatUnits(accumulatedFees as bigint, assetDecimals)) : 0;

    return {
        stats: {
            tvl,
            sharePrice,
            userBalance: userBalanceUSDC,
            userShares: userSharesNum,
            accumulatedFees: fees,
            availableLiquidity,
            isPaused: isPaused ?? false,
            asset: assetAddress ? 'USDC' : 'USDC' // For now default to USDC, but we have the address if needed
        },
        loading: isLoadingTotalAssets
    };
}

export function useInsuranceFund() {
    const { address } = useAccount();
    const assetDecimals = useVaultAssetDecimals();

    const { data: insuranceAssetsWei, isLoading: isInsuranceAssetsLoading } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'insuranceAssets',
        query: { refetchInterval: 10000 },
    });
    const { data: healthRatioWei } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'getInsuranceHealthRatio',
        query: { refetchInterval: 10000 },
    });
    const { data: isHealthy } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'isInsuranceHealthy',
        query: { refetchInterval: 10000 },
    });
    const { data: insTotalSharesWei } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'insTotalShares',
        query: { refetchInterval: 10000 },
    });
    const { data: userInsSharesWei } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'insBalanceOf',
        args: address ? [address] : undefined,
        query: { enabled: !!address, refetchInterval: 10000 },
    });
    const { data: circuitBreakerActive } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'insuranceCircuitBreakerActive',
        query: { refetchInterval: 10000 },
    });

    const insuranceAssets = insuranceAssetsWei !== undefined ? Number(formatUnits(insuranceAssetsWei as bigint, assetDecimals)) : 0;
    const healthRatioPercent = healthRatioWei !== undefined ? Number(formatUnits(healthRatioWei as bigint, 18)) * 100 : 0;
    const insTotalShares = insTotalSharesWei !== undefined ? Number(formatUnits(insTotalSharesWei as bigint, 18)) : 0;
    const insSharePrice = insuranceAssets > 0 && insTotalShares > 0 ? insuranceAssets / insTotalShares : 1;
    const userInsShares = userInsSharesWei !== undefined ? Number(formatUnits(userInsSharesWei as bigint, 18)) : 0;
    const userInsuranceBalance = userInsShares * insSharePrice;

    return {
        insuranceAssets,
        healthRatioPercent,
        isHealthy: isHealthy ?? false,
        circuitBreakerActive: Boolean(circuitBreakerActive),
        insTotalShares,
        insSharePrice,
        userInsShares,
        userInsSharesWei: userInsSharesWei as bigint | undefined,
        userInsuranceBalance,
        loading: isInsuranceAssetsLoading,
    };
}

export type InsuranceUnstakePhase = 'loading' | 'error' | 'need_request' | 'cooldown' | 'ready';

/**
 * Insurance unstake is two-step on-chain: `requestUnstake`, wait `unstakeCooldown`, then `unstakeInsurance`.
 * Uses `unstakeRequestTime` when the vault supports it; otherwise infers from `UnstakeRequested` / `InsuranceUnstaked` logs (older deployments).
 */
export function useInsuranceUnstakeStatus() {
    const { address, chainId } = useAccount();
    const publicClient = usePublicClient();
    const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

    const {
        data: requestAtRead,
        isSuccess: readOk,
        isFetched: readFetched,
        isError: readErr,
        refetch: refetchRequestRead,
    } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'unstakeRequestTime',
        args: address ? [address] : undefined,
        query: { enabled: Boolean(address), retry: false, refetchInterval: 20_000 },
    });

    const {
        data: cooldownBn,
        isFetched: cdFetched,
        refetch: refetchCooldown,
    } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'unstakeCooldown',
        query: { refetchInterval: 60_000 },
    });

    const logsFallback = useQuery({
        queryKey: ['insurance-unstake-req-fallback', chainId, address],
        enabled: Boolean(publicClient && address && readFetched && readErr),
        queryFn: async () => {
            if (!publicClient || !address) return { requestAtBn: 0n };
            const [reqLogs, unstLogs] = await Promise.all([
                publicClient.getLogs({
                    address: VAULT_CORE_ADDRESS,
                    event: UNSTAKE_REQUESTED,
                    args: { user: address },
                    fromBlock: 0n,
                    toBlock: 'latest',
                }),
                publicClient.getLogs({
                    address: VAULT_CORE_ADDRESS,
                    event: INSURANCE_UNSTAKED,
                    args: { user: address },
                    fromBlock: 0n,
                    toBlock: 'latest',
                }),
            ]);
            const latestReq = pickLatestLog(reqLogs as Log[]);
            const latestUnst = pickLatestLog(unstLogs as Log[]);
            if (!latestReq || (latestUnst && compareLogOrder(latestUnst, latestReq) > 0)) {
                return { requestAtBn: 0n };
            }
            const ts = (latestReq as { args?: { timestamp?: bigint } }).args?.timestamp ?? 0n;
            return { requestAtBn: ts };
        },
        staleTime: 20_000,
    });

    const statusError = Boolean(readFetched && readErr && logsFallback.isFetched && logsFallback.isError);
    const effectiveRequestAtBn = readOk ? (requestAtRead as bigint) : logsFallback.data?.requestAtBn;
    const loading =
        !statusError &&
        (!address || !cdFetched || effectiveRequestAtBn === undefined || (readFetched && readErr && logsFallback.isPending));

    const phase = useMemo((): InsuranceUnstakePhase => {
        if (statusError) return 'error';
        if (loading || cooldownBn === undefined) return 'loading';
        const req = effectiveRequestAtBn ?? 0n;
        if (req === 0n) return 'need_request';
        const unlock = Number(req + (cooldownBn as bigint));
        if (nowSec < unlock) return 'cooldown';
        return 'ready';
    }, [statusError, loading, cooldownBn, effectiveRequestAtBn, nowSec]);

    const unlockAtSec =
        effectiveRequestAtBn !== undefined && cooldownBn !== undefined && effectiveRequestAtBn > 0n
            ? Number(effectiveRequestAtBn + (cooldownBn as bigint))
            : null;

    useEffect(() => {
        if (phase !== 'cooldown') return;
        const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
        return () => clearInterval(id);
    }, [phase]);

    const refetch = useCallback(() => {
        void refetchRequestRead();
        void refetchCooldown();
        void logsFallback.refetch();
    }, [refetchRequestRead, refetchCooldown, logsFallback]);

    return {
        phase,
        unlockAtSec,
        cooldownSec: cooldownBn !== undefined ? Number(cooldownBn as bigint) : null,
        refetch,
        loading,
        statusError,
    };
}

export function useRequestUnstake(onSettled?: () => void) {
    const { address, chainId } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();

    const requestUnstake = async () => {
        if (!address) {
            toast.error('Connect wallet');
            return false;
        }
        try {
            await writeContractAsync({
                chainId,
                address: VAULT_CORE_ADDRESS,
                abi: VAULT_ABI,
                functionName: 'requestUnstake',
            });
            toast.success('Unstake waiting period started');
            onSettled?.();
            return true;
        } catch (e: unknown) {
            toast.error((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? 'Request failed');
            return false;
        }
    };

    return { requestUnstake, loading: isPending };
}

export function useStakeInsurance() {
    const { address, chainId } = useAccount();
    const { writeContractAsync } = useWriteContract();
    const { address: usdcAddress } = useUSDC();
    const assetDecimals = useVaultAssetDecimals();
    const [loading, setLoading] = useState(false);

    const stake = async (amountUSDC: number) => {
        if (!address) {
            toast.error('Connect wallet');
            return false;
        }
        if (!usdcAddress) {
            toast.error('USDC address not found');
            return false;
        }
        setLoading(true);
        try {
            const wei = parseUnits(amountUSDC.toFixed(assetDecimals), assetDecimals);
            await writeContractAsync({
                chainId,
                address: usdcAddress,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [VAULT_CORE_ADDRESS, (2n ** 256n) - 1n],
            });
            await writeContractAsync({
                chainId,
                address: VAULT_CORE_ADDRESS,
                abi: VAULT_ABI,
                functionName: 'stakeInsurance',
                args: [wei, address],
            });
            toast.success('Insurance staked');
            return true;
        } catch (e: any) {
            toast.error(e?.shortMessage ?? e?.message ?? 'Stake failed');
            return false;
        } finally {
            setLoading(false);
        }
    };
    return { stake, loading };
}

export function useUnstakeInsurance() {
    const { address, chainId } = useAccount();
    const { writeContractAsync } = useWriteContract();
    const publicClient = usePublicClient();
    const [loading, setLoading] = useState(false);

    /** @param maxSharesWei optional cap from on-chain `insBalanceOf` to avoid float rounding reverts */
    const unstake = async (shares: number, maxSharesWei?: bigint) => {
        if (!address || !publicClient) {
            toast.error('Connect wallet');
            return false;
        }
        setLoading(true);
        try {
            let sharesWei = parseUnits(shares.toFixed(18), 18);
            if (maxSharesWei !== undefined && sharesWei > maxSharesWei) {
                sharesWei = maxSharesWei;
            }
            if (sharesWei === 0n) {
                toast.error('Amount too small');
                return false;
            }
            await writeContractAsync({
                chainId,
                address: VAULT_CORE_ADDRESS,
                abi: VAULT_ABI,
                functionName: 'unstakeInsurance',
                args: [sharesWei, address],
            });
            toast.success('Insurance unstaked');
            return true;
        } catch (e: unknown) {
            const hint = messageForUnstakeRevert(e);
            const base = (e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? 'Unstake failed';
            toast.error(hint ?? base);
            return false;
        } finally {
            setLoading(false);
        }
    };
    return { unstake, loading };
}
