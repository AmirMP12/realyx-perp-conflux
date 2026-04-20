import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AnalyticsDashboard from '../Analytics';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { useVaultStats } from '../../hooks/useVault';
import { useBackendStats, useLeaderboard, useDailyStats, useMarkets } from '../../hooks/useBackend';

// Mock hooks
vi.mock('../../hooks/useVault', () => ({
    useVaultStats: vi.fn(),
}));

vi.mock('../../hooks/useBackend', () => ({
    useBackendStats: vi.fn(),
    useLeaderboard: vi.fn(),
    useDailyStats: vi.fn(),
    useMarkets: vi.fn(),
}));

// Mock recharts
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    BarChart: ({ children }: any) => <div>{children}</div>,
    Bar: () => <div />,
    XAxis: () => <div />,
    YAxis: () => <div />,
    CartesianGrid: () => <div />,
    Tooltip: () => <div />,
    PieChart: ({ children }: any) => <div>{children}</div>,
    Pie: () => <div />,
    Cell: () => <div />,
}));

// Mock Skeleton
vi.mock('../../components/ui', () => ({
    Skeleton: () => <div data-testid="skeleton" />,
}));

describe('AnalyticsDashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(useVaultStats).mockReturnValue({
            stats: { tvl: 5000000 },
            loading: false
        } as any);

        vi.mocked(useBackendStats).mockReturnValue({
            stats: {
                volume24h: '3000000',
                activeTraders24h: 150,
                tvl: '5000000'
            },
            loading: false,
            error: null
        } as any);

        vi.mocked(useLeaderboard).mockReturnValue({
            entries: [
                { rank: 1, wallet: '0x123...456', pnl: '5000', volume: '100000', trades: 50 },
                { rank: 2, wallet: '0xabc...def', pnl: '-1000', volume: '50000', trades: 20 }
            ],
            loading: false,
            error: null
        } as any);

        vi.mocked(useDailyStats).mockReturnValue({
            stats: [
                { date: '2024-01-01', volume: '1000000', trades: 100, fees: '1000', pnl: '2000' }
            ],
            loading: false,
            error: null
        } as any);

        vi.mocked(useMarkets).mockReturnValue({
            markets: [
                { longOI: '1000000', shortOI: '500000' }
            ],
            loading: false
        } as any);
    });

    const renderWithRouter = (ui: React.ReactElement) => {
        return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>);
    };

    it('renders top stats cards correctly', () => {
        renderWithRouter(<AnalyticsDashboard />);
        expect(screen.getByText('Total Value Locked')).toBeInTheDocument();
        expect(screen.getByText('$5m')).toBeInTheDocument();
        expect(screen.getByText('Active Traders')).toBeInTheDocument();
        expect(screen.getByText('150')).toBeInTheDocument();
    });

    it('renders leaderboard entries', () => {
        renderWithRouter(<AnalyticsDashboard />);
        expect(screen.getByText('Top Traders')).toBeInTheDocument();
        // Wallet address is split by ... in the DOM
        expect(screen.getAllByText(/0x123/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/\+/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/-/).length).toBeGreaterThan(0);
    });

    it('shows error message when backend fails', () => {
        vi.mocked(useBackendStats).mockReturnValue({
            stats: null,
            loading: false,
            error: 'Failed to fetch'
        } as any);
        
        renderWithRouter(<AnalyticsDashboard />);
        expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
    });

    it('shows loading state skeletons', () => {
        vi.mocked(useVaultStats).mockReturnValue({
            stats: {},
            loading: true
        } as any);
        vi.mocked(useMarkets).mockReturnValue({
            markets: [],
            loading: true
        } as any);

        renderWithRouter(<AnalyticsDashboard />);
        expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    });
});
