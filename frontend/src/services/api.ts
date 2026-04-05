import axios from 'axios';
import { getApiBaseUrl } from '../config/api';

const API_BASE = getApiBaseUrl();

export const api = axios.create({
    baseURL: API_BASE,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
});

export interface Market {
    id: string;
    name: string;
    symbol: string;
    indexPrice: number;
    change24h: number;
    volume24h: number;
    longOI: number;
    shortOI: number;
    fundingRate: number;
    lastUpdate: string;
    marketAddress: string;
}

export interface Position {
    id: number;
    market: string;
    side: 'LONG' | 'SHORT';
    size: number;
    entryPrice: number;
    currentPrice: number;
    margin: number;
    leverage: number;
    pnl: number;
    pnlPercent: number;
    liquidationPrice: number;
}



export interface TradeHistory {
    id: number;
    market: string;
    type: 'OPEN' | 'CLOSE' | 'LIQUIDATED';
    side: 'LONG' | 'SHORT';
    size: number;
    price: number;
    pnl: number | null;
    time: string;
    txHash: string;
}

export const marketsApi = {
    getAll: () => api.get<Market[]>('/markets'),
    getById: (id: string) => api.get<Market>(`/markets/${id}`),
    getStats: () => api.get<{ totalVolume: number; openInterest: number; traders: number; fees: number }>('/markets/stats'),
};

export const positionsApi = {
    getByWallet: (wallet: string) => api.get<Position[]>(`/positions?wallet=${wallet}`),
    open: (data: { market: string; side: string; size: number; margin: number; leverage: number }) =>
        api.post<Position>('/positions/open', data),
    close: (id: number) => api.post(`/positions/${id}/close`),
    modifyMargin: (id: number, amount: number) => api.post(`/positions/${id}/margin`, { amount }),
};



export const historyApi = {
    getByWallet: (wallet: string) => api.get<TradeHistory[]>(`/history?wallet=${wallet}`),
};

export const statsApi = {
    getProtocol: () => api.get<{
        tvl: number;
        volume24h: number;
        markets: number;
        protocolFee: number;
        liquidationFee: number;
    }>('/stats/protocol'),
};
