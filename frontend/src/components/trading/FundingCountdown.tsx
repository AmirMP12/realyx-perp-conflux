import { useState, useEffect } from 'react';

/** Funding typically happens every hour at :00 UTC */
function getNextFundingMs(): number {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(now.getUTCHours() + 1, 0, 0, 0);
    return Math.max(0, next.getTime() - now.getTime());
}

function formatCountdown(ms: number): string {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m ${s}s`;
}

export function FundingCountdown() {
    const [ms, setMs] = useState(getNextFundingMs);

    useEffect(() => {
        const t = setInterval(() => {
            const next = getNextFundingMs();
            setMs(next);
            if (next > 3600000) {
                clearInterval(t);
            }
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
