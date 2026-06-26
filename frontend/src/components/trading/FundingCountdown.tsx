import { useState, useEffect } from 'react';

/**
 * On-chain funding settles every 8 hours (`DataTypes.FUNDING_INTERVAL = 8 hours`),
 * so the countdown targets the next 8h UTC boundary (00:00 / 08:00 / 16:00 UTC).
 * This keeps the timer consistent with the `/8` per-1h rate display and the
 * 3-intervals-per-day cost-to-hold math used elsewhere in the trade view.
 */
const FUNDING_INTERVAL_HOURS = 8;

function getNextFundingMs(): number {
    const now = new Date();
    const next = new Date(now);
    const nextBoundaryHour = (Math.floor(now.getUTCHours() / FUNDING_INTERVAL_HOURS) + 1) * FUNDING_INTERVAL_HOURS;
    next.setUTCHours(nextBoundaryHour, 0, 0, 0);
    return Math.max(0, next.getTime() - now.getTime());
}

function formatCountdown(ms: number): string {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

export function FundingCountdown() {
    const [ms, setMs] = useState(getNextFundingMs);

    useEffect(() => {
        const t = setInterval(() => {
            setMs(getNextFundingMs());
        }, 1000);
        return () => clearInterval(t);
    }, []);

    const str = formatCountdown(ms);

    return (
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Next funding: {str}</span>
        </div>
    );
}
