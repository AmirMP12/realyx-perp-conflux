import { PriceTicker } from '../ui/PriceTicker';
import clsx from 'clsx';

interface MobileStickyPriceBarProps {
    symbol: string;
    price: number;
    change24h: number;
    marketId: string;
    image?: string;
    onBuyClick?: () => void;
    onSellClick?: () => void;
}

export function MobileStickyPriceBar({ symbol, price, change24h, image, onBuyClick, onSellClick }: MobileStickyPriceBarProps) {
    const isPositive = change24h >= 0;

    return (
        <div className="lg:hidden fixed bottom-[60px] left-0 right-0 z-30 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] px-3 sm:px-4 py-3 flex items-center justify-between gap-2 min-h-[60px] shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                {image && (
                    <img src={image} alt={symbol} className="w-8 h-8 rounded-full ring-1 ring-[var(--border-color)] shrink-0" />
                )}
                <div>
                    <div className="text-xs text-text-muted font-medium">{symbol}</div>
                    <div className="flex items-baseline gap-2">
                        <PriceTicker value={price} prefix="$" decimals={2} className="text-lg font-bold font-mono text-text-primary" />
                        <span className={clsx("text-xs font-medium tabular-nums", isPositive ? "text-[var(--long)]" : "text-[var(--short)]")}>
                            {isPositive ? '+' : ''}{change24h.toFixed(2)}%
                        </span>
                    </div>
                </div>
            </div>
            <div className="flex gap-2 shrink-0">
                <button
                    type="button"
                    onClick={onBuyClick}
                    className="min-h-[44px] px-3 sm:px-4 py-2 rounded-xl bg-[var(--long)] text-white text-sm font-bold motion-safe:active:scale-[0.98] transition-transform touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                    Buy
                </button>
                <button
                    type="button"
                    onClick={onSellClick}
                    className="min-h-[44px] px-3 sm:px-4 py-2 rounded-xl bg-[var(--short)] text-white text-sm font-bold motion-safe:active:scale-[0.98] transition-transform touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                    Sell
                </button>
            </div>
        </div>
    );
}
