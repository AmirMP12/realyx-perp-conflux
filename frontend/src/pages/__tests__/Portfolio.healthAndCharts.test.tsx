import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortfolioPage } from '../Portfolio';
import { useAccount } from 'wagmi';
import { usePositions } from '../../hooks/usePositions';
import { useOnChainHistory } from '../../hooks/useOnChainHistory';
import { useLivePnL } from '../../hooks/useWebSocket';
import { useTradeHistory } from '../../hooks/useBackend';
import { useAccountRisk } from '../../hooks/useAccountRisk';
import { useMarketsStore } from '../../stores';

vi.mock('../../hooks/usePositions', () => ({ usePositions: vi.fn() }));
vi.mock('../../hooks/useOnChainHistory', () => ({ useOnChainHistory: vi.fn() }));
vi.mock('../../hooks/useWebSocket', () => ({ useLivePnL: vi.fn() }));
vi.mock('../../hooks/useBackend', () => ({ useTradeHistory: vi.fn() }));
vi.mock('../../hooks/useAccountRisk', () => ({ useAccountRisk: vi.fn() }));
vi.mock('../../stores', () => ({ useMarketsStore: vi.fn() }));
vi.mock('../../components/trading/PositionTable', () => ({ PositionTable: () => <div data-testid="pt" /> }));
vi.mock('../../components/CrossAssetExposure', () => ({ CrossAssetExposure: () => <div data-testid="cross-asset" /> }));

const renderPage = () =>
    render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <PortfolioPage />
        </MemoryRouter>,
    );

const noRisk = { hasPositions: false, healthFactor: Infinity, crossPositionCount: 0, totalCollateral: 0, unrealizedPnL: 0, maintenanceMargin: 0, totalNotional: 0 };

describe('PortfolioPage extra', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser' });
        (useOnChainHistory as any).mockReturnValue({ data: [] });
        (useLivePnL as any).mockImplementation((p: any[]) => p);
        (useMarketsStore as any).mockReturnValue([]);
        (useAccountRisk as any).mockReturnValue(noRisk);
    });

    it('renders account health and cross-asset exposure when positions exist', () => {
        const positions = [{ id: '1', collateral: '100', pnl: '5', marketAddress: '0xm', entryPrice: '1', size: '1', isLong: true }];
        (usePositions as any).mockReturnValue({ positions, isLoading: false, refetch: vi.fn() });
        (useTradeHistory as any).mockReturnValue({ trades: [], loading: false, refetch: vi.fn() });
        (useAccountRisk as any).mockReturnValue({
            hasPositions: true, healthFactor: 2, crossPositionCount: 2,
            totalCollateral: 1000, unrealizedPnL: 50, maintenanceMargin: 100, totalNotional: 5000,
        });
        renderPage();
        expect(screen.getByText('Health')).toBeInTheDocument();
        expect(screen.getByText('Equity')).toBeInTheDocument();
        expect(screen.getByText('Maint. Margin')).toBeInTheDocument();
        expect(screen.getByTestId('cross-asset')).toBeInTheDocument();
    });

    it('renders empty state when no positions and no history', () => {
        (usePositions as any).mockReturnValue({ positions: [], isLoading: false, refetch: vi.fn() });
        (useTradeHistory as any).mockReturnValue({ trades: [], loading: false, refetch: vi.fn() });
        renderPage();
        expect(screen.getByText('No positions yet')).toBeInTheDocument();
        expect(screen.getByText('Open your first trade')).toBeInTheDocument();
    });

    it('builds cumulative PnL chart from realized (CLOSE/LIQUIDATED) trades', () => {
        (usePositions as any).mockReturnValue({ positions: [], isLoading: false, refetch: vi.fn() });
        (useOnChainHistory as any).mockReturnValue({
            data: [{ market: '0xabc', signature: 'oc1', timestamp: '2024-01-01', id: 9, type: 'OPEN', pnl: null }],
        });
        (useTradeHistory as any).mockReturnValue({
            trades: [
                { id: '1', type: 'CLOSE', signature: 's1', timestamp: '2024-01-02', pnl: '50', market: 'BTC' },
                { id: '2', type: 'LIQUIDATED', signature: 's2', timestamp: '2024-01-03', pnl: '-20', market: 'ETH' },
            ],
            loading: false,
            refetch: vi.fn(),
        });
        renderPage();
        expect(screen.getByText('Cumulative PnL')).toBeInTheDocument();
        expect(screen.getByText('Realized PnL')).toBeInTheDocument();
    });
});
