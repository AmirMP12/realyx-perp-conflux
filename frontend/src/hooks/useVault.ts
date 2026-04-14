import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { useState } from 'react';
import toast from "react-hot-toast";
import { formatUnits, parseUnits } from 'viem';
import { VAULT_CORE_ADDRESS, VAULT_ABI, useUSDC } from './useProgram';

const ERC20_ABI = [
    { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
    { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
    { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
] as const;

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

    const { data: utilization } = useReadContract({
        address: VAULT_CORE_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'getUtilization',
        query: { refetchInterval: 10000 }
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

    const tvl = totalAssets !== undefined ? parseFloat(formatUnits(totalAssets as bigint, assetDecimals)) : 0;
    const availableLiquidity = availableLiquidityWei !== undefined ? parseFloat(formatUnits(availableLiquidityWei as bigint, assetDecimals)) : 0;
    const totalSharesNum = lpTotalShares !== undefined ? parseFloat(formatUnits(lpTotalShares as bigint, 18)) : 0;

    const sharePrice = (tvl > 0 && totalSharesNum > 0) ? tvl / totalSharesNum : 1.0;
    const userSharesNum = userShares !== undefined ? parseFloat(formatUnits(userShares as bigint, 18)) : 0;
    const userBalanceUSDC = userSharesNum * sharePrice;

    const fees = accumulatedFees !== undefined ? parseFloat(formatUnits(accumulatedFees as bigint, assetDecimals)) : 0;
    const utilRatePercent = utilization !== undefined ? Number(formatUnits(utilization as bigint, 18)) * 100 : 0;

    return {
        stats: {
            tvl,
            sharePrice,
            userBalance: userBalanceUSDC,
            userShares: userSharesNum,
            accumulatedFees: fees,
            utilizationRate: utilRatePercent,
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
        userInsuranceBalance,
        loading: isInsuranceAssetsLoading,
    };
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

    const unstake = async (shares: number) => {
        if (!address || !publicClient) {
            toast.error('Connect wallet');
            return false;
        }
        setLoading(true);
        try {
            const sharesWei = parseUnits(shares.toFixed(18), 18);
            await writeContractAsync({
                chainId,
                address: VAULT_CORE_ADDRESS,
                abi: VAULT_ABI,
                functionName: 'unstakeInsurance',
                args: [sharesWei, address],
            });
            toast.success('Insurance unstaked');
            return true;
        } catch (e: any) {
            toast.error(e?.shortMessage ?? e?.message ?? 'Unstake failed');
            return false;
        } finally {
            setLoading(false);
        }
    };
    return { unstake, loading };
}
