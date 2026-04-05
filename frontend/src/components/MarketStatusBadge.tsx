import { Clock } from 'lucide-react';
import clsx from 'clsx';

// Perp DEX markets are 24/7; status reflects that (no traditional session mock).
export function MarketStatusBadge() {
    const isOpen = true; // Perpetual markets are active 24/7

    return (
        <div className={clsx(
            "flex items-center space-x-1.5 px-3 py-1 rounded-full border text-xs font-semibold tracking-wide uppercase",
            isOpen
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                : "bg-rose-500/10 border-rose-500/20 text-rose-500"
        )}>
            <Clock className="w-3.5 h-3.5" />
            <span>{isOpen ? 'Market Active' : 'Paused'}</span>
        </div>
    );
}
