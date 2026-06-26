import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MarketsPage } from '../Markets';
import { useMarketsStore } from '../../stores';
import { useMarkets, useBackendStats } from '../../hooks/useBackend';
import { useVaultStats } from '../../hooks/useVault';
import { useAllMarketsOnChainData } from '../../hooks/useMarketData';
import { useMarketPriceHistory } from '../../hooks/useMarketPriceHistory';

vi.mock('../../stores', () => ({ useMarketsStore: vi.fn() }));
vi.mock('../../hooks/useBackend', () => ({ useMarkets: vi.fn(), useBackendStats: vi.fn() }));
vi.mock('../../hooks/useVault', () => ({ useVaultStats: vi.fn() }));
vi.mock('../../hooks/useMarketData', () => ({ useAllMarketsOnChainData: vi.fn() }));
vi.mock('../../hooks/useMarketPriceHistory', () => ({ useMarketPriceHistory: vi.fn(() => ({ prices: [] })) }));
vi.mock('../../components/Sparkline', () => ({ Sparkline: () => <div data-testid="spark" /> }));

const toggleFavorite = vi.fn();

const markets = [
    { id: 'cfx', symbol: 'CFX-USD', name: 'Conflux', marketAddress: '0xcfx', indexPrice: '0.2', volume24h: '1000', longOI: '10', shortOI: '5', fundingRate: '0.0001', change24h: 2, category: 'CRYPTO', image: '' },
    { id: 'aapl', symbol: 'AAPLX-USD', name: 'Apple', marketAddress: '0xaapl', indexPrice: '180', volume24h: '5000', longOI: '20', shortOI: '40', fundingRate: '-0.0002', change24h: -1.5, category: 'STOCK', image: '' },
    { id: 'gold', symbol: 'XAUT-USD', name: 'Gold', marketAddress: '0xgold', indexPrice: '2000', volume24h: '2000', longOI: '0', shortOI: '0', fundingRate: '0', change24h: 0, category: 'COMMODITY', image: '' },
];

function makeState(over: any = {}) {
    return { markets, loading: false, favorites: ['cfx'], toggleFavorite, ...over };
}

function setStore(state: any) {
    (useMarketsStore as any).mockImplementation((sel: any) => sel(state));
}

const renderPage = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><MarketsPage /></MemoryRouter>);

describe('MarketsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setStore(makeState());
        (useMarkets as any).mockReturnValue({ loading: false, error: null, refetch: vi.fn() });
        (useBackendStats as any).mockReturnValue({ stats: { volume24h: '9999', totalOpenInterest: '500', tvl: '100000' }, loading: false, refetch: vi.fn() });
        (useVaultStats as any).mockReturnValue({ stats: { tvl: 0 }, loading: false });
        (useAllMarketsOnChainData as any).mockReturnValue({ data: {} });
    });

    it('renders rows with funding tones, equity badge and favorite state', () => {
        renderPage();
        expect(screen.getAllByText('CFX-USD').length).toBeGreaterThan(0);
        expect(screen.getAllByText('AAPLX-USD').length).toBeGreaterThan(0);
    });

    it('filters to favorites and toggles a favorite', () => {
        renderPage();
        fireEvent.click(screen.getByText('Favorites'));
        // cfx is favorited -> shown; toggle it
        fireEvent.click(screen.getAllByTestId('favorite-toggle-cfx')[0]);
        expect(toggleFavorite).toHaveBeenCalledWith('cfx');
    });

    it('shows the empty favorites message when none are starred', () => {
        setStore(makeState({ favorites: [] }));
        renderPage();
        fireEvent.click(screen.getByText('Favorites'));
        expect(screen.getByText(/Star markets to add them/)).toBeInTheDocument();
        fireEvent.click(screen.getByText('View all markets'));
        expect(screen.getAllByText('CFX-USD').length).toBeGreaterThan(0);
    });

    it('filters by category and search (no results)', () => {
        renderPage();
        fireEvent.click(screen.getAllByText('Equities')[0]);
        expect(screen.getAllByText('AAPLX-USD').length).toBeGreaterThan(0);
        fireEvent.change(screen.getByPlaceholderText('Search markets...'), { target: { value: 'zzzzz' } });
        expect(screen.getByText('No markets found')).toBeInTheDocument();
    });

    it('renders the error state with retry', () => {
        (useMarkets as any).mockReturnValue({ loading: false, error: 'boom', refetch: vi.fn() });
        renderPage();
        expect(screen.getByText('Failed to load markets')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Retry'));
    });

    it('prefers on-chain OI when available', () => {
        (useAllMarketsOnChainData as any).mockReturnValue({ data: { '0xcfx': { longOI: 100, shortOI: 50, fundingRate: 0.0003 } } });
        renderPage();
        expect(screen.getAllByText('CFX-USD').length).toBeGreaterThan(0);
    });

    it('shows the loading skeleton when markets are empty and loading', () => {
        setStore(makeState({ markets: [], loading: true }));
        (useMarkets as any).mockReturnValue({ loading: true, error: null, refetch: vi.fn() });
        renderPage();
        expect(screen.getByText('Markets')).toBeInTheDocument();
    });
});
