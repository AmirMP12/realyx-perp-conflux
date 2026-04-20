import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PortfolioPage } from '../Portfolio';
import { MemoryRouter } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { usePositions } from '../../hooks/usePositions';
import { useOnChainHistory } from '../../hooks/useOnChainHistory';
import { useLivePnL } from '../../hooks/useWebSocket';
import { useTradeHistory } from '../../hooks/useBackend';
import { useMarketsStore, usePositionsStore } from '../../stores';
import { useSettingsStore } from '../../stores/settingsStore';

// Mock local dependencies (keep these, as they are specific to this test)
vi.mock('../../hooks/usePositions', () => ({
    usePositions: vi.fn(),
}));

vi.mock('../../hooks/useOnChainHistory', () => ({
    useOnChainHistory: vi.fn(),
}));

vi.mock('../../hooks/useWebSocket', () => ({
    useLivePnL: vi.fn(),
}));

vi.mock('../../hooks/useBackend', () => ({
    useTradeHistory: vi.fn(),
    useLeaderboard: vi.fn(),
}));

vi.mock('../../stores', () => ({
    useMarketsStore: vi.fn(),
    usePositionsStore: vi.fn(),
}));

vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: vi.fn(),
}));

vi.mock('../../components/trading/PositionTable', () => ({
    PositionTable: () => <div data-testid="mock-position-table">Mock Position Table</div>,
}));

// Mock global hooks that need specific return values for this test

const renderWithRouter = (ui: React.ReactElement) => {
    return render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            {ui}
        </MemoryRouter>
    );
};

describe('PortfolioPage', () => {
    const mockPositions = [
        { id: '1', side: 'LONG', symbol: 'BTC/USDC', size: '1000', collateral: '100', entryPrice: '50000', markPrice: '51000', pnl: '10' }
    ];

    const mockTrades = [
        { id: '1', type: 'CLOSE', market: 'BTC/USDC', side: 'LONG', size: '1000', pnl: '50', timestamp: new Date().toISOString(), signature: '0x1' }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useAccount).mockReturnValue({ address: '0x123' } as any);
        vi.mocked(usePositions).mockReturnValue({ positions: mockPositions, isLoading: false, refetch: vi.fn() } as any);
        vi.mocked(useOnChainHistory).mockReturnValue({ data: [] } as any);
        vi.mocked(useLivePnL).mockReturnValue(mockPositions);
        vi.mocked(useTradeHistory).mockReturnValue({ trades: mockTrades, loading: false, refetch: vi.fn() } as any);
        
        // Mock stores
        vi.mocked(useMarketsStore).mockReturnValue([]);
        vi.mocked(usePositionsStore).mockReturnValue({
            removePosition: vi.fn(),
            updatePosition: vi.fn(),
        } as any);
        vi.mocked(useSettingsStore).mockReturnValue({
            compactMode: false,
            slippage: 0.5,
        } as any);
    });

    it('renders connect wallet state when not connected', () => {
        vi.mocked(useAccount).mockReturnValue({ address: null } as any);
        renderWithRouter(<PortfolioPage />);
        expect(screen.getByText(/Connect Your Wallet/i)).toBeInTheDocument();
        expect(screen.getByTestId('connect-button')).toBeInTheDocument();
    });

    it('renders portfolio stats when connected', () => {
        renderWithRouter(<PortfolioPage />);
        expect(screen.getByText('Account Value')).toBeInTheDocument();
        expect(screen.getByText('Total Collateral')).toBeInTheDocument();
        expect(screen.getByText('Unrealized PnL')).toBeInTheDocument();
        expect(screen.getByText('Realized PnL')).toBeInTheDocument();
        
        // Check formatted values (approximate)
        expect(screen.getByText('$110')).toBeInTheDocument(); // 100 collateral + 10 pnl
        expect(screen.getByText('$100')).toBeInTheDocument(); // collateral
    });

    it('renders the PnL chart when trade history exists', () => {
        renderWithRouter(<PortfolioPage />);
        expect(screen.getByText('Cumulative PnL')).toBeInTheDocument();
        expect(screen.getByLabelText('Cumulative PnL over time')).toBeInTheDocument();
    });

    it('renders position table within the portfolio', () => {
        renderWithRouter(<PortfolioPage />);
        expect(screen.getByTestId('mock-position-table')).toBeInTheDocument();
    });

    it('handles transition between loading and data states', () => {
        vi.mocked(usePositions).mockReturnValue({ positions: [], isLoading: true, refetch: vi.fn() } as any);
        renderWithRouter(<PortfolioPage />);
        // Should show skeletons (we check for a few typical stat card labels while loading)
        expect(screen.queryByText('Account Value')).not.toBeInTheDocument();
    });
});
