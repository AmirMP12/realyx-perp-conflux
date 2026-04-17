import clsx from 'clsx';
import { TrendingUp, TrendingDown, Users } from 'lucide-react';

interface MarketSentimentProps {
    longOI: number;
    shortOI: number;
    symbol: string;
}

export function MarketSentiment({ longOI, shortOI, symbol }: MarketSentimentProps) {
    const totalOI = longOI + shortOI;
    const longPercent = totalOI > 0 ? (longOI / totalOI) * 100 : 50;
    const shortPercent = 100 - longPercent;

    const isBullish = longPercent > 55;
    const isBearish = shortPercent > 55;

    return (
        <div className="glass-panel p-5 flex flex-col gap-6 select-none animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)]">
                        <Users className="w-4 h-4" />
                    </div>
                    <span className="text-sm font-bold text-text-primary tracking-tight">Market Sentiment</span>
                </div>
                <div className={clsx(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                    isBullish ? "bg-[var(--long)]/10 text-[var(--long)]" : 
                    isBearish ? "bg-[var(--short)]/10 text-[var(--short)]" : 
                    "bg-text-muted/10 text-text-muted"
                )}>
                    {isBullish ? 'Bullish' : isBearish ? 'Bearish' : 'Neutral'}
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex justify-between items-end mb-1">
                    <div className="flex flex-col">
                        <span className="text-[10px] text-text-muted font-bold uppercase tracking-widest mb-1">Longs</span>
                        <div className="flex items-center gap-1.5">
                            <TrendingUp className="w-4 h-4 text-[var(--long)]" />
                            <span className="text-xl font-mono font-bold text-[var(--long)]">{longPercent.toFixed(1)}%</span>
                        </div>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] text-text-muted font-bold uppercase tracking-widest mb-1">Shorts</span>
                        <div className="flex items-center gap-1.5">
                            <span className="text-xl font-mono font-bold text-[var(--short)]">{shortPercent.toFixed(1)}%</span>
                            <TrendingDown className="w-4 h-4 text-[var(--short)]" />
                        </div>
                    </div>
                </div>

                <div className="relative h-3 w-full bg-[var(--bg-tertiary)] rounded-full overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
                    <div 
                        className="absolute left-0 top-0 h-full bg-gradient-to-r from-[var(--long)] to-[var(--long)]/80 transition-all duration-1000 ease-out flex items-center justify-end pr-2 overflow-hidden" 
                        style={{ width: `${longPercent}%` }}
                    >
                        {longPercent > 15 && <div className="w-1 h-1 rounded-full bg-white/40 animate-pulse" />}
                    </div>
                    <div 
                        className="absolute right-0 top-0 h-full bg-gradient-to-l from-[var(--short)] to-[var(--short)]/80 transition-all duration-1000 ease-out flex items-center justify-start pl-2 overflow-hidden" 
                        style={{ width: `${shortPercent}%` }}
                    >
                        {shortPercent > 15 && <div className="w-1 h-1 rounded-full bg-white/40 animate-pulse" />}
                    </div>
                    
                    {/* Center Divider */}
                    <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-black/40 -translate-x-1/2 z-10" />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="bg-[var(--bg-tertiary)]/30 rounded-xl p-3 border border-white/[0.03]">
                    <div className="text-[10px] text-text-muted font-bold uppercase tracking-widest mb-1">Total OI</div>
                    <div className="text-sm font-mono text-text-primary tracking-tight">
                        ${(totalOI / 1000).toFixed(2)}k
                    </div>
                </div>
                <div className="bg-[var(--bg-tertiary)]/30 rounded-xl p-3 border border-white/[0.03]">
                    <div className="text-[10px] text-text-muted font-bold uppercase tracking-widest mb-1">Skew</div>
                    <div className={clsx(
                        "text-sm font-mono tracking-tight",
                        longOI >= shortOI ? "text-[var(--long)]" : "text-[var(--short)]"
                    )}>
                        {longOI >= shortOI ? '+' : ''}{((longOI - shortOI) / totalOI * 100 || 0).toFixed(2)}%
                    </div>
                </div>
            </div>

            <div className="pt-2 border-t border-white/[0.03]">
                <p className="text-[10px] text-text-muted leading-relaxed italic">
                    Based on current protocol-wide open interest for {symbol}. Higher skew often indicates potential for funding volatility.
                </p>
            </div>
        </div>
    );
}
