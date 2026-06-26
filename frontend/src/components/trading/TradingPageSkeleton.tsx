import { Skeleton } from '../ui/Skeleton';

/**
 * Layout-matching loading state for the trading screen. Mirrors the real
 * grid — market header, chart + form row, positions panel — so the page
 * reserves its final shape while market data resolves. Reads far more like a
 * trading terminal than a centered spinner and avoids the content "jump" once
 * data lands.
 */
export function TradingPageSkeleton() {
    return (
        <div
            className="flex flex-col gap-3 lg:gap-4 pb-24 lg:pb-10 w-full"
            aria-busy="true"
            aria-label="Loading market"
        >
            {/* Market header bar */}
            <div className="glass-panel glass-panel-elevated rounded-2xl px-3 sm:px-4 lg:px-5 py-3 w-full">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                        <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                        <div className="flex flex-col gap-2">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-3 w-16" />
                        </div>
                        <div className="hidden sm:flex flex-col gap-2 pl-4 border-l border-line/60">
                            <Skeleton className="h-6 w-28" />
                            <Skeleton className="h-3 w-14" />
                        </div>
                    </div>
                    <div className="hidden lg:flex items-center gap-8">
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="flex flex-col items-end gap-2">
                                <Skeleton className="h-3 w-16" />
                                <Skeleton className="h-4 w-20" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Chart + form row */}
            <div className="flex flex-col lg:flex-row gap-4 w-full">
                <div className="flex-1 flex flex-col gap-4 min-w-0">
                    {/* Chart */}
                    <div className="glass-panel rounded-xl h-[420px] sm:h-[520px] p-4 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="h-7 w-40 rounded-lg" />
                        </div>
                        <Skeleton className="flex-1 w-full rounded-lg" />
                    </div>
                    {/* Liquidity strip */}
                    <div className="glass-panel rounded-xl p-4 flex items-center gap-4">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-3 flex-1 rounded-full" />
                        <Skeleton className="h-3 w-24" />
                    </div>
                </div>

                {/* Trading form */}
                <div className="w-full lg:w-[420px] shrink-0">
                    <div className="glass-panel rounded-xl p-4 flex flex-col gap-4">
                        <div className="grid grid-cols-2 gap-2">
                            <Skeleton className="h-10 rounded-lg" />
                            <Skeleton className="h-10 rounded-lg" />
                        </div>
                        <Skeleton className="h-12 w-full rounded-lg" />
                        <Skeleton className="h-12 w-full rounded-lg" />
                        <div className="flex gap-2">
                            {[0, 1, 2, 3].map((i) => (
                                <Skeleton key={i} className="h-8 flex-1 rounded-lg" />
                            ))}
                        </div>
                        <Skeleton className="h-12 w-full rounded-lg" />
                        <div className="flex flex-col gap-2 pt-2">
                            {[0, 1, 2].map((i) => (
                                <div key={i} className="flex items-center justify-between">
                                    <Skeleton className="h-3 w-20" />
                                    <Skeleton className="h-3 w-16" />
                                </div>
                            ))}
                        </div>
                        <Skeleton className="h-12 w-full rounded-xl" />
                    </div>
                </div>
            </div>

            {/* Positions panel */}
            <div className="glass-panel rounded-xl min-h-[280px] p-4 flex flex-col gap-4">
                <div className="flex items-center gap-6 pb-2 border-b border-line/60">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-16" />
                </div>
                {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-4">
                        <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-4 w-20 ml-auto" />
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-4 w-16" />
                    </div>
                ))}
            </div>
        </div>
    );
}

export default TradingPageSkeleton;
