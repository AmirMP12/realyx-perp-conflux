import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

let mockParams: any = { marketId: 'ETH' };
let mockSearch = '';
vi.mock('react-router-dom', () => ({
    useParams: () => mockParams,
    useLocation: () => ({ search: mockSearch }),
}));

let marketsState: any[] = [];
let optimisticState: any[] = [];
vi.mock('../../stores', () => ({
    useMarketsStore: (sel: any) => sel({ markets: marketsState }),
    usePositionsStore: (sel: any) => sel({ optimisticPositions: optimisticState }),
}));
vi.mock('../../stores/layoutStore', () => ({
    useLayoutStore: () => ({ positionPanelHeight: 300 }),
}));

vi.mock('../../utils/market', () => ({ applyMarketDisplayFallback: (m: any) => m }));

vi.mock('../../hooks/useMarketData', () => ({
    useSingleMarketData: vi.fn(() => ({ formatted: { price: 2500, longOI: 100, shortOI: 50, fundingRate: 0.0001 }, isLoading: false })),
}));
vi.mock('../../hooks/usePriceFeed', () => ({
    usePriceFeed: vi.fn(() => ({ price: 2500, source: 'pyth', ageMs: 100, isStale: false, refresh: vi.fn() })),
}));
vi.mock('../../hooks/usePositions', () => ({
    usePositions: vi.fn(() => ({ positions: [], refetch: vi.fn(), isLoading: false })),
}));
vi.mock('../../hooks/useOnChainHistory', () => ({
    useOnChainHistory: vi.fn(() => ({ data: [{ market: '0xMarketEth', signature: 'sig1', timestamp: '2024-01-02', id: 1 }] })),
}));
vi.mock('../../hooks/useWebSocket', () => ({
    useLivePnL: vi.fn((p: any[]) => p),
}));
vi.mock('../../hooks/useBackend', () => ({
    useTradeHistory: vi.fn(() => ({ trades: [{ market: 'ETH', signature: 'sig2', timestamp: '2024-01-01', id: 2 }], loading: false })),
}));

// Stub heavy child components.
vi.mock('../../components/trading/MarketHeader', () => ({
    MarketHeader: ({ market, currentPrice }: any) => <div data-testid="market-header">{market?.symbol}:{currentPrice}</div>,
}));
vi.mock('../../components/trading/TradingForm', () => ({ TradingForm: () => <div data-testid="trading-form" /> }));
vi.mock('../../components/trading/PositionTable', () => ({
    PositionTable: ({ tradeHistory }: any) => <div data-testid="position-table">{tradeHistory.length}</div>,
}));
vi.mock('../../components/trading/MobileControls', () => ({ MobileControls: ({ activeTab }: any) => <div data-testid="mobile-controls">{activeTab}</div> }));
vi.mock('../../components/trading/ChartPanel', () => ({ ChartPanel: () => <div data-testid="chart-panel" /> }));
vi.mock('../../components/trading/MarketLiquidityPanel', () => ({ MarketLiquidityPanel: () => <div data-testid="liquidity" /> }));
vi.mock('../../components/trading/FundingComparePanel', () => ({ FundingComparePanel: () => <div data-testid="funding" /> }));
vi.mock('../../components/trading/CopyTradersStrip', () => ({ CopyTradersStrip: () => <div data-testid="copy-strip" /> }));

import { TradingPage } from '../Trading';

const ethMarket = {
    id: 'eth', symbol: 'ETH', name: 'Ethereum', image: '/eth.png', category: 'CRYPTO',
    marketAddress: '0xMarketEth', indexPrice: 2490, change24h: 1.2, volume24h: 1e8, openInterest: 1e7,
    longOI: 0, shortOI: 0, fundingRate: 0,
};

describe('TradingPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockParams = { marketId: 'ETH' };
        mockSearch = '';
        marketsState = [ethMarket];
        optimisticState = [];
    });

    it('shows loading state when no markets are available', () => {
        marketsState = [];
        render(<TradingPage />);
        expect(screen.getByLabelText('Loading market')).toBeInTheDocument();
    });

    it('renders the full trading layout for a market', () => {
        render(<TradingPage />);
        expect(screen.getByTestId('market-header')).toHaveTextContent('ETH:2500');
        expect(screen.getByTestId('trading-form')).toBeInTheDocument();
        expect(screen.getByTestId('chart-panel')).toBeInTheDocument();
    });

    it('merges and de-duplicates on-chain and backend trade history', () => {
        render(<TradingPage />);
        // one on-chain (sig1) + one backend (sig2) = 2 unique
        expect(screen.getByTestId('position-table')).toHaveTextContent('2');
    });

    it('honors the ?tab=trade query parameter', () => {
        mockSearch = '?tab=trade';
        render(<TradingPage />);
        expect(screen.getByTestId('mobile-controls')).toHaveTextContent('trade');
    });

    it('falls back to the first market when marketId is unknown', () => {
        mockParams = { marketId: 'NOPE' };
        render(<TradingPage />);
        expect(screen.getByTestId('market-header')).toHaveTextContent('ETH');
    });
});
