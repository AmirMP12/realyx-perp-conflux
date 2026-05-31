import { useMemo } from 'react';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { formatUnits, type Address } from 'viem';
import {
    COLLATERAL_REGISTRY_ADDRESS,
    COLLATERAL_REGISTRY_ABI,
    MULTI_COLLATERAL_ORDERS_ENABLED,
} from '../contracts';
import { useUSDC, useUSDCDecimals } from './useProgram';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

const ERC20_META_ABI = [
    { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
    { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
    { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
] as const;

/** On-chain CollateralRegistry per-token config (mirrors `CollateralRegistry.CollateralConfig`). */
export interface CollateralConfig {
    enabled: boolean;
    baseHaircutBps: number;
    liquidationHaircutBps: number;
    maxHaircutBps: number;
    utilizationSlopeBps: number;
    volatilityAdderBps: number;
    maxProtocolExposure: bigint;
    oracleFeed: Address;
    decimals: number;
}

/** A collateral asset the protocol can accept, enriched with the connected user's balance. */
export interface CollateralAsset {
    /** Token address. `0x000…000` represents canonical USDC settlement. */
    address: Address;
    symbol: string;
    decimals: number;
    /** True for the canonical USDC settlement asset (never haircut, always accepted). */
    isUSDC: boolean;
    enabled: boolean;
    /** Standard (non-liquidation) haircut in basis points. USDC = 0. */
    baseHaircutBps: number;
    liquidationHaircutBps: number;
    maxHaircutBps: number;
    /** Protocol-wide exposure cap in USDC (6 decimals). 0n = uncapped. */
    maxProtocolExposure: bigint;
    /** Raw protocol-wide deposited amount (token decimals). */
    totalDeposited: bigint;
    /** USDC-equivalent of all protocol deposits of this token (6 decimals), post-haircut. */
    exposureUsdc: bigint;
    /** Connected user's raw wallet balance (token decimals). */
    balance: bigint;
    /** Connected user's balance as a human number. */
    balanceFormatted: number;
    /** USDC-equivalent of the user's balance (6 decimals), post-haircut. */
    effectiveUsdc: bigint;
    /** USDC-equivalent of the user's balance as a human number. */
    effectiveUsdcFormatted: number;
    /** Fraction (0–1) of the protocol exposure cap currently used. null when uncapped. */
    exposureUtilization: number | null;
}

const USDC_PLACEHOLDER: Omit<CollateralAsset, 'balance' | 'balanceFormatted' | 'effectiveUsdc' | 'effectiveUsdcFormatted'> = {
    address: ZERO_ADDRESS,
    symbol: 'USDC',
    decimals: 6,
    isUSDC: true,
    enabled: true,
    baseHaircutBps: 0,
    liquidationHaircutBps: 0,
    maxHaircutBps: 0,
    maxProtocolExposure: 0n,
    totalDeposited: 0n,
    exposureUsdc: 0n,
    exposureUtilization: null,
};

function num(v: unknown, fallback = 0): number {
    return typeof v === 'number' ? v : v == null ? fallback : Number(v);
}

/**
 * Reads the deployed `CollateralRegistry` and returns the full set of collateral
 * assets the protocol supports, each enriched with the connected wallet's balance
 * and the post-haircut USDC value.
 *
 * USDC is always present as the canonical settlement asset (address `0x0`, no haircut).
 * Alt collateral entries come straight from `getRegisteredTokens()`.
 */
export function useCollateralAssets() {
    const { address: user } = useAccount();
    const { address: usdcAddress } = useUSDC();
    const { decimals: usdcDecimals } = useUSDCDecimals();

    const registryConfigured = COLLATERAL_REGISTRY_ADDRESS !== ZERO_ADDRESS;

    // 1. Registered token list (single read).
    const { data: registeredRaw, isLoading: tokensLoading, refetch: refetchTokens } = useReadContract({
        address: COLLATERAL_REGISTRY_ADDRESS,
        abi: COLLATERAL_REGISTRY_ABI,
        functionName: 'getRegisteredTokens',
        query: { enabled: registryConfigured, refetchInterval: 60_000 },
    });

    const registeredTokens = useMemo(
        () => ((registeredRaw as Address[] | undefined) ?? []).filter((t) => t && t !== ZERO_ADDRESS),
        [registeredRaw],
    );

    // 2. Per-token base data: config, symbol, decimals, user balance, protocol total.
    const baseContracts = useMemo(() => {
        const calls: any[] = [];
        for (const token of registeredTokens) {
            calls.push({ address: COLLATERAL_REGISTRY_ADDRESS, abi: COLLATERAL_REGISTRY_ABI, functionName: 'getCollateralConfig', args: [token] });
            calls.push({ address: COLLATERAL_REGISTRY_ADDRESS, abi: COLLATERAL_REGISTRY_ABI, functionName: 'totalDeposited', args: [token] });
            calls.push({ address: token, abi: ERC20_META_ABI, functionName: 'symbol' });
            calls.push({ address: token, abi: ERC20_META_ABI, functionName: 'balanceOf', args: [user ?? ZERO_ADDRESS] });
        }
        return calls;
    }, [registeredTokens, user]);

    const { data: baseData, isLoading: baseLoading, refetch: refetchBase } = useReadContracts({
        contracts: baseContracts,
        query: { enabled: registryConfigured && registeredTokens.length > 0, refetchInterval: 30_000 },
    });

    // 3. Dependent value reads (need balances/totals from step 2).
    const valueContracts = useMemo(() => {
        if (!baseData) return [];
        const calls: any[] = [];
        registeredTokens.forEach((token, i) => {
            const total = baseData[i * 4 + 1]?.result as bigint | undefined;
            const balance = baseData[i * 4 + 3]?.result as bigint | undefined;
            // effective USDC value of the user's balance
            calls.push({
                address: COLLATERAL_REGISTRY_ADDRESS,
                abi: COLLATERAL_REGISTRY_ABI,
                functionName: 'getCollateralValue',
                args: [token, balance && balance > 0n ? balance : 0n, false],
            });
            // effective USDC value of the protocol's total exposure
            calls.push({
                address: COLLATERAL_REGISTRY_ADDRESS,
                abi: COLLATERAL_REGISTRY_ABI,
                functionName: 'getCollateralValue',
                args: [token, total && total > 0n ? total : 0n, false],
            });
        });
        return calls;
    }, [baseData, registeredTokens]);

    const { data: valueData, refetch: refetchValues } = useReadContracts({
        contracts: valueContracts,
        // getCollateralValue reverts on a zero/dust amount; tolerate per-call failures.
        allowFailure: true,
        query: { enabled: registryConfigured && valueContracts.length > 0 },
    });

    const usdc: CollateralAsset = useMemo(() => ({
        ...USDC_PLACEHOLDER,
        address: ZERO_ADDRESS,
        symbol: 'USDC',
        decimals: usdcDecimals,
        balance: 0n,
        balanceFormatted: 0,
        effectiveUsdc: 0n,
        effectiveUsdcFormatted: 0,
    }), [usdcDecimals]);

    const altAssets: CollateralAsset[] = useMemo(() => {
        if (!baseData) return [];
        return registeredTokens.map((token, i) => {
            const cfgRaw = baseData[i * 4]?.result as CollateralConfig | undefined;
            const totalDeposited = (baseData[i * 4 + 1]?.result as bigint | undefined) ?? 0n;
            const symbol = (baseData[i * 4 + 2]?.result as string | undefined) ?? `${token.slice(0, 6)}…`;
            const balance = (baseData[i * 4 + 3]?.result as bigint | undefined) ?? 0n;

            const decimals = num(cfgRaw?.decimals, 18);
            const maxProtocolExposure = cfgRaw?.maxProtocolExposure ?? 0n;

            const effRes = valueData?.[i * 2];
            const expRes = valueData?.[i * 2 + 1];
            const effectiveUsdc = effRes?.status === 'success' ? (effRes.result as bigint) : 0n;
            const exposureUsdc = expRes?.status === 'success' ? (expRes.result as bigint) : 0n;

            const exposureUtilization =
                maxProtocolExposure > 0n
                    ? Math.min(1, Number(formatUnits(exposureUsdc, usdcDecimals)) / Number(formatUnits(maxProtocolExposure, usdcDecimals)))
                    : null;

            return {
                address: token,
                symbol,
                decimals,
                isUSDC: false,
                enabled: Boolean(cfgRaw?.enabled),
                baseHaircutBps: num(cfgRaw?.baseHaircutBps),
                liquidationHaircutBps: num(cfgRaw?.liquidationHaircutBps),
                maxHaircutBps: num(cfgRaw?.maxHaircutBps),
                maxProtocolExposure,
                totalDeposited,
                exposureUsdc,
                balance,
                balanceFormatted: Number(formatUnits(balance, decimals)),
                effectiveUsdc,
                effectiveUsdcFormatted: Number(formatUnits(effectiveUsdc, usdcDecimals)),
                exposureUtilization,
            } satisfies CollateralAsset;
        });
    }, [baseData, valueData, registeredTokens, usdcDecimals]);

    const assets = useMemo(() => [usdc, ...altAssets], [usdc, altAssets]);

    const refetch = () => {
        void refetchTokens();
        void refetchBase();
        void refetchValues();
    };

    return {
        /** Canonical USDC settlement asset (always first). */
        usdc,
        /** Registered non-USDC collateral tokens. */
        altAssets,
        /** USDC followed by every registered alt collateral. */
        assets,
        /** Registry address actually exists in env/deployment. */
        registryConfigured,
        /** Registry is configured AND has at least one registered alt token. */
        hasAltCollateral: altAssets.length > 0,
        /** The deployed TradingCore accepts alt collateral on `createOrder`. */
        ordersEnabled: MULTI_COLLATERAL_ORDERS_ENABLED,
        usdcAddress,
        loading: tokensLoading || baseLoading,
        refetch,
    };
}

/** bps → percent string, e.g. 250 → "2.5%". */
export function formatHaircut(bps: number): string {
    return `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}
