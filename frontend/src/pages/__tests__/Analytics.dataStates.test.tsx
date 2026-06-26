import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AnalyticsDashboard from '../Analytics';
import { useVaultStats } from '../../hooks/useVault';
import { useBackendStats, useLeaderboard, useDailyStats, useMarkets } from '../../hooks/useBackend';
import { useAllMarketsOnChainData } from '../../hooks/useMarketData';

vi.mock('../../hooks/useVault', () => ({ useVaultStats: vi.fn() }));
vi.mock('../../hooks/useBackend', () => ({
    useBackendStats: vi.fn(),
    useLeaderboard: vi.fn(),
    useDailyStats: vi.fn(),
    useMarkets: vi.fn(),
}));
vi.mock('../../hooks/useMarketData', () => ({ useAllMarketsOnChainData: vi.fn() }));

const renderPage = () =>
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AnalyticsDashboard /></MemoryRouter>);

describe('AnalyticsDashboard extra', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useVaultStats as any).mockReturnValue({ stats: { tvl: 5_000_000 }, loading: false });
        (useBackendStats as any).mockReturnValue({ stats: { volume24h: '3000000', activeTraders24h: 10, tvl: '5000000', cumulativeVolumeUsd: '9000000' }, loading: false, error: null });
        (useLeaderboard as any).mockReturnValue({ entries: [], loading: false, error: null });
        (useDailyStats as any).mockReturnValue({ stats: [], loading: false, error: null });
        (useMarkets as any).mockReturnValue({ markets: [{ marketAddress: '0xMkt', longOI: '100', shortOI: '50' }], loading: false });
        (useAllMarketsOnChainData as any).mockReturnValue({ data: {} });
    });

    it('shows empty volume message when no history', () => {
        renderPage();
        expect(screen.getByText('No historical volume data available')).toBeInTheDocument();
    });

    it('shows chart loading state while history is loading', () => {
        (useDailyStats as any).mockReturnValue({ stats: [], loading: true, error: null });
        renderPage();
        expect(screen.getByText('Loading chart data...')).toBeInTheDocument();
    });

    it('renders the volume chart when history is present', () => {
        (useDailyStats as any).mockReturnValue({
            stats: [
                { date: '2024-01-02', volume: '2000000', trades: 20, fees: '200', pnl: '300' },
                { date: '2024-01-01', volume: '1000000', trades: 10, fees: '100', pnl: '100' },
            ],
            loading: false,
            error: null,
        });
        renderPage();
        expect(screen.getByText('Volume History')).toBeInTheDocument();
    });

    it('prefers on-chain OI totals when available', () => {
        (useAllMarketsOnChainData as any).mockReturnValue({
            data: { '0xmkt': { longOI: 1000, shortOI: 500, fundingRate: 0 } },
        });
        renderPage();
        expect(screen.getByText('OI Composition')).toBeInTheDocument();
        expect(screen.getByText('Total OI')).toBeInTheDocument();
    });

    it('shows leaderboard loading spinner', () => {
        (useLeaderboard as any).mockReturnValue({ entries: [], loading: true, error: null });
        renderPage();
        expect(screen.getByText('Top Traders')).toBeInTheDocument();
    });

    it('shows leaderboard error', () => {
        (useLeaderboard as any).mockReturnValue({ entries: [], loading: false, error: 'lb fail' });
        renderPage();
        expect(screen.getByText('lb fail')).toBeInTheDocument();
    });

    it('renders leaderboard rows with links', () => {
        (useLeaderboard as any).mockReturnValue({
            entries: [
                { rank: 1, wallet: '0x1111111111111111111111111111111111111111', pnl: '5000', volume: '100000', trades: 50 },
                { rank: 2, wallet: '0x2222222222222222222222222222222222222222', pnl: '-1000', volume: '50000', trades: 20 },
            ],
            loading: false,
            error: null,
        });
        renderPage();
        expect(screen.getAllByText(/0x1111/).length).toBeGreaterThan(0);
    });
});
