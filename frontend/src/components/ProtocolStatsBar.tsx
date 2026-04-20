import { useBackendStats } from '../hooks/useBackend';
import { useMarketsStore } from '../stores';
import { useVaultStats } from '../hooks/useVault';
import { formatCompact } from '../utils/format';
import { useAllMarketsOnChainData } from '../hooks/useMarketData';
import { Address } from 'viem';
import { useMemo } from 'react';

export function ProtocolStatsBar() {
    const { stats: backendStats } = useBackendStats();
    const { stats: vaultStats } = useVaultStats();
    const markets = useMarketsStore((s) => s.markets);

    const parseStat = (v: unknown) => {
        const n = Number(v ?? 0);
        return Number.isFinite(n) ? n : 0;
    };
    
    const marketAddresses = useMemo(() => 
        markets.map(m => m.marketAddress as Address).filter(addr => !!addr && addr !== '0x...' && addr !== '0x0000000000000000000000000000000000000000')
    , [markets]);
    
    const { data: onChainData } = useAllMarketsOnChainData(marketAddresses);

    const marketsVolumeFallback = markets.reduce((acc, m) => acc + parseStat(m.volume24h), 0);
    const marketsOiFallback = markets.reduce((acc, m) => acc + parseStat(m.longOI) + parseStat(m.shortOI), 0);

    const backendVolume = parseStat(backendStats?.volume24h);
    const volume24h = backendVolume > 0 ? backendVolume : marketsVolumeFallback;
    const vaultTvl = vaultStats?.tvl ?? 0;
    const backendTvl = parseStat(backendStats?.tvl);
    const tvl = vaultTvl > 0 ? vaultTvl : backendTvl;
    
    const backendOi = parseStat(backendStats?.totalOpenInterest);
    
    const oi = useMemo(() => {
        const onChainTotal = Object.values(onChainData).reduce((acc, val) => acc + val.longOI + val.shortOI, 0);
        if (onChainTotal > 0) return onChainTotal;
        return backendOi > 0 ? backendOi : marketsOiFallback;
    }, [onChainData, backendOi, marketsOiFallback]);

    return (
        <div className="hidden xl:flex items-center gap-4 text-[11px] text-text-muted whitespace-nowrap">
            <span className="tabular-nums">24h Vol: <span className="text-text-primary font-medium">{formatCompact(volume24h)}</span></span>
            <span className="tabular-nums">OI: <span className="text-text-primary font-medium">{formatCompact(oi)}</span></span>
            <span className="tabular-nums">TVL: <span className="text-text-primary font-medium">{formatCompact(tvl)}</span></span>
        </div>
    );
}
