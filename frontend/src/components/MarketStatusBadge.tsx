import { Clock } from 'lucide-react';
import clsx from 'clsx';

// Perp DEX markets are 24/7, so this badge always reflects an active market.
export function MarketStatusBadge() {
    return (
        <div className={clsx(
            "flex items-center space-x-1.5 px-3 py-1 rounded-full border text-xs font-semibold tracking-wide uppercase",
            "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
        )}>
            <Clock className="w-3.5 h-3.5" />
            <span>Market Active</span>
        </div>
    );
}
