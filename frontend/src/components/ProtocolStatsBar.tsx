import { useBackendStats, useMarkets } from '../hooks/useBackend';
import { useVaultStats } from '../hooks/useVault';
import { formatCompact, formatPrice } from '../utils/format';

export function ProtocolStatsBar() {
    const { stats: backendStats } = useBackendStats();
    const { stats: vaultStats } = useVaultStats();
    const { markets } = useMarkets();

    const volume24h = backendStats ? parseFloat(backendStats.volume24h) : 0;
    const tvl = vaultStats?.tvl ?? 0;
    const oi = backendStats ? parseFloat(backendStats.totalOpenInterest) : 0;

    const cfxMarket = markets.find(m => m.symbol === 'CFX-USD');
    const cfxPrice = cfxMarket ? parseFloat(cfxMarket.indexPrice) : 0;

    return (
        <div className="hidden xl:flex items-center gap-4 text-[11px] text-text-muted whitespace-nowrap">
            {cfxPrice > 0 && (
                <span className="tabular-nums">CFX: <span className="text-[var(--primary)] font-medium">${formatPrice(cfxPrice)}</span></span>
            )}
            <span className="tabular-nums">24h Vol: <span className="text-text-primary font-medium">{formatCompact(volume24h)}</span></span>
            <span className="tabular-nums">OI: <span className="text-text-primary font-medium">{formatCompact(oi)}</span></span>
            <span className="tabular-nums">TVL: <span className="text-text-primary font-medium">{formatCompact(tvl)}</span></span>
        </div>
    );
}
