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

// Recharts mock that actually invokes tickFormatter callbacks and renders the
// Tooltip `content` with an active payload, so those callbacks get covered.
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    BarChart: ({ children }: any) => <div>{children}</div>,
    Bar: () => null,
    PieChart: ({ children }: any) => <div>{children}</div>,
    Pie: () => null,
    Cell: () => null,
    CartesianGrid: () => null,
    XAxis: ({ tickFormatter }: any) => <div data-testid="xaxis">{tickFormatter ? tickFormatter('2024-01-15') : ''}</div>,
    YAxis: ({ tickFormatter }: any) => <div data-testid="yaxis">{tickFormatter ? tickFormatter(2_000_000) : ''}</div>,
    Tooltip: ({ content }: any) =>
        content
            ? React.cloneElement(content, { active: true, label: 'Jan 15', payload: [{ name: 'Volume', value: 1234567, color: '#fff' }] })
            : null,
}));

const renderPage = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AnalyticsDashboard /></MemoryRouter>);

describe('AnalyticsDashboard chart formatters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useVaultStats as any).mockReturnValue({ stats: { tvl: 5_000_000 }, loading: false });
        (useBackendStats as any).mockReturnValue({ stats: { volume24h: '3000000', activeTraders24h: 10, tvl: '5000000', cumulativeVolumeUsd: '9000000' }, loading: false, error: null });
        (useLeaderboard as any).mockReturnValue({ entries: [], loading: false, error: null });
        (useDailyStats as any).mockReturnValue({
            stats: [
                { date: '2024-01-02', volume: '2000000', trades: 20, fees: '200', pnl: '300' },
                { date: '2024-01-01', volume: '1000000', trades: 10, fees: '100', pnl: '100' },
            ],
            loading: false,
            error: null,
        });
        (useMarkets as any).mockReturnValue({ markets: [{ marketAddress: '0xMkt', longOI: '100', shortOI: '50' }], loading: false });
        (useAllMarketsOnChainData as any).mockReturnValue({ data: { '0xmkt': { longOI: 1000, shortOI: 500, fundingRate: 0 } } });
    });

    it('invokes the axis tick formatters and the custom tooltip', () => {
        renderPage();
        // XAxis tickFormatter -> month/day
        expect(screen.getAllByTestId('xaxis')[0].textContent).toMatch(/1\/15/);
        // YAxis tickFormatter -> $2m
        expect(screen.getAllByTestId('yaxis')[0].textContent).toContain('$2m');
        // CustomTooltip rendered active with a payload -> formats the value as currency
        expect(screen.getAllByText(/Volume:/).length).toBeGreaterThan(0);
    });
});
