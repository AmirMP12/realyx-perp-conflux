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

function readMarketInfoTuple(
    raw: unknown,
): { totalLongSize: bigint; totalShortSize: bigint; maxLeverage: bigint } | undefined {
    if (raw == null) return undefined;
    if (typeof raw === 'object' && !Array.isArray(raw) && 'totalLongSize' in raw) {
        const o = raw as { totalLongSize: bigint; totalShortSize: bigint; maxLeverage: bigint };
        return {
            totalLongSize: BigInt(o.totalLongSize),
            totalShortSize: BigInt(o.totalShortSize),
            maxLeverage: BigInt(o.maxLeverage),
        };
    }
    return undefined;
}

function readFundingTuple(raw: unknown): { fundingRate: bigint } | undefined {
    if (raw == null) return undefined;
    if (typeof raw === 'object' && !Array.isArray(raw) && 'fundingRate' in raw) {
        const o = raw as { fundingRate: bigint };
        return { fundingRate: BigInt(o.fundingRate) };
    }
    if (Array.isArray(raw) && raw[0] !== undefined && raw[0] !== null) {
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

    return {
        isLoading: false,
        raw: {
            marketInfo,
            fundingState,
            priceData: priceData ?? null
        },
        formatted: {
            longOI: marketInfo ? Number(marketInfo.totalLongSize) / 1e18 : 0,
            shortOI: marketInfo ? Number(marketInfo.totalShortSize) / 1e18 : 0,
            maxLeverage: marketInfo ? Number(marketInfo.maxLeverage) : 0,
            fundingRate: fundingState ? Number(fundingState.fundingRate) / 1e18 : 0,
            price: priceData ? Number(priceData[0]) / 1e18 : 0,
            confidence: priceData ? Number(priceData[1]) / 1e18 : 0
        },
        refetch: () => {
            refetchCore();
            refetchPrice();
        }
    };
}
