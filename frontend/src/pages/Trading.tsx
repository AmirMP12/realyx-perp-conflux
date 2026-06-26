import { useState, useMemo, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { Address } from 'viem';

import { useMarketsStore, usePositionsStore } from '../stores';
import { useLayoutStore } from '../stores/layoutStore';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { useSingleMarketData } from '../hooks/useMarketData';
import { usePriceFeed } from '../hooks/usePriceFeed';
import { usePositions } from '../hooks/usePositions';
import { useOnChainHistory } from '../hooks/useOnChainHistory';
import { useLivePnL } from '../hooks/useWebSocket';
import { useTradeHistory } from '../hooks/useBackend';

import { MarketHeader } from '../components/trading/MarketHeader';
import { TradingForm } from '../components/trading/TradingForm';
import { PositionTable } from '../components/trading/PositionTable';
import { MobileControls } from '../components/trading/MobileControls';
import { ChartPanel } from '../components/trading/ChartPanel';
import { TradingPageSkeleton } from '../components/trading/TradingPageSkeleton';
import { MarketLiquidityPanel } from '../components/trading/MarketLiquidityPanel';
import { CopyTradersStrip } from '../components/trading/CopyTradersStrip';
import { ResizeHandle } from '../components/trading/ResizeHandle';
import { applyMarketDisplayFallback } from '../utils/market';

export function TradingPage() {
    const { marketId } = useParams();
    const rawMarkets = useMarketsStore((s) => s.markets);
    const markets = useMemo(() => rawMarkets.map(applyMarketDisplayFallback), [rawMarkets]);

    const [activeTab, setActiveTab] = useState<'chart' | 'trade' | 'positions'>('chart');
    const [tradeSide, setTradeSide] = useState<'long' | 'short'>('long');
    const { positionPanelHeight, setPositionPanelHeight } = useLayoutStore();
    const isDesktop = useIsDesktop();
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

    // Single source of truth for the display price: Pyth → contract/oracle → API,
    // with freshness tracking. Replaces the old inline fallback chain.
    const priceFeed = usePriceFeed(
        {
            marketAddress: address,
            symbol: market?.symbol,
            contractPrice: formatted?.price,
            apiPrice: market?.indexPrice,
        },
        { enabled: shouldFetch },
    );
    const currentPrice = priceFeed.price;
    const refetchPrice = priceFeed.refresh;
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
    const fundingRate = displayMarket?.fundingRate ?? 0;
    const isLive = !isMarketDataLoading && shouldFetch && currentPrice > 0;



    if (!market) {
        return <TradingPageSkeleton />;
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
                priceSource={priceFeed.source}
                priceAgeMs={priceFeed.ageMs}
                priceStale={priceFeed.isStale}
            />

            {/* Mobile Controls */}
            <MobileControls activeTab={activeTab} setActiveTab={setActiveTab} />

            <div className="flex-1 flex flex-col gap-4 min-h-0 relative">
                {/* Top Row: Chart + Liquidity (left) & Form (right) */}
                <div className="flex flex-col lg:flex-row gap-4 w-full">
                    {/* Left/Center: Chart stacked above the Market Liquidity strip */}
                    <div className="flex-1 flex flex-col gap-4 min-w-0">
                        <ChartPanel
                            market={market}
                            currentPrice={currentPrice}
                            className={clsx(
                                'h-[420px] sm:h-[520px] lg:h-auto lg:flex-1 min-h-[420px]',
                                activeTab !== 'chart' && 'hidden lg:flex',
                            )}
                        />

                        {/* Market Liquidity (real on-chain data, replaces the old order book).
                            A compact horizontal strip under the chart — sized to its content so
                            there's no empty space. Shares the 'chart' tab on mobile. */}
                        <MarketLiquidityPanel
                            market={displayMarket}
                            currentPrice={currentPrice}
                            className={clsx(activeTab !== 'chart' && 'hidden lg:flex')}
                        />
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
                            maxLeverage={formatted?.maxLeverage}
                            side={tradeSide}
                            onSideChange={setTradeSide}
                            onPriceRefresh={refetchPrice}
                            onTradeSuccess={() => {
                                fetchPositions();
                            }}
                            className="flex-1"
                        />
                    </div>
                </div>

                {/* Desktop-only splitter: drag to resize the positions panel.
                    The chosen height persists via the layout store. */}
                <ResizeHandle
                    value={positionPanelHeight}
                    onChange={setPositionPanelHeight}
                    min={240}
                    max={760}
                    direction="up"
                    aria-label="Resize positions panel"
                    className="hidden lg:flex"
                />

                {/* Bottom Row: Positions Table (Full Width) */}
                <div
                    className={clsx(
                        "w-full glass-panel min-h-[300px] lg:min-h-0 flex flex-col rounded-xl overflow-hidden shadow-xl border border-line/60",
                        activeTab !== 'positions' && "hidden lg:flex"
                    )}
                    style={
                        isDesktop
                            ? { height: positionPanelHeight }
                            : { minHeight: activeTab === 'positions' ? positionPanelHeight : undefined }
                    }
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

                {/* Discoverable copy-trading entry point (hidden on the mobile
                    trade/positions tabs to keep the focused trading flow clean). */}
                <CopyTradersStrip className={clsx(activeTab !== 'chart' && 'hidden lg:block')} />
            </div>
        </div>
    );
}
