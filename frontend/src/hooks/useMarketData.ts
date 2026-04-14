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
    const { data: coreData, refetch: refetchCore } = useReadContracts({
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

    const coreLoading = !coreData || !coreData[0] || !coreData[1];
    const marketInfo = coreData?.[0]?.result as
        | { totalLongSize: bigint; totalShortSize: bigint; maxLeverage: bigint }
        | undefined;
    const fundingState = coreData?.[1]?.result as { fundingRate: bigint } | undefined;
    const priceData = priceDataResult?.[0]?.result as readonly [bigint, bigint] | undefined;

    if (coreLoading) return { isLoading: true };

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
