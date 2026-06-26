import { useAccount, useReadContract } from 'wagmi';
import { TRADING_CORE_ADDRESS, TRADING_CORE_ABI } from './useProgram';

/**
 * Authoritative cross-margin account risk, read straight from
 * `TradingCore.getAccountRisk(account)` (which delegates to PortfolioRiskLib).
 *
 * This is the real number the protocol liquidates on — unlike the per-position
 * client estimate used for previewing a not-yet-opened trade. Health factor is
 * 1e18-scaled on-chain (1.0 = liquidation threshold).
 */
export interface AccountRisk {
    totalNotional: number;
    totalCollateral: number;
    maintenanceMargin: number;
    unrealizedPnL: number;
    /** Health factor where 1.0 is the liquidation threshold. Infinity = no cross positions. */
    healthFactor: number;
    crossPositionCount: number;
    liquidatable: boolean;
    /** True once at least one cross-margin position exists (snapshot is meaningful). */
    hasPositions: boolean;
    loading: boolean;
}

type RiskTuple = readonly [bigint, bigint, bigint, bigint, bigint, bigint, boolean];

function toNum(v: bigint, decimals = 18): number {
    return Number(v) / 10 ** decimals;
}

export function useAccountRisk(): AccountRisk {
    const { address } = useAccount();

    const { data, isLoading } = useReadContract({
        address: TRADING_CORE_ADDRESS,
        abi: TRADING_CORE_ABI,
        functionName: 'getAccountRisk',
        args: address ? [address] : undefined,
        query: { enabled: !!address, refetchInterval: 8000 },
    });

    if (!data) {
        return {
            totalNotional: 0,
            totalCollateral: 0,
            maintenanceMargin: 0,
            unrealizedPnL: 0,
            healthFactor: Infinity,
            crossPositionCount: 0,
            liquidatable: false,
            hasPositions: false,
            loading: isLoading,
        };
    }

    // Support both struct (named) and tuple (array) decoder shapes.
    const obj = data as Record<string, unknown> & Partial<RiskTuple>;
    const get = (name: string, idx: number): bigint => {
        const named = obj[name as keyof typeof obj];
        if (typeof named === 'bigint') return named;
        const arr = data as unknown as RiskTuple;
        const v = arr[idx];
        return typeof v === 'bigint' ? v : 0n;
    };
    const getBool = (name: string, idx: number): boolean => {
        const named = obj[name as keyof typeof obj];
        if (typeof named === 'boolean') return named;
        const arr = data as unknown as RiskTuple;
        return Boolean(arr[idx]);
    };

    const maintenanceMargin = toNum(get('maintenanceMarginRequirement', 2));
    const hfRaw = get('healthFactor', 4);
    // Contract returns type(uint256).max as the "no maintenance requirement" sentinel.
    const healthFactor = maintenanceMargin <= 0 ? Infinity : toNum(hfRaw);
    const crossPositionCount = Number(get('crossPositionCount', 5));

    return {
        totalNotional: toNum(get('totalNotional', 0)),
        totalCollateral: toNum(get('totalCollateral', 1)),
        maintenanceMargin,
        unrealizedPnL: toNum(get('unrealizedPnL', 3)),
        healthFactor,
        crossPositionCount,
        liquidatable: getBool('liquidatable', 6),
        hasPositions: crossPositionCount > 0,
        loading: isLoading,
    };
}
