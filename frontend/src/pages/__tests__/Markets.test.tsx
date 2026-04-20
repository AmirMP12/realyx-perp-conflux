import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarketsPage } from '../Markets';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { useMarketsStore } from '../../stores';
import { useMarkets, useBackendStats } from '../../hooks/useBackend';
import { useVaultStats } from '../../hooks/useVault';

// Mock the components used in MarketsPage
vi.mock('../../components/Sparkline', () => ({
    Sparkline: () => <div data-testid="sparkline">Sparkline</div>
}));

vi.mock('../../components/ui/Skeleton', () => ({
    Skeleton: ({ className }: { className: string }) => <div className={className} data-testid="skeleton" />
}));

vi.mock('../../hooks/useMarketPriceHistory', () => ({
    useMarketPriceHistory: () => ({ history: [], loading: false })
}));

// Mock hooks
vi.mock('../../hooks/useBackend', () => ({
    useMarkets: vi.fn(),
    useBackendStats: vi.fn(),
}));

vi.mock('../../hooks/useVault', () => ({
    useVaultStats: vi.fn(),
}));

// Mock store
vi.mock('../../stores', () => ({
    useMarketsStore: vi.fn(),
}));

const mockMarkets = [
    {
        id: 'ETH-USD',
        symbol: 'ETH-USD',
        name: 'Ethereum',
        indexPrice: 2000,
        volume24h: 1000000,
        longOI: 500000,
        shortOI: 400000,
        fundingRate: 0.0001,
        change24h: 5.2,
        marketAddress: '0x123',
        image: 'eth.png',
        category: 'CRYPTO'
    },
    {
        id: 'BTC-USD',
        symbol: 'BTC-USD',
        name: 'Bitcoin',
        indexPrice: 50000,
        volume24h: 2000000,
        longOI: 1000000,
        shortOI: 800000,
        fundingRate: -0.0002,
        change24h: -1.5,
        marketAddress: '0x456',
        image: 'btc.png',
        category: 'CRYPTO'
    }
];

describe('MarketsPage', () => {
    const mockFavorites: string[] = [];
    const toggleFavoriteSpy = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Default Store Mock
        vi.mocked(useMarketsStore).mockImplementation((selector: any) => {
            const state = {
                markets: mockMarkets,
                loading: false,
                favorites: mockFavorites,
                toggleFavorite: toggleFavoriteSpy
            };
            return selector(state);
        });

        // Default Backend Hook Mocks
        vi.mocked(useMarkets).mockReturnValue({
            loading: false,
            error: null,
            refetch: vi.fn(),
        } as any);

        vi.mocked(useBackendStats).mockReturnValue({
            stats: { volume24h: 3000000, totalOpenInterest: 2700000 },
            loading: false,
            refetch: vi.fn(),
        } as any);

        vi.mocked(useVaultStats).mockReturnValue({
            stats: { tvl: 10000000 },
            loading: false,
        } as any);
    });

    const renderWithRouter = (ui: React.ReactElement) => {
        return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>);
    };

    it('renders markets list correctly', () => {
        renderWithRouter(<MarketsPage />);
        expect(screen.getAllByText('ETH-USD')[0]).toBeInTheDocument();
        expect(screen.getAllByText('BTC-USD')[0]).toBeInTheDocument();
        expect(screen.getAllByText('Ethereum')[0]).toBeInTheDocument();
    });

    it('filters markets by search input', async () => {
        const user = userEvent.setup();
        renderWithRouter(<MarketsPage />);
        
        const searchInput = screen.getByPlaceholderText(/Search markets/i);
        await user.type(searchInput, 'ETH');
        
        expect(screen.getAllByText('ETH-USD')[0]).toBeInTheDocument();
        expect(screen.queryByText('BTC-USD')).toBeNull();
    });

    it('toggles favorites filter', async () => {
        const user = userEvent.setup();
        // Mock favorites state
        vi.mocked(useMarketsStore).mockImplementation((selector: any) => {
            const state = {
                markets: mockMarkets,
                loading: false,
                favorites: ['ETH-USD'],
                toggleFavorite: toggleFavoriteSpy
            };
            return selector(state);
        });

        renderWithRouter(<MarketsPage />);
        
        const favoritesFilter = screen.getByRole('button', { name: /Favorites/i });
        await user.click(favoritesFilter);
        
        expect(screen.getAllByText('ETH-USD')[0]).toBeInTheDocument();
        expect(screen.queryByText('BTC-USD')).toBeNull();
    });

    it('calls toggleFavorite when clicking star icon', async () => {
        const user = userEvent.setup();
        renderWithRouter(<MarketsPage />);
        
        const toggleBtn = screen.getByTestId('favorite-toggle-ETH-USD');
        await user.click(toggleBtn);
        
        expect(toggleFavoriteSpy).toHaveBeenCalledWith('ETH-USD');
    });

    it('displays protocol stats correctly', () => {
        renderWithRouter(<MarketsPage />);
        expect(screen.getByText(/\$10m/i)).toBeInTheDocument(); // TVL
        expect(screen.getByText(/\$3m/i)).toBeInTheDocument();  // Volume
    });

    it('renders loading skeletons when data is fetching', () => {
        vi.mocked(useMarketsStore).mockImplementation((selector: any) => {
            const state = { markets: [], loading: true, favorites: [], toggleFavorite: vi.fn() };
            return selector(state);
        });
        
        renderWithRouter(<MarketsPage />);
        const skeletons = screen.getAllByTestId('skeleton');
        expect(skeletons.length).toBeGreaterThan(0);
    });
});
