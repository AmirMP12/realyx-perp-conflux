import { useBackendStats } from '../hooks/useBackend';
import { useVaultStats } from '../hooks/useVault';
import { formatCompact } from '../utils/format';

export function ProtocolStatsBar() {
    const { stats: backendStats } = useBackendStats();
    const { stats: vaultStats } = useVaultStats();

    const volume24h = backendStats ? parseFloat(backendStats.volume24h) : 0;
    const tvl = vaultStats?.tvl ?? 0;
    const oi = backendStats ? parseFloat(backendStats.totalOpenInterest) : 0;

    return (
        <div className="hidden lg:flex items-center gap-6 text-xs text-text-muted">
            <span className="tabular-nums">24h Vol: <span className="text-text-primary font-medium">{formatCompact(volume24h)}</span></span>
            <span className="tabular-nums">OI: <span className="text-text-primary font-medium">{formatCompact(oi)}</span></span>
            <span className="tabular-nums">TVL: <span className="text-text-primary font-medium">{formatCompact(tvl)}</span></span>
        </div>
    );
}
