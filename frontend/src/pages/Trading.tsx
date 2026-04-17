import { useState, useMemo, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { Address } from 'viem';

import { useMarketsStore, usePositionsStore } from '../stores';
import { useLayoutStore } from '../stores/layoutStore';
import { useSingleMarketData } from '../hooks/useMarketData';
import { usePythDisplayPrice, getPythFeedId } from '../hooks/usePythPrice';
import { usePositions } from '../hooks/usePositions';
import { useOnChainHistory } from '../hooks/useOnChainHistory';
import { useLivePnL } from '../hooks/useWebSocket';
import { useTradeHistory } from '../hooks/useBackend';

import { MarketHeader } from '../components/trading/MarketHeader';
import { TradingForm } from '../components/trading/TradingForm';
import { PositionTable } from '../components/trading/PositionTable';
import { MobileControls } from '../components/trading/MobileControls';
import { MarketSentiment } from '../components/trading/MarketSentiment';
import { TradingViewWidget } from '../components/TradingViewWidget';
import { applyMarketDisplayFallback } from '../utils/market';

export function TradingPage() {
    const { marketId } = useParams();
    const rawMarkets = useMarketsStore((s) => s.markets);
    const markets = useMemo(() => rawMarkets.map(applyMarketDisplayFallback), [rawMarkets]);

    const [activeTab, setActiveTab] = useState<'chart' | 'trade' | 'positions'>('chart');
    const [tradeSide, setTradeSide] = useState<'long' | 'short'>('long');
    const { positionPanelHeight } = useLayoutStore();
    const { search } = useLocation();

    useEffect(() => {
        const params = new URLSearchParams(search);
        const tab = params.get('tab');
        if (tab === 'trade' || tab === 'chart' || tab === 'positions') {
            setActiveTab(tab as any);
        }
    }, [search]);

    const { positions, refetch: fetchPositions, isLoading: positionsLoading } = usePositions();
    const { data: onChainHistory = [] } = useOnChainHistory();
    const optimisticPositions = usePositionsStore((s) => s.optimisticPositions);
    
    const mergedPositions = useMemo(() => {
        const real = positions.map((p) => ({ ...p, isOptimistic: false }));
        const opt = optimisticPositions.map((p) => ({ ...p, isOptimistic: true }));
        return [...opt, ...real];
    }, [positions, optimisticPositions]);
    
    const positionsWithLivePnL = useLivePnL(mergedPositions, markets);
    const { trades: tradeHistoryRaw, loading: historyLoading } = useTradeHistory(20);

    const tradeHistory = useMemo(() => {
        const onChainAsTrades = onChainHistory.map(t => {
            const m = markets.find(m => m.marketAddress.toLowerCase() === t.market.toLowerCase());
            return {
                ...t,
                market: m?.symbol || t.market.slice(0, 8) + '...'
            };
        });
        
        const merged = [...onChainAsTrades, ...tradeHistoryRaw];
        const seen = new Set();
        const deduplicated = merged.filter(t => {
            if (!t.signature || seen.has(t.signature)) return false;
            seen.add(t.signature);
            return true;
        });
        
        // Sort by timestamp if available or by ID
        return deduplicated.sort((a, b) => {
            const timeA = new Date(a.timestamp).getTime();
            const timeB = new Date(b.timestamp).getTime();
            if (timeA !== timeB) return timeB - timeA;
            return (Number(b.id) || 0) - (Number(a.id) || 0);
        });
    }, [onChainHistory, tradeHistoryRaw, markets]);

    const market = useMemo(() =>
        markets.find(m => m.symbol === marketId) || markets[0]
        , [markets, marketId]);

    const address = market?.marketAddress || "0x0000000000000000000000000000000000000000";
    const shouldFetch = !!market?.marketAddress && market.marketAddress !== "0x0000000000000000000000000000000000000000" && market.marketAddress !== "0x...";

    const { formatted, isLoading: isMarketDataLoading } = useSingleMarketData(shouldFetch ? address as Address : undefined);
    const feedId = getPythFeedId(address, market?.symbol);
    const { price: pythPrice, refetch: refetchPrice } = usePythDisplayPrice(feedId);

    const fromContractOrApi = (formatted?.price ?? 0) || (market?.indexPrice ?? 0);
    // Prioritize Pyth price for real-time speed, fallback to contract/API if Pyth is slow or missing
    const currentPrice = (pythPrice ?? 0) > 0 ? (pythPrice ?? 0) : fromContractOrApi;
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
        <div className="flex flex-col gap-3 lg:gap-4 pb-24 lg:pb-10 min-w-0 w-full overflow-x-hidden translate-z-0">
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

            <div className="flex-1 flex flex-col gap-4 min-h-0 relative">
                {/* Top Row: Chart & Form */}
                <div className="flex flex-col lg:flex-row gap-4 w-full lg:h-[720px]">
                    {/* Left/Center: Chart Area */}
                    <div
                        className={clsx(
                            "flex-1 glass-panel glass-panel-elevated relative overflow-hidden rounded-xl h-[400px] sm:h-[500px] lg:h-full min-h-[400px]",
                            activeTab !== 'chart' && "hidden lg:block"
                        )}
                    >
                        <div className="w-full h-full absolute inset-0">
                            <TradingViewWidget marketSymbol={market?.symbol} />
                        </div>
                    </div>

                    {/* Right: Trading Form */}
                    <div
                        className={clsx(
                            "w-full lg:w-[420px] shrink-0 flex flex-col gap-4",
                            activeTab !== 'trade' && "hidden lg:flex"
                        )}
                    >
                        <TradingForm
                            market={displayMarket}
                            currentPrice={currentPrice}
                            side={tradeSide}
                            onSideChange={setTradeSide}
                            onPriceRefresh={refetchPrice}
                            onTradeSuccess={() => {
                                fetchPositions();
                            }}
                        />

                        <div className="hidden lg:flex flex-1 min-h-0">
                            <MarketSentiment 
                                longOI={displayMarket.longOI ?? 0} 
                                shortOI={displayMarket.shortOI ?? 0} 
                                symbol={displayMarket.symbol} 
                            />
                        </div>
                    </div>
                </div>

                {/* Bottom Row: Positions Table (Full Width) */}
                <div
                    className={clsx(
                        "w-full glass-panel lg:flex-1 min-h-[300px] flex flex-col rounded-xl overflow-hidden transition-all duration-300 shadow-xl border border-[var(--border-color)]/60",
                        activeTab !== 'positions' && "hidden lg:flex"
                    )}
                    style={{ minHeight: activeTab === 'positions' ? positionPanelHeight : undefined }}
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
        </div>
    );
}
