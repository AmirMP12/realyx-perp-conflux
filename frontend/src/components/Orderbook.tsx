import { useState } from 'react';
import { ArrowUp } from 'lucide-react';

interface OrderBookEntry {
    price: number;
    size: number;
    total: number;
    percentage: number;
}

interface OrderBookProps {
    marketId: string;
    currentPrice?: number;
    maxDisplayRows?: number;
}

function buildDemoOrderBook(currentPrice: number, spreadPct = 0.002): { bids: OrderBookEntry[]; asks: OrderBookEntry[] } {
    const rows = 15;
    const bids: OrderBookEntry[] = [];
    const asks: OrderBookEntry[] = [];
    let bidTotal = 0;
    let askTotal = 0;
    for (let i = 0; i < rows; i++) {
        const priceBid = currentPrice * (1 - spreadPct * (i + 1) - (i * 0.0005));
        const priceAsk = currentPrice * (1 + spreadPct * (i + 1) + (i * 0.0005));
        const sizeBid = Math.random() * 8 + 2;
        const sizeAsk = Math.random() * 8 + 2;
        bidTotal += sizeBid;
        askTotal += sizeAsk;
        bids.push({ price: priceBid, size: sizeBid, total: bidTotal, percentage: 0 });
        asks.push({ price: priceAsk, size: sizeAsk, total: askTotal, percentage: 0 });
    }
    const maxTotal = Math.max(bidTotal, askTotal);
    bids.forEach(b => { b.percentage = maxTotal > 0 ? (b.total / maxTotal) * 100 : 0; });
    asks.forEach(a => { a.percentage = maxTotal > 0 ? (a.total / maxTotal) * 100 : 0; });
    return { bids: bids.reverse(), asks };
}

interface OrderRowProps {
    entry: OrderBookEntry;
    side: 'bid' | 'ask';
    onClick?: () => void;
}

function OrderRow({ entry, side, onClick }: OrderRowProps) {
    const isBid = side === 'bid';

    return (
        <div
            className="relative flex items-center py-1 px-2 hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors text-sm"
            onClick={onClick}
        >
            {/* Background bar */}
            <div
                className={`absolute top-0 h-full ${isBid ? 'right-0 bg-long/10' : 'left-0 bg-short/10'}`}
                style={{ width: `${entry.percentage}%` }}
            />

            {/* Content */}
            <div className="relative flex w-full">
                {isBid ? (
                    <>
                        <span className="w-1/3 text-right text-text-secondary">{entry.total.toFixed(0)}</span>
                        <span className="w-1/3 text-right text-text-primary">{entry.size.toFixed(0)}</span>
                        <span className="w-1/3 text-right text-long font-mono">{entry.price.toFixed(2)}</span>
                    </>
                ) : (
                    <>
                        <span className="w-1/3 text-left text-short font-mono">{entry.price.toFixed(2)}</span>
                        <span className="w-1/3 text-left text-text-primary">{entry.size.toFixed(0)}</span>
                        <span className="w-1/3 text-left text-text-secondary">{entry.total.toFixed(0)}</span>
                    </>
                )}
            </div>
        </div>
    );
}

function SpreadDisplay({ bid, ask }: { bid: number; ask: number }) {
    const spread = ask - bid;
    const spreadPercent = (spread / bid) * 100;

    return (
        <div className="flex items-center justify-center py-2 px-4 bg-[var(--bg-tertiary)] border-y border-[var(--border-color)]">
            <span className="text-text-secondary text-sm">Spread:</span>
            <span className="ml-2 text-text-primary font-mono">${spread.toFixed(2)}</span>
            <span className="ml-1 text-text-muted text-xs">({spreadPercent.toFixed(3)}%)</span>
        </div>
    );
}

export function OrderBook({ marketId, currentPrice = 50, maxDisplayRows = 12 }: OrderBookProps) {
    const [view, setView] = useState<'both' | 'bids' | 'asks'>('both');
    const [precision, setPrecision] = useState(2);

    const price = currentPrice > 0 ? currentPrice : 50;
    const orderBook = buildDemoOrderBook(price);
    const bestBid = orderBook.bids[0]?.price || 0;
    const bestAsk = orderBook.asks[0]?.price || 0;
    const hasData = orderBook.bids.length > 0 && orderBook.asks.length > 0;

    return (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl overflow-hidden flex flex-col h-full min-h-0">
            {/* Header */}
            <div className="flex items-center justify-between p-2 sm:p-3 border-b border-[var(--border-color)] shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <h3 className="font-semibold text-text-primary text-sm truncate">
                        {String(marketId || 'Market').replace(/-/g, ' ')} · Order Book
                    </h3>
                    <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-500/20 text-amber-400 border border-amber-500/30" title="Simulated depth for demo">Demo</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="flex bg-[var(--bg-tertiary)] rounded p-0.5">
                        <button
                            type="button"
                            onClick={() => setView('both')}
                            className={`px-2 sm:px-3 py-1.5 min-h-[32px] text-[10px] sm:text-xs rounded ${view === 'both' ? 'bg-[var(--bg-secondary)] text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                        >
                            Both
                        </button>
                        <button
                            type="button"
                            onClick={() => setView('bids')}
                            className={`px-2 sm:px-3 py-1.5 min-h-[32px] text-[10px] sm:text-xs rounded ${view === 'bids' ? 'bg-long/20 text-long' : 'text-text-secondary hover:text-long'}`}
                        >
                            Bids
                        </button>
                        <button
                            type="button"
                            onClick={() => setView('asks')}
                            className={`px-2 sm:px-3 py-1.5 min-h-[32px] text-[10px] sm:text-xs rounded ${view === 'asks' ? 'bg-short/20 text-short' : 'text-text-secondary hover:text-short'}`}
                        >
                            Asks
                        </button>
                    </div>
                    <select
                        value={precision}
                        onChange={(e) => setPrecision(Number(e.target.value))}
                        className="bg-[var(--bg-tertiary)] text-text-primary text-[10px] sm:text-xs px-1.5 py-1 rounded border-0 cursor-pointer"
                        aria-label="Price precision"
                    >
                        <option value={0}>0.01</option>
                        <option value={1}>0.1</option>
                        <option value={2}>1</option>
                    </select>
                </div>
            </div>

            {/* Column Headers */}
            <div className="grid grid-cols-2 text-[10px] sm:text-xs text-text-muted border-b border-[var(--border-color)] shrink-0">
                <div className="grid grid-cols-3 px-2 py-1">
                    <span className="text-right">Total</span>
                    <span className="text-right">Size</span>
                    <span className="text-right">Bid</span>
                </div>
                <div className="grid grid-cols-3 px-2 py-1">
                    <span>Ask</span>
                    <span className="text-center">Size</span>
                    <span className="text-right">Total</span>
                </div>
            </div>

            {/* Order Book Body */}
            <div className="flex-1 overflow-auto flex min-h-0 custom-scrollbar">
                {!hasData ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-4 text-center text-text-muted text-xs sm:text-sm">
                        <p>Mark price: ${price.toFixed(2)}</p>
                    </div>
                ) : (
                    <>
                        {(view === 'both' || view === 'bids') && (
                            <div className={`${view === 'both' ? 'w-1/2' : 'w-full'} flex flex-col min-h-0`}>
                                {(view === 'both' ? orderBook.bids.slice(0, maxDisplayRows) : orderBook.bids.slice(0, maxDisplayRows * 2)).map((bid, i) => (
                                    <OrderRow key={`bid-${i}`} entry={bid} side="bid" />
                                ))}
                            </div>
                        )}
                        {(view === 'both' || view === 'asks') && (
                            <div className={`${view === 'both' ? 'w-1/2 border-l border-[var(--border-color)]' : 'w-full'} flex flex-col min-h-0`}>
                                {(view === 'both' ? orderBook.asks.slice(0, maxDisplayRows) : orderBook.asks.slice(0, maxDisplayRows * 2)).map((ask, i) => (
                                    <OrderRow key={`ask-${i}`} entry={ask} side="ask" />
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            {hasData && <SpreadDisplay bid={bestBid} ask={bestAsk} />}
        </div>
    );
}

export function VerticalOrderBook({ marketId, currentPrice = 50 }: OrderBookProps) {
    const price = currentPrice > 0 ? currentPrice : 50;
    const orderBook = buildDemoOrderBook(price);

    return (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl overflow-hidden">
            <div className="p-3 border-b border-[var(--border-color)]">
                <h3 className="font-semibold text-text-primary capitalize">{marketId}</h3>
            </div>

            {/* Headers */}
            <div className="grid grid-cols-3 text-xs text-text-muted px-3 py-2 border-b border-[var(--border-color)]">
                <span>Size</span>
                <span className="text-center">Price</span>
                <span className="text-right">Size</span>
            </div>

            {/* Asks (reversed) */}
            <div className="flex flex-col-reverse">
                {orderBook.asks.slice(0, 8).reverse().map((ask: OrderBookEntry, i: number) => (
                    <div key={`ask-${i}`} className="relative grid grid-cols-3 px-3 py-1 text-sm">
                        <div className="absolute inset-0 bg-short/10" style={{ width: `${ask.percentage * 0.5}%`, right: 0, left: 'auto' }} />
                        <span className="text-text-secondary">{ask.size.toFixed(0)}</span>
                        <span className="text-center text-short font-mono">${ask.price.toFixed(2)}</span>
                        <span className="text-right text-text-secondary"></span>
                    </div>
                ))}
            </div>

            {/* Current Price */}
            <div className="flex items-center justify-center py-3 bg-[var(--bg-tertiary)] border-y border-[var(--border-color)]">
                <span className="text-lg font-bold text-text-primary">${price.toFixed(2)}</span>
                <ArrowUp className="w-4 h-4 text-long ml-2" />
            </div>

            {/* Bids */}
            <div>
                {orderBook.bids.slice(0, 8).map((bid: OrderBookEntry, i: number) => (
                    <div key={`bid-${i}`} className="relative grid grid-cols-3 px-3 py-1 text-sm">
                        <div className="absolute inset-0 bg-long/10" style={{ width: `${bid.percentage * 0.5}%` }} />
                        <span className="text-text-secondary"></span>
                        <span className="text-center text-long font-mono">${bid.price.toFixed(2)}</span>
                        <span className="text-right text-text-secondary">{bid.size.toFixed(0)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default OrderBook;

export const Orderbook = OrderBook;
