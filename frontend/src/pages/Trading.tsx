import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Address } from 'viem';

import { useMarketsStore, usePositionsStore } from '../stores';
import { useLayoutStore } from '../stores/layoutStore';
import { useSingleMarketData } from '../hooks/useMarketData';
import { usePythDisplayPrice, getPythFeedId } from '../hooks/usePythPrice';
import { usePositions } from '../hooks/usePositions';
import { useLivePnL } from '../hooks/useWebSocket';
import { useTradeHistory } from '../hooks/useBackend';

import { MarketHeader } from '../components/trading/MarketHeader';
import { TradingForm } from '../components/trading/TradingForm';
import { PositionTable } from '../components/trading/PositionTable';
import { MobileControls } from '../components/trading/MobileControls';
import { TradingViewWidget } from '../components/TradingViewWidget';
import { MARKET_DISPLAY_FALLBACK } from '../config/markets';

function applyMarketDisplayFallback<T extends { marketAddress?: string; name: string; symbol: string; image?: string }>(market: T): T {
    const key = market.marketAddress?.toLowerCase();
    const fallback = key ? MARKET_DISPLAY_FALLBACK[key] : undefined;
    if (!fallback) return market;

    return {
        ...market,
        name: fallback.name,
        symbol: fallback.symbol,
        image: fallback.image,
    };
}

export function TradingPage() {
    const { marketId } = useParams();
    const rawMarkets = useMarketsStore((s) => s.markets);
    const markets = useMemo(() => rawMarkets.map(applyMarketDisplayFallback), [rawMarkets]);

    const [activeTab, setActiveTab] = useState<'chart' | 'trade' | 'positions'>('chart');
    const [tradeSide, setTradeSide] = useState<'long' | 'short'>('long');
    const { tradingFormWidth, positionPanelHeight } = useLayoutStore();

    const { positions, closedPositions, refetch: fetchPositions, isLoading: positionsLoading } = usePositions();
    const optimisticPositions = usePositionsStore((s) => s.optimisticPositions);
    const mergedPositions = useMemo(() => {
        const real = positions.map((p) => ({ ...p, isOptimistic: false }));
        const opt = optimisticPositions.map((p) => ({ ...p, isOptimistic: true }));
        return [...opt, ...real];
    }, [positions, optimisticPositions]);
    const positionsWithLivePnL = useLivePnL(mergedPositions, markets);
    const { trades: tradeHistoryRaw, loading: historyLoading } = useTradeHistory(20);

    const tradeHistory = useMemo(() => {
        const closedAsTrades = closedPositions.map(p => {
            const m = markets.find(m => m.marketAddress.toLowerCase() === p.marketAddress.toLowerCase());
            return {
                id: Number(p.id),
                signature: `closed-${p.id}`,
                market: m?.symbol || p.marketAddress,
                side: p.isLong ? 'LONG' : 'SHORT' as 'LONG' | 'SHORT',
                size: p.size,
                price: p.entryPrice,
                leverage: Number(p.leverage),
                fee: '0',
                pnl: p.pnl,
                type: 'CLOSE' as const,
                timestamp: p.openTimestamp ? new Date((p.openTimestamp as number) * 1000).toISOString() : new Date().toISOString()
            };
        });
        const merged = [...closedAsTrades, ...tradeHistoryRaw];
        // Deduplicate and sort
        const seen = new Set();
        const deduplicated = merged.filter(t => {
            if (seen.has(t.signature)) return false;
            // Also deduplicate based on position id if backend returns same close
            if (typeof t.signature === 'string' && t.signature.startsWith('closed-')) {
                // If it's local generated one, just keep it, but if backend has a trade for same position we might have duplicate CLOSE events.
            }
            seen.add(t.signature);
            return true;
        });
        return deduplicated.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }, [closedPositions, tradeHistoryRaw, markets]);

    const market = useMemo(() =>
        markets.find(m => m.symbol === marketId) || markets[0]
        , [markets, marketId]);

    const address = market?.marketAddress || "0x0000000000000000000000000000000000000000";
    const shouldFetch = !!market?.marketAddress && market.marketAddress !== "0x0000000000000000000000000000000000000000" && market.marketAddress !== "0x...";

    const { formatted, isLoading: isMarketDataLoading } = useSingleMarketData(shouldFetch ? address as Address : undefined);
    const feedId = getPythFeedId(address, market?.symbol);
    const { price: pythPrice } = usePythDisplayPrice(feedId);

    const fromContractOrApi = (formatted?.price ?? 0) || (market?.indexPrice ?? 0);
    const currentPrice = fromContractOrApi > 0 ? fromContractOrApi : (pythPrice ?? 0);
    /** Merge on-chain OI / funding when RPC data is ready (API list often has zeros without indexer). */
    const displayMarket = useMemo(() => {
        if (!market || !shouldFetch || isMarketDataLoading || !formatted) return market;
        return {
            ...market,
            longOI: formatted.longOI,
            shortOI: formatted.shortOI,
            openInterest: formatted.longOI + formatted.shortOI,
            fundingRate: formatted.fundingRate,
        };
    }, [market, shouldFetch, formatted, isMarketDataLoading]);
    const fundingRate = displayMarket.fundingRate ?? 0;
    const isLive = !isMarketDataLoading && shouldFetch && currentPrice > 0;



    if (!market) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 rounded-full border-4 border-[var(--primary)]/30 border-t-[var(--primary)] animate-spin" />
                    <p className="text-text-muted animate-pulse">Loading Market...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 pb-24 lg:pb-0 min-w-0 w-full overflow-x-hidden">
            {/* Header */}
            <MarketHeader
                market={displayMarket}
                markets={markets}
                currentPrice={currentPrice}
                fundingRate={fundingRate}
                isLive={isLive}
            />

            {/* Mobile Controls */}
            <MobileControls activeTab={activeTab} setActiveTab={setActiveTab} />

            <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0 relative">
                {/* Left Column: Chart & Positions */}
                <div className={clsx("flex-1 flex flex-col gap-4 min-w-0", activeTab !== 'chart' && activeTab !== 'positions' && "hidden lg:flex")}>
                    {/* Chart Area — 65vh mobile (TradingView needs explicit height), 400px standard desktop */}
                    <div
                        className={clsx(
                            "glass-panel glass-panel-elevated relative overflow-hidden rounded-xl h-[65vh] lg:h-[400px]",
                            activeTab === 'positions' && "hidden lg:block"
                        )}
                    >
                        <div className="w-full h-full absolute inset-0">
                            <TradingViewWidget marketSymbol={market?.symbol} />
                        </div>
                    </div>

                    {/* Positions Table */}
                    <div
                        className={clsx(
                            "glass-panel min-h-[200px] flex flex-col rounded-xl overflow-hidden transition-[height] duration-300",
                            activeTab === 'positions' && "lg:flex h-auto"
                        )}
                        style={{ minHeight: positionPanelHeight }}
                    >
                        <PositionTable
                            positions={positionsWithLivePnL}
                            positionsLoading={positionsLoading}
                            tradeHistory={tradeHistory}
                            historyLoading={historyLoading}
                            markets={markets}
                            fetchPositions={fetchPositions}
                        />
                    </div>
                </div>

                {/* Right Column: Trading Form */}
                <div
                    className={clsx(
                        "w-full flex flex-col gap-4 shrink-0 transition-[width] duration-300 mx-auto lg:mx-0",
                        activeTab !== 'trade' && "hidden lg:flex"
                    )}
                    style={{ maxWidth: `min(100%, ${tradingFormWidth}px)` }}
                >
                    <TradingForm
                        market={displayMarket}
                        currentPrice={currentPrice}
                        onTradeSuccess={fetchPositions}
                        side={tradeSide}
                        onSideChange={setTradeSide}
                    />
                </div>
            </div>
        </div>
    );
}
