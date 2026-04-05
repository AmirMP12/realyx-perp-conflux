import { getApiBaseUrl } from '../config/api';

const API_BASE = getApiBaseUrl();

export interface Market {
    id: string;
    symbol: string;
    name: string;
    image: string;
    description?: string;
    oracleFeed?: string;
    marketAddress: string;
    category: 'CRYPTO' | 'COMMODITY' | 'STOCK' | 'FOREX';
    isActive: boolean;
    indexPrice: number;
    change24h: number;
    volume24h: number;
    openInterest: number;
    longOI: number;
    shortOI: number;
    fundingRate: number;
    lastUpdate?: string;
}

export interface MarketStats {
    totalVolume: number;
    totalOpenInterest: number;
    activeMarkets: number;
    totalTrades24h: number;
}

export async function fetchMarkets(): Promise<Market[]> {
    const res = await fetch(`${API_BASE}/markets`);
    const data = await res.json().catch(() => ({ success: false, data: [] }));
    if (!data.success || !Array.isArray(data.data)) return [];
    return data.data.map((m: {
        id: string; symbol: string; name: string; image: string; marketAddress: string;
        category?: string; indexPrice: string; volume24h: string; longOI: string; shortOI: string;
        fundingRate: string; isPaused?: boolean; change24h?: number;
    }) => ({
        id: m.id,
        symbol: m.symbol,
        name: m.name,
        image: m.image ?? '',
        marketAddress: m.marketAddress,
        category: (m.category as Market['category']) || 'CRYPTO',
        isActive: !m.isPaused,
        indexPrice: parseFloat(m.indexPrice),
        change24h: m.change24h ?? 0,
        volume24h: parseFloat(m.volume24h),
        openInterest: parseFloat(m.longOI) + parseFloat(m.shortOI),
        longOI: parseFloat(m.longOI),
        shortOI: parseFloat(m.shortOI),
        fundingRate: parseFloat(m.fundingRate),
    }));
}

export async function getMarket(idOrSlug: string): Promise<Market | undefined> {
    const markets = await fetchMarkets();
    return markets.find(m => m.id === idOrSlug || m.symbol === idOrSlug || m.marketAddress.toLowerCase() === idOrSlug.toLowerCase());
}

export async function getMarketStats(): Promise<MarketStats> {
    const res = await fetch(`${API_BASE}/stats`);
    const data = await res.json().catch(() => ({ success: false, data: null }));
    if (!data.success || !data.data) {
        return { totalVolume: 0, totalOpenInterest: 0, activeMarkets: 0, totalTrades24h: 0 };
    }
    const s = data.data;
    return {
        totalVolume: parseFloat(s.volume24h ?? '0'),
        totalOpenInterest: parseFloat(s.totalOpenInterest ?? '0'),
        activeMarkets: Number(s.totalMarkets ?? 0),
        totalTrades24h: 0, // Not exposed by current stats endpoint
    };
}

export async function searchMarkets(query: string): Promise<Market[]> {
    const markets = await fetchMarkets();
    const q = query.toLowerCase();
    return markets.filter(m =>
        m.name.toLowerCase().includes(q) || m.symbol.toLowerCase().includes(q)
    );
}

export async function getMarketPriceHistory(marketId: string, periodOrDays: string | number = 7): Promise<{ timestamp: number; price: number }[]> {
    const days = typeof periodOrDays === 'number' ? periodOrDays : (parseInt(String(periodOrDays), 10) || 7);
    const res = await fetch(`${API_BASE}/markets/price-history/${encodeURIComponent(marketId)}?days=${days}`);
    const data = await res.json().catch(() => ({ success: false, data: [] }));
    if (!data.success || !Array.isArray(data.data)) return [];
    return data.data.map((p: { timestamp: number; value: number }) => ({ timestamp: p.timestamp, price: p.value }));
}
