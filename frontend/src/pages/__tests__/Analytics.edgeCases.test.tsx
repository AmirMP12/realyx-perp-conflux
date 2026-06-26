import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AnalyticsDashboard from '../Analytics';
import { useVaultStats } from '../../hooks/useVault';
import { useBackendStats, useLeaderboard, useDailyStats, useMarkets } from '../../hooks/useBackend';
import { useAllMarketsOnChainData } from '../../hooks/useMarketData';

vi.mock('../../hooks/useVault', () => ({ useVaultStats: vi.fn() }));
vi.mock('../../hooks/useBackend', () => ({ useBackendStats: vi.fn(), useLeaderboard: vi.fn(), useDailyStats: vi.fn(), useMarkets: vi.fn() }));
vi.mock('../../hooks/useMarketData', () => ({ useAllMarketsOnChainData: vi.fn() }));
vi.mock('../../components/ui', () => ({ Skeleton: () => <div data-testid="skeleton" /> }));

// Render the Tooltip `content` with a payload entry that has NO `value`, so
// CustomTooltip uses the `(entry.value ?? 0)` fallback.
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    BarChart: ({ children }: any) => <div>{children}</div>,
    Bar: () => null,
    PieChart: ({ children }: any) => <div>{children}</div>,
    Pie: () => null,
    Cell: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: ({ content }: any) =>
        content
            ? React.cloneElement(content, { active: true, label: 'Jan 15', payload: [{ name: 'Volume', color: '#fff' }] })
            : null,
}));

const renderPage = () =>
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AnalyticsDashboard /></MemoryRouter>);

describe('AnalyticsDashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useVaultStats as any).mockReturnValue({ stats: { tvl: 5_000_000 }, loading: false });
        (useBackendStats as any).mockReturnValue({ stats: { volume24h: '3000000', activeTraders24h: 10, tvl: '5000000', cumulativeVolumeUsd: '9000000' }, loading: false, error: null });
        (useLeaderboard as any).mockReturnValue({ entries: [], loading: false, error: null });
        (useDailyStats as any).mockReturnValue({
            stats: [{ date: '2024-01-01', volume: '1000000', trades: 10, fees: '100', pnl: '100' }],
            loading: false,
            error: null,
        });
        (useMarkets as any).mockReturnValue({ markets: [{ marketAddress: '0xMkt', longOI: '100', shortOI: '50' }], loading: false });
        (useAllMarketsOnChainData as any).mockReturnValue({ data: { '0xmkt': { longOI: 1000, shortOI: 500, fundingRate: 0 } } });
    });

    it('renders the tooltip value fallback ($0) when a payload entry has no value', () => {
        renderPage();
        // `(entry.value ?? 0)` -> 0 -> "$0" currency formatting
        expect(screen.getAllByText(/Volume:\s*\$0/).length).toBeGreaterThan(0);
    });

    it('falls back to backend TVL when the vault TVL is zero', () => {
        (useVaultStats as any).mockReturnValue({ stats: { tvl: 0 }, loading: false });
        (useBackendStats as any).mockReturnValue({
            stats: { volume24h: '3000000', activeTraders24h: 10, tvl: '7000000', cumulativeVolumeUsd: '9000000' },
            loading: false,
            error: null,
        });
        renderPage();
        expect(screen.getByText('$7m')).toBeInTheDocument();
    });

    it('shows the TVL skeleton when both vault and backend TVL are absent and loading', () => {
        (useVaultStats as any).mockReturnValue({ stats: {}, loading: true });
        (useBackendStats as any).mockReturnValue({ stats: null, loading: true, error: null });
        renderPage();
        expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    });

    it('renders $0 for a non-finite (NaN) volume stat', () => {
        (useBackendStats as any).mockReturnValue({
            stats: { volume24h: 'not-a-number', activeTraders24h: 10, tvl: '5000000', cumulativeVolumeUsd: '9000000' },
            loading: false,
            error: null,
        });
        renderPage();
        // 24h Volume card -> formatUsdStat(NaN) -> formatCompact(0) -> "$0"
        expect(screen.getAllByText('$0').length).toBeGreaterThan(0);
    });

    it('applies the rank-3 medal styling in the leaderboard', () => {
        (useLeaderboard as any).mockReturnValue({
            entries: [
                { rank: 1, wallet: '0x1111111111111111111111111111111111111111', pnl: '5000', volume: '100000', trades: 50 },
                { rank: 2, wallet: '0x2222222222222222222222222222222222222222', pnl: '-1000', volume: '50000', trades: 20 },
                { rank: 3, wallet: '0x3333333333333333333333333333333333333333', pnl: '250', volume: '25000', trades: 12 },
                { rank: 4, wallet: '0x4444444444444444444444444444444444444444', pnl: '10', volume: '1000', trades: 2 },
            ],
            loading: false,
            error: null,
        });
        renderPage();
        // rank 3 and rank 4 rows exercise the orange and default medal styles.
        expect(screen.getAllByText(/0x3333/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/0x4444/).length).toBeGreaterThan(0);
    });
});
