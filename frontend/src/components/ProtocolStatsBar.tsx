import { useBackendStats, useMarkets } from '../hooks/useBackend';
import { useVaultStats } from '../hooks/useVault';
import { formatCompact } from '../utils/format';

export function ProtocolStatsBar() {
    const { stats: backendStats } = useBackendStats();
    const { stats: vaultStats } = useVaultStats();
    const { markets } = useMarkets();

    const parseStat = (v: unknown) => {
        const n = Number(v ?? 0);
        return Number.isFinite(n) ? n : 0;
    };
    const marketsVolumeFallback = markets.reduce((acc, m) => acc + parseStat(m.volume24h), 0);
    const marketsOiFallback = markets.reduce((acc, m) => acc + parseStat(m.longOI) + parseStat(m.shortOI), 0);

    const backendVolume = parseStat(backendStats?.volume24h);
    const volume24h = backendVolume > 0 ? backendVolume : marketsVolumeFallback;
    const tvl = vaultStats?.tvl ?? 0;
    const backendOi = parseStat(backendStats?.totalOpenInterest);
    const oi = backendOi > 0 ? backendOi : marketsOiFallback;

    return (
        <div className="hidden xl:flex items-center gap-4 text-[11px] text-text-muted whitespace-nowrap">
            <span className="tabular-nums">24h Vol: <span className="text-text-primary font-medium">{formatCompact(volume24h)}</span></span>
            <span className="tabular-nums">OI: <span className="text-text-primary font-medium">{formatCompact(oi)}</span></span>
            <span className="tabular-nums">TVL: <span className="text-text-primary font-medium">{formatCompact(tvl)}</span></span>
        </div>
    );
}
