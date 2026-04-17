import { MARKET_DISPLAY_FALLBACK } from '../config/markets';

export interface BaseMarket {
    marketAddress?: string;
    name: string;
    symbol: string;
    image?: string;
}

/**
 * Applies brand-consistent names, symbols, and high-quality images 
 * (primarily from GitHub/official assets) to raw market data from the API.
 */
export function applyMarketDisplayFallback<T extends BaseMarket>(market: T): T {
    if (!market) return market;
    
    const key = (market.marketAddress || '').toLowerCase();
    const fallback = MARKET_DISPLAY_FALLBACK[key];
    
    if (!fallback) return market;

    return {
        ...market,
        name: fallback.name,
        symbol: fallback.symbol,
        image: fallback.image || market.image,
    } as T;
}

/**
 * Batch utility for collections
 */
export function mapMarketsWithFallback<T extends BaseMarket>(markets: T[]): T[] {
    if (!markets) return [] as T[];
    return markets.map(applyMarketDisplayFallback);
}
