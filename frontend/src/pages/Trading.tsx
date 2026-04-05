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
import { MobileStickyPriceBar } from '../components/trading/MobileStickyPriceBar';
import { TradingViewWidget } from '../components/TradingViewWidget';

export function TradingPage() {
    const { marketId } = useParams();
    const markets = useMarketsStore((s) => s.markets);

    const [activeTab, setActiveTab] = useState<'chart' | 'trade' | 'positions'>('chart');
    const [tradeSide, setTradeSide] = useState<'long' | 'short'>('long');
    const { tradingFormWidth, positionPanelHeight } = useLayoutStore();

    const { positions, refetch: fetchPositions, isLoading: positionsLoading } = usePositions();
    const optimisticPositions = usePositionsStore((s) => s.optimisticPositions);
    const mergedPositions = useMemo(() => {
        const real = positions.map((p) => ({ ...p, isOptimistic: false }));
        const opt = optimisticPositions.map((p) => ({ ...p, isOptimistic: true }));
        return [...opt, ...real];
    }, [positions, optimisticPositions]);
    const positionsWithLivePnL = useLivePnL(mergedPositions, markets);
    const { trades: tradeHistory, loading: historyLoading } = useTradeHistory(20);

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
    const fundingRate = formatted?.fundingRate ?? market?.fundingRate ?? 0;
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
            {/* Mobile sticky price bar */}
            <MobileStickyPriceBar
                symbol={market.symbol}
                price={currentPrice}
                change24h={market.change24h ?? 0}
                marketId={market.id}
                image={market.image}
                onBuyClick={() => { setTradeSide('long'); setActiveTab('trade'); }}
                onSellClick={() => { setTradeSide('short'); setActiveTab('trade'); }}
            />
            {/* Header */}
            <MarketHeader
                market={market}
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
                        market={market}
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
