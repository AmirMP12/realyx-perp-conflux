import { Clock, Globe } from 'lucide-react';
import clsx from 'clsx';
import { useMarketSession } from '../hooks/useMarketSession';

interface MarketSessionBadgeProps {
    category?: string;
    /** Compact omits the countdown text (for tight rows / mobile). */
    compact?: boolean;
    className?: string;
}

/**
 * Live session badge for a market. 24/7 markets (crypto/commodity/forex) show a
 * steady "24/7" pill; tokenized equities show open/closed plus a live countdown
 * to the next session change. This is the visible half of the RWA market-hours
 * awareness that differentiates the venue from crypto-only perp DEXes.
 */
export function MarketSessionBadge({ category, compact = false, className }: MarketSessionBadgeProps) {
    const session = useMarketSession(category);

    if (session.isAlwaysOpen) {
        return (
            <span
                className={clsx(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold tracking-wide',
                    'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
                    className,
                )}
                title="This market trades 24/7"
            >
                <Globe className="w-3 h-3" />
                24/7
            </span>
        );
    }

    const isOpen = session.state === 'open';
    const tone = isOpen
        ? session.closingSoon
            ? 'bg-amber-500/10 border-amber-500/25 text-amber-400'
            : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
        : 'bg-rose-500/10 border-rose-500/25 text-rose-400';

    return (
        <span
            className={clsx(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold tracking-wide',
                tone,
                className,
            )}
            title={session.nextChangeLabel ?? undefined}
        >
            <Clock className="w-3 h-3 shrink-0" />
            <span>{isOpen ? 'Market open' : 'Market closed'}</span>
            {!compact && session.nextChangeLabel && (
                <span className="font-normal opacity-80 tabular-nums">· {session.nextChangeLabel}</span>
            )}
        </span>
    );
}
