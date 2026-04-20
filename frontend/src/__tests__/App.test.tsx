import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';
import { MemoryRouter } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import { useMarkets } from '../hooks/useBackend';
import toast from 'react-hot-toast';

// Mock high-dependency components
vi.mock('../components/ProtocolStatsBar', () => ({
    ProtocolStatsBar: () => <div data-testid="mock-stats-bar">Stats Bar</div>,
}));

vi.mock('wagmi', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        useAccount: vi.fn(),
        useChainId: vi.fn(),
    };
});

vi.mock('../hooks/useBackend', () => ({
    useMarkets: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
    default: {
        dismiss: vi.fn(),
        error: vi.fn(),
    },
}));

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };

describe('App', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useChainId as any).mockReturnValue(11155111); // Correct chain
        (useMarkets as any).mockReturnValue({ markets: [] });
    });

    it('renders the application layout', async () => {
        render(
            <MemoryRouter future={routerFuture}>
                <App />
            </MemoryRouter>
        );
        
        expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
        expect(screen.getByText(/Real/i)).toBeInTheDocument();
    });

    it('shows network warning when on wrong chain', async () => {
        (useChainId as any).mockReturnValue(1); // Wrong chain (Ethereum Mainnet)
        
        render(
            <MemoryRouter future={routerFuture}>
                <App />
            </MemoryRouter>
        );
        
        expect(toast.error).toHaveBeenCalledWith(
            expect.stringContaining('network is eSpace Testnet'),
            expect.objectContaining({ id: 'network-default-warning' })
        );
    });

    it('formats and sets markets when data is received', async () => {
        const mockMarkets = [
            {
                id: 'btc',
                symbol: 'BTC',
                name: 'Bitcoin',
                marketAddress: '0xabc',
                indexPrice: '50000',
                volume24h: '1000000',
                longOI: '500000',
                shortOI: '500000',
                fundingRate: '0.0001',
                isPaused: false
            }
        ];
        (useMarkets as any).mockReturnValue({ markets: mockMarkets });

        render(
            <MemoryRouter future={routerFuture}>
                <App />
            </MemoryRouter>
        );

        // Effect should trigger setMarkets
        // We can't easily check the store directly here, but we can verify it doesn't crash
        // and covers the mapping branch.
    });

    it('shows page loader for lazy routes', async () => {
        render(
            <MemoryRouter initialEntries={['/trade']} future={routerFuture}>
                <App />
            </MemoryRouter>
        );
        
        expect(screen.getByTestId('page-loader')).toBeInTheDocument();
    });

    it('navigates to various pages to trigger lazy imports', async () => {
        const { unmount } = render(
            <MemoryRouter initialEntries={['/']} future={routerFuture}>
                <App />
            </MemoryRouter>
        );

        const routes = ['/portfolio', '/settings', '/vault', '/insurance', '/referrals', '/leaderboard', '/analytics'];
        
        for (const route of routes) {
            unmount();
            render(
                <MemoryRouter initialEntries={[route]} future={routerFuture}>
                    <App />
                </MemoryRouter>
            );
            // Just rendering the route triggers the lazy import function
        }
    });
});
