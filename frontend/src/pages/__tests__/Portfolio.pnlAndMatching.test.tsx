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

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));
vi.mock('../../hooks/usePositions', () => ({ usePositions: vi.fn() }));
vi.mock('../../hooks/useOnChainHistory', () => ({ useOnChainHistory: vi.fn() }));
vi.mock('../../hooks/useWebSocket', () => ({ useLivePnL: vi.fn() }));
vi.mock('../../hooks/useBackend', () => ({ useTradeHistory: vi.fn() }));
vi.mock('../../hooks/useAccountRisk', () => ({ useAccountRisk: vi.fn() }));
vi.mock('../../stores', () => ({ useMarketsStore: vi.fn() }));
vi.mock('../../components/trading/PositionTable', () => ({ PositionTable: () => <div data-testid="pt" /> }));
vi.mock('../../components/CrossAssetExposure', () => ({ CrossAssetExposure: () => <div data-testid="cae" /> }));

const renderPage = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PortfolioPage /></MemoryRouter>);

describe('PortfolioPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser' });
        (useMarketsStore as any).mockReturnValue([{ marketAddress: '0xbtc', symbol: 'BTC-USD' }]);
        (useLivePnL as any).mockImplementation((p: any[]) => p.map((x) => ({ ...x, livePnl: x.isLong ? -50 : 20 })));
        (useAccountRisk as any).mockReturnValue({
            hasPositions: true, healthFactor: 1.05, crossPositionCount: 2,
            totalCollateral: 1000, unrealizedPnL: -75, maintenanceMargin: 100, totalNotional: 5000,
        });
    });

    it('handles negative pnl, on-chain match/no-match, duplicate and missing signatures', () => {
        const positions = [
            { id: '1', collateral: '100', pnl: '0', marketAddress: '0xbtc', entryPrice: '1', size: '1', isLong: true },
            { id: '2', collateral: '50', pnl: '0', marketAddress: '0xeth', entryPrice: '1', size: '1', isLong: false },
        ];
        (usePositions as any).mockReturnValue({ positions, isLoading: false, refetch: vi.fn() });
        (useOnChainHistory as any).mockReturnValue({
            data: [
                { market: '0xbtc', signature: 's1', timestamp: '2024-01-01', id: 1, type: 'CLOSE', pnl: '5' },
                { market: '0xUNKNOWN', signature: 's2', timestamp: '2024-01-02', id: 2, type: 'LIQUIDATED', pnl: '-10' },
                { market: '0xbtc', signature: 's1', timestamp: '2024-01-01', id: 1, type: 'CLOSE', pnl: '5' }, // duplicate sig
                { market: '0xbtc', signature: '', timestamp: '2024-01-03', id: 3, type: 'OPEN', pnl: null }, // no sig -> filtered
            ],
        });
        (useTradeHistory as any).mockReturnValue({
            trades: [{ id: '9', signature: 's9', timestamp: '2024-01-04', type: 'CLOSE', pnl: '7', market: 'BTC-USD' }],
            loading: false, refetch: vi.fn(),
        });
        renderPage();
        expect(screen.getByText('Portfolio')).toBeInTheDocument();
        // Account health with at-risk factor + negative unrealized pnl
        expect(screen.getByText('Health')).toBeInTheDocument();
        expect(screen.getAllByText('Unrealized PnL').length).toBeGreaterThan(0);
        expect(screen.getByTestId('cae')).toBeInTheDocument();
    });

    it('handles a single cross position label', () => {
        (useAccountRisk as any).mockReturnValue({
            hasPositions: true, healthFactor: Infinity, crossPositionCount: 1,
            totalCollateral: 500, unrealizedPnL: 25, maintenanceMargin: 0, totalNotional: 1000,
        });
        (usePositions as any).mockReturnValue({ positions: [{ id: '1', collateral: '100', pnl: '0', marketAddress: '0xbtc', entryPrice: '1', size: '1', isLong: false }], isLoading: false, refetch: vi.fn() });
        (useOnChainHistory as any).mockReturnValue({ data: [] });
        (useTradeHistory as any).mockReturnValue({ trades: [], loading: false, refetch: vi.fn() });
        renderPage();
        expect(screen.getByText(/1 cross position/)).toBeInTheDocument();
    });
});
