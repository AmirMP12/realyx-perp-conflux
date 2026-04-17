import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useSound } from './useSound';
import { type Address, formatUnits, parseUnits } from 'viem';
import {
    TRADING_CORE_ADDRESS,
    VAULT_CORE_ADDRESS,
    ORACLE_AGGREGATOR_ADDRESS,
    POSITION_TOKEN_ADDRESS,
    MOCK_USDC_ADDRESS,
    TRADING_CORE_ABI,
    ORACLE_ABI,
    VAULT_ABI,
} from '../contracts';

export {
    TRADING_CORE_ADDRESS,
    VAULT_CORE_ADDRESS,
    ORACLE_AGGREGATOR_ADDRESS,
    POSITION_TOKEN_ADDRESS,
    MOCK_USDC_ADDRESS,
    TRADING_CORE_ABI,
    ORACLE_ABI,
    VAULT_ABI,
};

const ERC20_ABI = [
    { "inputs": [{ "name": "spender", "type": "address" }, { "name": "amount", "type": "uint256" }], "name": "approve", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "name": "owner", "type": "address" }, { "name": "spender", "type": "address" }], "name": "allowance", "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "decimals", "outputs": [{ "name": "", "type": "uint8" }], "stateMutability": "view", "type": "function" },
] as const;

/** Protocol fixed-point for partialClose `pct` (1e18 = 100%). */
const PRECISION_WAD = 10n ** 18n;
/** Matches `DataTypes.DECIMAL_CONVERSION` (USDC 6 → internal). */
const DECIMAL_CONVERSION = 10n ** 12n;
/** Wall-clock deadline for close txs; short values fail if the wallet confirms slowly. */
const CLOSE_TX_DEADLINE_SEC = 30 * 60;

function toPositionId(v: string | number | bigint): bigint {
    return typeof v === 'bigint' ? v : BigInt(String(v));
}

/** First 4 bytes of `keccak256("StalePrice()")` — OracleAggregator when Pyth publishTime is too old. */
const STALE_PRICE_SELECTOR = '0x19abf40e';

function revertDataHex(err: unknown): string | null {
    const walk = (x: unknown): string | null => {
        if (!x || typeof x !== 'object') return null;
        const o = x as Record<string, unknown>;
        const d = o.data;
        if (typeof d === 'string' && d.startsWith('0x')) return d.toLowerCase();
        if (o.cause) return walk(o.cause);
        return null;
    };
    return walk(err);
}

function closeTxErrorMessage(err: unknown): string {
    const data = revertDataHex(err);
    if (data?.startsWith(STALE_PRICE_SELECTOR)) {
        return 'Oracle price is stale (Pyth publish time is too old for this network). Update feeds on the oracle / run your price keeper, then retry the close.';
    }
    const raw = `${(err as { shortMessage?: string })?.shortMessage ?? ''} ${(err as Error)?.message ?? ''} ${(err as { cause?: unknown })?.cause ?? ''} ${data ?? ''}`.toLowerCase();
    if (raw.includes('staleprice') || raw.includes('stale price')) {
        return 'Oracle price is stale. Wait for a fresh Pyth update (or poke the testnet oracle), then retry.';
    }
    if (raw.includes('minpositionduration')) {
        return 'This position must stay open for a short minimum time before closing. Wait and try again.';
    }
    if (raw.includes('positiontoosmall') || raw.includes('too small')) {
        return 'After this partial close, the remaining size would be below the protocol minimum. Close a larger share or use full close.';
    }
    if (raw.includes('zeroclosesize')) {
        return 'Close amount rounds to zero on-chain. Use a higher percentage or full close.';
    }
    if (raw.includes('deadlineexpired') || raw.includes('deadline')) {
        return 'Transaction deadline passed before confirmation. Please try again.';
    }
    if (raw.includes('notpositionowner') || raw.includes('not owner')) {
        return 'You are not the owner of this position.';
    }
    if (raw.includes('positionnotfound') || data?.toLowerCase().startsWith('0x6ec9be11')) {
        return 'This position is already closed or not active. Refresh the list — closed ids can stay in your history until cleanup runs.';
    }
    if (raw.includes('flashloan')) {
        return 'Same-block safety rule: wait one block and retry.';
    }
    if (raw.includes('paused')) {
        return 'Trading is temporarily paused.';
    }
    if (raw.includes('slippage')) {
        return 'Price moved beyond the allowed bound for this close. Retry in a moment.';
    }
    if (raw.includes('insufficientliquidity')) {
        return 'Insufficient vault liquidity for this close. Try again later.';
    }
    return (err as { shortMessage?: string })?.shortMessage || (err as Error)?.message || 'Transaction failed';
}

export interface OpenPositionParams {
    market: string;
    size: string; // wei
    leverage: string;
    isLong: boolean;
    isCrossMargin: boolean;
    stopLossPrice: string;
    takeProfitPrice: string;
    trailingStopBps: string;
    expectedPrice: string;
    maxSlippageBps: string;
    deadline: string;
    collateralType: number; // 0=USDC
}

/** OrderType enum on chain: 0=MARKET_INCREASE, 1=MARKET_DECREASE, 2=LIMIT_INCREASE, 3=LIMIT_DECREASE */
export const OrderType = { MARKET_INCREASE: 0, MARKET_DECREASE: 1, LIMIT_INCREASE: 2, LIMIT_DECREASE: 3 } as const;

export function useUSDC() {
    const { data: usdcAddress } = useReadContract({
        address: TRADING_CORE_ADDRESS,
        abi: TRADING_CORE_ABI,
        functionName: 'usdc',
    });
    return { address: (usdcAddress as Address) || MOCK_USDC_ADDRESS };
}

export function useUSDCDecimals() {
    const { address: usdcAddress } = useUSDC();
    const { data: decimalsData } = useReadContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'decimals',
        query: { enabled: !!usdcAddress },
    });
    const decimals = Number(decimalsData ?? 6);
    return { decimals };
}

/** User's USDC balance (6 decimals). Requires USDC address from useUSDC. */
export function useUSDCBalance() {
    const { address: userAddress } = useAccount();
    const { address: usdcAddress } = useUSDC();
    const { decimals } = useUSDCDecimals();
    const { data: balanceWei, isLoading } = useReadContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: userAddress ? [userAddress] : undefined,
        query: { enabled: !!usdcAddress && !!userAddress, refetchInterval: 10000 },
    });
    const balance = balanceWei != null ? Number(formatUnits(balanceWei, decimals)) : 0;
    return { balance, balanceWei, loading: isLoading };
}

/** Check current allowance for TradingCore. */
export function useAllowance() {
    const { address: userAddress } = useAccount();
    const { address: usdcAddress } = useUSDC();
    const { data: allowance, refetch, isLoading } = useReadContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: userAddress ? [userAddress, TRADING_CORE_ADDRESS] : undefined,
        query: { enabled: !!usdcAddress && !!userAddress },
    });
    return { allowance: allowance as bigint | undefined, refetch, loading: isLoading };
}

/** Submit an order via TradingCore.createOrder. Execution is performed by a keeper (executeOrder). */
export function useCreateOrder() {
    const { address, chainId } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();
    const publicClient = usePublicClient();
    const { data: minExecutionFeeWei } = useReadContract({
        address: TRADING_CORE_ADDRESS,
        abi: TRADING_CORE_ABI,
        functionName: 'minExecutionFee',
    });

    const createOrder = async (params: {
        market: Address;
        sizeDelta: string; // 18 decimals (internal precision)
        collateralDelta: string;
        isLong: boolean;
        maxSlippage?: string;
        positionId?: number; // 0 for new position
        orderType?: number; // 0=MARKET_INCREASE, 1=MARKET_DECREASE, 2=LIMIT_INCREASE, 3=LIMIT_DECREASE
        triggerPriceWei?: string; // 18 decimals; required for LIMIT_*
    }) => {
        if (!address) throw new Error('Wallet not connected');
        // Use existing state if available, otherwise fetch.
        const baseFee = (minExecutionFeeWei as bigint | undefined) ?? (publicClient
            ? await publicClient.readContract({
                address: TRADING_CORE_ADDRESS,
                abi: TRADING_CORE_ABI,
                functionName: 'minExecutionFee',
            })
            : 0n) as bigint;

        // Add a small safety buffer to avoid stale minExecutionFee reverts.
        const fee = (baseFee * 110n) / 100n;

        const orderType = params.orderType ?? OrderType.MARKET_INCREASE;
        const triggerPriceWei = orderType === OrderType.LIMIT_INCREASE || orderType === OrderType.LIMIT_DECREASE
            ? BigInt(params.triggerPriceWei ?? '0')
            : 0n;

        const request = {
            chainId,
            address: TRADING_CORE_ADDRESS,
            abi: TRADING_CORE_ABI,
            functionName: 'createOrder',
            args: [
                orderType,
                params.market,
                BigInt(params.sizeDelta),
                BigInt(params.collateralDelta),
                triggerPriceWei,
                params.isLong,
                BigInt(params.maxSlippage ?? '100'),
                BigInt(params.positionId ?? 0),
            ],
            value: fee,
        } as const;

        // Preflight simulation provides clearer revert reasons before wallet signing.
        if (publicClient) {
            await publicClient.simulateContract({
                ...request,
                account: address,
            });
        }

        const orderId = await writeContractAsync(request);
        return orderId;
    };

    return { createOrder, isPending, minExecutionFeeWei };
}

export function useOpenPosition() {
    const { address: usdcAddress } = useUSDC();
    const { address, chainId } = useAccount();
    const { writeContractAsync } = useWriteContract();
    const { createOrder } = useCreateOrder();
    const publicClient = usePublicClient();
    const { allowance, refetch: refetchAllowance } = useAllowance();

    const [isLoading, setIsLoading] = useState(false);
    const [step, setStep] = useState<'IDLE' | 'APPROVING' | 'COMMITTING' | 'WAITING' | 'REVEALING'>('IDLE');

    const decodeCreateOrderRevert = (err: any): string | null => {
        const known: Record<string, string> = {
            '0xc8561601': 'Execution fee is too low. Please retry in a few seconds.',
            '0x6b59e4ed': 'Trading is temporarily blocked by risk circuit breaker for this market.',
            '0x3a23d825': 'Insufficient collateral for this position size/leverage.',
            '0xb521771a': 'Market is currently not active.',
            '0xaf610693': 'Invalid order parameters for current market conditions.',
            '0x8199f5f3': 'Slippage exceeded. Increase slippage tolerance or retry.',
            '0xf073bef9': 'Smart-contract wallets are blocked for trading actions (FlashLoanDetected). Please use a regular EOA wallet.',
            '0xa74c1c5f': 'You are submitting actions too quickly. Wait a few seconds and retry.',
            '0xa0e1accb': 'Compliance check failed for this market/account.',
            '0x0b5f6bf0': 'This market is currently closed.',
            '0xd0ad2225': 'Protocol health guard is active. New increase orders are temporarily disabled.',
            '0x1ab7da6b': 'Transaction deadline expired. Please retry.',
            '0xb28e83a9': 'Oracle sources are currently insufficient for this market.',
        };

        const raw = JSON.stringify(err, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
        const match = raw.match(/0x[a-fA-F0-9]{8,}/);
        if (!match) return null;
        const selector = match[0].slice(0, 10).toLowerCase();
        return known[selector] ?? null;
    };

    const mapRevertToMessage = (err: any): string => {
        const decoded = decodeCreateOrderRevert(err);
        if (decoded) return decoded;

        const text = `${err?.shortMessage ?? ''} ${err?.message ?? ''} ${err?.details ?? ''}`.toLowerCase();
        if (text.includes('executionfeetoolow')) return 'Execution fee is too low. Please retry in a few seconds.';
        if (text.includes('breakeractive')) return 'Trading is temporarily blocked by risk circuit breaker for this market.';
        if (text.includes('insufficientcollateral')) return 'Insufficient collateral for this position size/leverage.';
        if (text.includes('marketnotactive')) return 'Market is currently not active.';
        if (text.includes('transfer amount exceeds balance') || text.includes('erc20')) return 'Insufficient token balance or allowance for collateral transfer.';
        if (text.includes('the contract function "createorder" reverted')) {
            return 'Order creation reverted on-chain. Common causes: insufficient USDC/allowance, low execution fee, or market circuit breaker.';
        }
        return err?.shortMessage || err?.message || 'Failed to submit order';
    };

    const executePosition = async (
        params: Omit<OpenPositionParams, 'isCrossMargin' | 'collateralType' | 'deadline' | 'expectedPrice' | 'maxSlippageBps' | 'stopLossPrice' | 'takeProfitPrice' | 'trailingStopBps'> & {
            maxSlippageBps?: number,
            expectedPrice?: number,
            stopLossPrice?: string,
            takeProfitPrice?: string,
            trailingStopBps?: string,
            orderType?: number,
            triggerPrice?: string, // decimal string, e.g. "2500.50"
        }
    ) => {
        setIsLoading(true);
        setStep('IDLE');
        try {
            if (!address) throw new Error("Wallet not connected");
            if (!publicClient) throw new Error("Public client not available");

            const orderType = params.orderType ?? OrderType.MARKET_INCREASE;
            const isLimit = orderType === OrderType.LIMIT_INCREASE || orderType === OrderType.LIMIT_DECREASE;
            const triggerPriceStr = params.triggerPrice?.trim();
            if (isLimit && (!triggerPriceStr || parseFloat(triggerPriceStr) <= 0)) {
                throw new Error('Limit and stop orders require a trigger price');
            }

            // Parallelize preliminary reads to reduce latency
            const [marketInfo, accountCode, coreOracleAddress, coreUsdcAddress] = await Promise.all([
                publicClient.readContract({
                    address: TRADING_CORE_ADDRESS, abi: TRADING_CORE_ABI,
                    functionName: 'getMarketInfo', args: [params.market as Address]
                }),
                publicClient.getCode({ address }),
                publicClient.readContract({
                    address: TRADING_CORE_ADDRESS, abi: TRADING_CORE_ABI,
                    functionName: 'oracleAggregator',
                }),
                publicClient.readContract({
                    address: TRADING_CORE_ADDRESS, abi: TRADING_CORE_ABI,
                    functionName: 'usdc',
                })
            ]) as [any, string | undefined, Address, Address];

            if (!marketInfo || !marketInfo.isListed) {
                throw new Error(`Market ${params.market} is not registered in the protocol.`);
            }
            if (!marketInfo.isActive) {
                throw new Error('Market is temporarily paused. Please try again later.');
            }
            if (accountCode && accountCode !== '0x') {
                throw new Error('Smart-contract wallets are not supported for createOrder on this deployment. Please use an EOA wallet.');
            }

            // Next batch of parallel reads
            const [actionAllowed, walletUsdcBalance] = await Promise.all([
                publicClient.readContract({
                    address: coreOracleAddress, abi: ORACLE_ABI,
                    functionName: 'isActionAllowed', args: [params.market as Address, 0],
                }),
                publicClient.readContract({
                    address: coreUsdcAddress, abi: ERC20_ABI,
                    functionName: 'balanceOf', args: [address],
                })
            ]) as [boolean, bigint];

            if (!actionAllowed) {
                throw new Error('Trading is temporarily blocked by circuit breaker for this market.');
            }

            const sizeNum = parseFloat(params.size);
            const leverageNum = parseFloat(params.leverage);
            const notionalValue = sizeNum;
            const baseMargin = leverageNum > 0 ? notionalValue / leverageNum : sizeNum;
            const estimatedOpeningFee = Math.max(0.10, notionalValue * 0.0005);
            const marginUSDC = baseMargin + estimatedOpeningFee;

            const sizeDelta6 = parseUnits(sizeNum.toFixed(6), 6);
            const collateralDelta6 = parseUnits(marginUSDC.toFixed(6), 6);
            const triggerPriceWei = isLimit && triggerPriceStr ? parseUnits(triggerPriceStr, 18).toString() : undefined;

            if (walletUsdcBalance < collateralDelta6) {
                throw new Error('Insufficient USDC balance for this margin amount.');
            }

            let currentAllowance = allowance;
            if (currentAllowance === undefined) {
                const { data } = await refetchAllowance();
                currentAllowance = data as bigint | undefined;
            }

            if (!currentAllowance || currentAllowance < collateralDelta6) {
                setStep('APPROVING');
                const hash = await writeContractAsync({
                    chainId,
                    address: coreUsdcAddress,
                    abi: ERC20_ABI,
                    functionName: 'approve',
                    args: [TRADING_CORE_ADDRESS, (2n ** 256n) - 1n]
                });
                toast.loading("Waiting for approval confirmation...");
                await publicClient.waitForTransactionReceipt({ hash });
                toast.success("USDC approved successfully");
                await refetchAllowance();
            }

            setStep('REVEALING');
            await createOrder({
                market: params.market as Address,
                sizeDelta: sizeDelta6.toString(),
                collateralDelta: collateralDelta6.toString(),
                isLong: params.isLong,
                maxSlippage: String(params.maxSlippageBps ?? 300),
                positionId: 0,
                orderType,
                triggerPriceWei,
            });
            toast.success("Order submitted. A keeper will execute it shortly.");
            return true;
        } catch (err: any) {
            console.error(err);
            toast.error(mapRevertToMessage(err));
            return false;
        } finally {
            setIsLoading(false);
            setStep('IDLE');
        }
    };

    return { executePosition, isLoading, step };
}

export function useAddCollateral() {
    const { chainId } = useAccount();
    const { writeContractAsync } = useWriteContract();
    return {
        addCollateral: async (id: number, amount: number) => {
            const wei = parseUnits(amount.toFixed(6), 6);
            return writeContractAsync({
                chainId,
                address: TRADING_CORE_ADDRESS,
                abi: TRADING_CORE_ABI,
                functionName: 'addCollateral',
                args: [BigInt(id), wei, BigInt(0), false]
            });
        }
    };
}

export function useClosePosition() {
    const { chainId, address } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();
    const publicClient = usePublicClient();
    const { playSuccess, playError } = useSound();

    const closePosition = async (positionId: string | number | bigint) => {
        try {
            if (!address) {
                toast.error("Wallet not connected. Please reconnect your wallet.");
                return false;
            }
            if (!chainId) {
                toast.error("Network not detected. Please switch network and retry.");
                return false;
            }
            const id = toPositionId(positionId);
            try {
                if (publicClient) {
                    const [minDur, pos] = await Promise.all([
                        publicClient.readContract({
                            address: TRADING_CORE_ADDRESS,
                            abi: TRADING_CORE_ABI,
                            functionName: 'minPositionDuration',
                        }),
                        publicClient.readContract({
                            address: TRADING_CORE_ADDRESS,
                            abi: TRADING_CORE_ABI,
                            functionName: 'getPosition',
                            args: [id],
                        }),
                    ]);
                    if (minDur != null && pos != null && typeof pos === 'object' && 'openTimestamp' in pos) {
                        const openTs = (pos as { openTimestamp: bigint }).openTimestamp;
                        const now = BigInt(Math.floor(Date.now() / 1000));
                        const minD = BigInt(minDur as bigint);
                        if (now < openTs + minD) {
                            const wait = Number(openTs + minD - now);
                            toast.error(`Minimum open time not met. Try again in about ${Math.max(1, wait)}s.`);
                            return false;
                        }
                    }
                }
            } catch {
                /* optional preflight */
            }
            const deadline = BigInt(Math.floor(Date.now() / 1000) + CLOSE_TX_DEADLINE_SEC);
            const params = {
                positionId: id,
                closeSize: 0n,
                minReceive: 0n,
                deadline,
            };
            await writeContractAsync({
                chainId,
                address: TRADING_CORE_ADDRESS,
                abi: TRADING_CORE_ABI,
                functionName: 'closePosition',
                args: [params] as any
            });
            playSuccess();
            toast.success("Position closed!");
            return true;
        } catch (e: any) {
            playError();
            console.error(e);
            const msg = `${e?.shortMessage ?? ""} ${e?.message ?? ""}`.toLowerCase();
            if (msg.includes("not been authorized") || msg.includes("unauthorized") || e?.code === 4100) {
                toast.error("Wallet authorization failed. Reconnect wallet and approve account access, then retry.");
            } else if (e?.code === 4001 || msg.includes("user rejected")) {
                toast.error("Transaction was rejected in wallet.");
            } else {
                toast.error(closeTxErrorMessage(e));
            }
            return false;
        }
    };
    return { closePosition, loading: isPending };
}

export function useModifyMargin() {
    const { chainId, address } = useAccount();
    const { writeContractAsync } = useWriteContract();
    const { address: usdcAddress } = useUSDC();
    const publicClient = usePublicClient();
    const { allowance, refetch: refetchAllowance } = useAllowance();
    const [isPending, setIsPending] = useState(false);

    const modifyMargin = async (id: any, delta: number) => {
        setIsPending(true);
        const amountWei = parseUnits(Math.abs(delta).toFixed(6), 6);
        try {
            if (!address) throw new Error("Wallet not connected");
            if (!publicClient) throw new Error("Public client not available");

            if (delta > 0) {
                if (usdcAddress) {
                    let currentAllowance = allowance;
                    if (currentAllowance === undefined) {
                        const { data } = await refetchAllowance();
                        currentAllowance = data as bigint | undefined;
                    }

                    if (!currentAllowance || currentAllowance < amountWei) {
                        const hash = await writeContractAsync({
                            chainId,
                            address: usdcAddress,
                            abi: ERC20_ABI,
                            functionName: 'approve',
                            args: [TRADING_CORE_ADDRESS, amountWei]
                        });
                        toast.loading("Waiting for approval confirmation...");
                        await publicClient.waitForTransactionReceipt({ hash });
                        toast.success("USDC approved");
                        await refetchAllowance();
                    }
                }
                
                await writeContractAsync({
                    chainId,
                    address: TRADING_CORE_ADDRESS,
                    abi: TRADING_CORE_ABI,
                    functionName: 'addCollateral',
                    args: [BigInt(id), amountWei, BigInt(0), false]
                });
                toast.success("Collateral added. It will reflect shortly.");
            } else {
                await writeContractAsync({
                    chainId,
                    address: TRADING_CORE_ADDRESS,
                    abi: TRADING_CORE_ABI,
                    functionName: 'withdrawCollateral',
                    args: [BigInt(id), amountWei]
                });
                toast.success("Collateral removed");
            }
        } catch (e: any) {
            console.error(e);
            toast.error(e.shortMessage || e.message || "Modify failed");
        } finally {
            setIsPending(false);
        }
    };
    return { modifyMargin, loading: isPending };
}

/** Set stop loss price for a position. Pass 0 to clear. Price in human units (e.g. 2500.50). */
export function useSetStopLoss() {
    const { chainId } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();
    const setStopLoss = async (positionId: number, price: number) => {
        const priceWei = parseUnits(price.toFixed(18), 18);
        await writeContractAsync({
            chainId,
            address: TRADING_CORE_ADDRESS,
            abi: TRADING_CORE_ABI,
            functionName: 'setStopLoss',
            args: [BigInt(positionId), priceWei],
        });
        toast.success(price === 0 ? 'Stop loss cleared' : 'Stop loss set');
    };
    return { setStopLoss, loading: isPending };
}

/** Set take profit price for a position. Pass 0 to clear. Price in human units (e.g. 2500.50). */
export function useSetTakeProfit() {
    const { chainId } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();
    const setTakeProfit = async (positionId: number, price: number) => {
        const priceWei = parseUnits(price.toFixed(18), 18);
        await writeContractAsync({
            chainId,
            address: TRADING_CORE_ADDRESS,
            abi: TRADING_CORE_ABI,
            functionName: 'setTakeProfit',
            args: [BigInt(positionId), priceWei],
        });
        toast.success(price === 0 ? 'Take profit cleared' : 'Take profit set');
    };
    return { setTakeProfit, loading: isPending };
}

/** Set trailing stop for a position. bps = basis points (e.g. 100 = 1%). */
export function useSetTrailingStop() {
    const { chainId } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();
    const setTrailingStop = async (positionId: number, bps: number) => {
        await writeContractAsync({
            chainId,
            address: TRADING_CORE_ADDRESS,
            abi: TRADING_CORE_ABI,
            functionName: 'setTrailingStop',
            args: [BigInt(positionId), BigInt(bps)],
        });
        toast.success(`Trailing stop set to ${bps / 100}%`);
    };
    return { setTrailingStop, loading: isPending };
}

export function usePartialClose() {
    const { chainId, address } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();
    const publicClient = usePublicClient();
    const { playSuccess, playError } = useSound();

    /** `sizeRaw` = on-chain `position.size` as decimal string (avoids float % and JS bigint loss on id). */
    const partialClose = async (positionId: string | number | bigint, percent: number, sizeRaw: string) => {
        try {
            if (!address) {
                toast.error("Wallet not connected. Please reconnect your wallet.");
                return false;
            }
            if (!chainId) {
                toast.error("Network not detected. Please switch network and retry.");
                return false;
            }
            if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
                toast.error("Choose a partial close between 1% and 99%, or use full close.");
                return false;
            }
            const id = toPositionId(positionId);
            let sizeB: bigint;
            try {
                sizeB = BigInt(sizeRaw.trim());
            } catch {
                toast.error("Invalid position size. Refresh positions and try again.");
                return false;
            }
            if (sizeB <= 0n) {
                toast.error("Position has no size to close.");
                return false;
            }
            const pctB = BigInt(Math.floor(percent));
            const pctWei = (pctB * PRECISION_WAD) / 100n;
            const closeSz = (sizeB * pctWei) / PRECISION_WAD;
            if (closeSz === 0n) {
                toast.error("This % rounds to zero on-chain. Use a larger % or full close.");
                return false;
            }
            const rem = sizeB - closeSz;
            try {
                if (publicClient) {
                    const [minDur, minSizeUsdc, pos] = await Promise.all([
                        publicClient.readContract({
                            address: TRADING_CORE_ADDRESS,
                            abi: TRADING_CORE_ABI,
                            functionName: 'minPositionDuration',
                        }),
                        publicClient.readContract({
                            address: TRADING_CORE_ADDRESS,
                            abi: TRADING_CORE_ABI,
                            functionName: 'minPositionSize',
                        }),
                        publicClient.readContract({
                            address: TRADING_CORE_ADDRESS,
                            abi: TRADING_CORE_ABI,
                            functionName: 'getPosition',
                            args: [id],
                        }),
                    ]);
                    if (
                        minDur != null &&
                        minSizeUsdc != null &&
                        pos != null &&
                        typeof pos === 'object' &&
                        'openTimestamp' in pos
                    ) {
                        const openTs = (pos as { openTimestamp: bigint }).openTimestamp;
                        const now = BigInt(Math.floor(Date.now() / 1000));
                        const minD = BigInt(minDur as bigint);
                        if (now < openTs + minD) {
                            const wait = Number(openTs + minD - now);
                            toast.error(`Minimum open time not met. Try again in about ${Math.max(1, wait)}s.`);
                            return false;
                        }
                        const minInternal = BigInt(minSizeUsdc as bigint) * DECIMAL_CONVERSION;
                        if (rem > 0n && rem < minInternal) {
                            toast.error(
                                "Remaining size would be below the protocol minimum. Close a larger % or use full close."
                            );
                            return false;
                        }
                    }
                }
            } catch {
                /* optional preflight */
            }

            const deadline = BigInt(Math.floor(Date.now() / 1000) + CLOSE_TX_DEADLINE_SEC);

            await writeContractAsync({
                chainId,
                address: TRADING_CORE_ADDRESS,
                abi: TRADING_CORE_ABI,
                functionName: 'partialClose',
                args: [id, pctWei, 0n, deadline]
            });
            playSuccess();
            toast.success("Partial close submitted");
            return true;
        } catch (e: any) {
            playError();
            console.error(e);
            const msg = `${e?.shortMessage ?? ""} ${e?.message ?? ""}`.toLowerCase();
            if (msg.includes("not been authorized") || msg.includes("unauthorized") || e?.code === 4100) {
                toast.error("Wallet authorization failed. Reconnect wallet and approve account access, then retry.");
            } else if (e?.code === 4001 || msg.includes("user rejected")) {
                toast.error("Transaction was rejected in wallet.");
            } else {
                toast.error(closeTxErrorMessage(e));
            }
            return false;
        }
    };
    return { partialClose, loading: isPending };
}

export function calculatePnL(position: any, currentPrice: number) {
    if (!position) return { pnl: 0, pnlPercent: 0 };
    if (!position.entryPrice || position.entryPrice === 0) return { pnl: 0, pnlPercent: 0 };
    const diff = position.isLong ? currentPrice - position.entryPrice : position.entryPrice - currentPrice;
    const pnl = position.size * diff / position.entryPrice;
    const pnlPercent = position.margin > 0 ? (pnl / position.margin) * 100 : 0;
    return { pnl, pnlPercent };
}

/** Cancel a pending order on-chain. */
export function useCancelOrder() {
    const { chainId } = useAccount();
    const { writeContractAsync, isPending } = useWriteContract();

    const cancelOrder = async (orderId: number | bigint) => {
        try {
            await writeContractAsync({
                chainId,
                address: TRADING_CORE_ADDRESS,
                abi: TRADING_CORE_ABI,
                functionName: 'cancelOrder',
                args: [BigInt(orderId)],
            });
            toast.success('Order cancelled');
            return true;
        } catch (e: any) {
            console.error(e);
            toast.error(e.shortMessage || 'Failed to cancel order');
            return false;
        }
    };
    return { cancelOrder, loading: isPending };
}