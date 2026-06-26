import { useReadContracts } from 'wagmi';
import {
    TRADING_CORE_ADDRESS,
    TRADING_CORE_ABI,
    ORACLE_AGGREGATOR_ADDRESS,
    ORACLE_ABI,
    VAULT_CORE_ADDRESS,
    VAULT_ABI
} from './useProgram';
import { Address } from 'viem';

interface MarketInfoTuple {
    totalLongSize: bigint;
    totalShortSize: bigint;
    maxLeverage: bigint;
    /** Max notional (1e18 USD) for a single position in this market. */
    maxPositionSize: bigint;
    /** Max total open interest (1e18 USD) allowed across the market. */
    maxTotalExposure: bigint;
    /** Maintenance-margin requirement in basis points. */
    maintenanceMargin: bigint;
    /** Initial-margin requirement in basis points. */
    initialMargin: bigint;
}

/**
 * Decode the on-chain `DataTypes.Market` struct returned by `getMarketInfo`.
 *
 * Struct layout (index → field):
 *   0 chainlinkFeed · 1 maxStaleness · 2 maxPriceUncertainty · 3 maxPositionSize ·
 *   4 maxTotalExposure · 5 maintenanceMargin · 6 initialMargin · 7 maxLeverage ·
 *   8 totalLongSize · 9 totalShortSize · 10 totalLongCost · 11 totalShortCost ·
 *   12 isActive · 13 isListed
 */
function readMarketInfoTuple(raw: unknown): MarketInfoTuple | undefined {
    if (raw == null) return undefined;
    const toBig = (v: unknown): bigint => {
        if (v == null) return 0n;
        try {
            return BigInt(v as never);
        } catch {
            return 0n;
        }
    };

    // Case 1: Object with named properties
    if (typeof raw === 'object' && !Array.isArray(raw) && 'totalLongSize' in raw) {
        const o = raw as Record<string, unknown>;
        return {
            totalLongSize: toBig(o.totalLongSize),
            totalShortSize: toBig(o.totalShortSize),
            maxLeverage: toBig(o.maxLeverage),
            maxPositionSize: toBig(o.maxPositionSize),
            maxTotalExposure: toBig(o.maxTotalExposure),
            maintenanceMargin: toBig(o.maintenanceMargin),
            initialMargin: toBig(o.initialMargin),
        };
    }

    // Case 2: Array (tuple) - Common on Conflux / older RPCs
    if (Array.isArray(raw) && raw.length >= 10) {
        return {
            totalLongSize: toBig(raw[8]),
            totalShortSize: toBig(raw[9]),
            maxLeverage: toBig(raw[7]),
            maxPositionSize: toBig(raw[3]),
            maxTotalExposure: toBig(raw[4]),
            maintenanceMargin: toBig(raw[5]),
            initialMargin: toBig(raw[6]),
        };
    }

    return undefined;
}

function readFundingTuple(raw: unknown): { fundingRate: bigint } | undefined {
    if (raw == null) return undefined;

    // Case 1: Object with named properties
    if (typeof raw === 'object' && !Array.isArray(raw) && 'fundingRate' in raw) {
        const o = raw as { fundingRate: bigint };
        return { fundingRate: BigInt(o.fundingRate) };
    }

    // Case 2: Array (tuple)
    // FundingState struct: fundingRate is index 0
    if (Array.isArray(raw) && raw.length > 0 && raw[0] !== undefined && raw[0] !== null) {
        return { fundingRate: BigInt(raw[0] as bigint) };
    }

    return undefined;
}

export function useMarketData() {
    const { data: tvlData } = useReadContracts({
        contracts: [{
            address: VAULT_CORE_ADDRESS,
            abi: VAULT_ABI,
            functionName: 'totalAssets'
        }]
    });

    return {
        tvl: tvlData?.[0]?.result ? Number(tvlData[0].result) / 1e6 : 0 // USDC 6 decimals
    };
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const hasOracle = ORACLE_AGGREGATOR_ADDRESS && ORACLE_AGGREGATOR_ADDRESS !== ZERO_ADDRESS;

export function useSingleMarketData(marketAddress?: Address) {
    const enabled = !!marketAddress && !!TRADING_CORE_ADDRESS;
    const oracleEnabled = enabled && !!hasOracle;

    // Fetch market info and funding in one batch (core data)
    const { data: coreData, refetch: refetchCore, isPending: corePending } = useReadContracts({
        contracts: [
            {
                address: TRADING_CORE_ADDRESS,
                abi: TRADING_CORE_ABI,
                functionName: 'getMarketInfo',
                args: marketAddress ? [marketAddress] : undefined
            },
            {
                address: TRADING_CORE_ADDRESS,
                abi: TRADING_CORE_ABI,
                functionName: 'getFundingState',
                args: marketAddress ? [marketAddress] : undefined
            }
        ],
        query: {
            enabled,
            refetchInterval: 5000
        }
    });

    // Fetch price from oracle separately so a revert (e.g. unset Pyth feed) doesn't block core data
    const { data: priceDataResult, refetch: refetchPrice } = useReadContracts({
        contracts: [
            {
                address: ORACLE_AGGREGATOR_ADDRESS,
                abi: ORACLE_ABI,
                functionName: 'getPrice',
                args: marketAddress ? [marketAddress] : undefined
            }
        ],
        query: {
            enabled: oracleEnabled,
            refetchInterval: 5000
        }
    });

    const r0 = coreData?.[0];
    const r1 = coreData?.[1];
    /** Batch resolves together; `corePending` / undefined `coreData` covers the loading window. */
    const coreWaiting = enabled && (corePending || coreData === undefined);

    const marketInfo =
        r0?.status === 'success' && r0.result != null ? readMarketInfoTuple(r0.result) : undefined;
    const fundingState =
        r1?.status === 'success' && r1.result != null ? readFundingTuple(r1.result) : undefined;
    const priceData = priceDataResult?.[0]?.result as readonly [bigint, bigint] | undefined;

    if (coreWaiting) return { isLoading: true };

    const longOI = marketInfo ? Number(marketInfo.totalLongSize) / 1e18 : 0;
    const shortOI = marketInfo ? Number(marketInfo.totalShortSize) / 1e18 : 0;
    const totalOI = longOI + shortOI;

    // Calculate live funding rate based on BASE_FUNDING_RATE = 1e14 (0.0001 or 0.01%)
    let liveFundingRate = fundingState ? Number(fundingState.fundingRate) / 1e18 : 0;
    if (totalOI > 0) {
        const baseRate = 0.0001; // 1e14 / 1e18
        const imbalance = (longOI - shortOI) / totalOI;
        liveFundingRate = baseRate * imbalance;
    }

    return {
        isLoading: false,
        raw: {
            marketInfo,
            fundingState,
            priceData: priceData ?? null
        },
        formatted: {
            longOI,
            shortOI,
            maxLeverage: marketInfo ? Number(marketInfo.maxLeverage) : 0,
            fundingRate: liveFundingRate,
            price: priceData ? Number(priceData[0]) / 1e18 : 0,
            confidence: priceData ? Number(priceData[1]) / 1e18 : 0,
            // Risk/capacity caps straight from the on-chain Market struct (1e18 USD notional).
            maxPositionSize: marketInfo ? Number(marketInfo.maxPositionSize) / 1e18 : 0,
            maxTotalExposure: marketInfo ? Number(marketInfo.maxTotalExposure) / 1e18 : 0,
            maintenanceMarginBps: marketInfo ? Number(marketInfo.maintenanceMargin) : 0,
            initialMarginBps: marketInfo ? Number(marketInfo.initialMargin) : 0,
        },
        refetch: () => {
            refetchCore();
            refetchPrice();
        }
    };
}

export function useAllMarketsOnChainData(marketAddresses: Address[]) {
    const enabled = marketAddresses.length > 0 && !!TRADING_CORE_ADDRESS;

    const contracts = marketAddresses.flatMap(addr => [
        {
            address: TRADING_CORE_ADDRESS as Address,
            abi: TRADING_CORE_ABI,
            functionName: 'getMarketInfo',
            args: [addr]
        },
        {
            address: TRADING_CORE_ADDRESS as Address,
            abi: TRADING_CORE_ABI,
            functionName: 'getFundingState',
            args: [addr]
        }
    ]);

    const { data, isLoading, refetch } = useReadContracts({
        contracts,
        query: {
            enabled,
            refetchInterval: 15000,
            staleTime: 5000,
        }
    });

    const results: Record<string, { longOI: number; shortOI: number; fundingRate: number }> = {};

    if (data) {
        marketAddresses.forEach((addr, i) => {
            const r0 = data[i * 2];
            const r1 = data[i * 2 + 1];

            const marketInfo = r0?.status === 'success' ? readMarketInfoTuple(r0.result) : undefined;
            const fundingState = r1?.status === 'success' ? readFundingTuple(r1.result) : undefined;

            const longOI = marketInfo ? Number(marketInfo.totalLongSize) / 1e18 : 0;
            const shortOI = marketInfo ? Number(marketInfo.totalShortSize) / 1e18 : 0;
            const totalOI = longOI + shortOI;

            let liveFundingRate = fundingState ? Number(fundingState.fundingRate) / 1e18 : 0;
            if (totalOI > 0) {
                const baseRate = 0.0001; // matches contract logic
                const imbalance = (longOI - shortOI) / totalOI;
                liveFundingRate = baseRate * imbalance;
            }

            results[addr.toLowerCase()] = {
                longOI,
                shortOI,
                fundingRate: liveFundingRate
            };
        });
    }

    return { data: results, isLoading, refetch };
}
