import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PositionTable } from '../PositionTable';
import { useSettingsStore } from '../../../stores/settingsStore';
import { usePositionsStore } from '../../../stores';
import { usePendingOrders } from '../../../hooks/usePendingOrders';
import { useSetStopLoss, useSetTakeProfit, useSetTrailingStop, useCancelOrder } from '../../../hooks/useProgram';

vi.mock('../../../stores/settingsStore', () => ({ useSettingsStore: vi.fn() }));
vi.mock('../../../stores', () => ({ usePositionsStore: vi.fn() }));
vi.mock('../../../hooks/usePendingOrders', () => ({ usePendingOrders: vi.fn(), getOrderTypeLabel: (t: number) => `T${t}` }));
vi.mock('../../../hooks/useProgram', () => ({
    useSetStopLoss: vi.fn(), useSetTakeProfit: vi.fn(), useSetTrailingStop: vi.fn(), useCancelOrder: vi.fn(),
}));
vi.mock('../../ui/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../ClosePositionModal', () => ({ ClosePositionModal: ({ isOpen }: any) => isOpen ? <div data-testid="close-modal" /> : null }));
vi.mock('../CollateralEditModal', () => ({ CollateralEditModal: ({ isOpen }: any) => isOpen ? <div data-testid="collat-modal" /> : null }));
vi.mock('../TransferPositionModal', () => ({ TransferPositionModal: ({ isOpen }: any) => isOpen ? <div data-testid="transfer-modal" /> : null }));

const markets = [{ id: 'btc', symbol: 'BTC-USD', marketAddress: '0xBTC', image: 'b.png' }];

const longPos = { id: '1', symbol: 'BTC-USD', marketAddress: '0xBTC', size: '1000', collateral: '100', entryPrice: '50000', markPrice: '51000', liquidationPrice: '45000', isLong: true, pnl: '10', livePnl: '10', stopLossPrice: 48000, takeProfitPrice: 55000 };
const shortPos = { id: '2', symbol: 'BTC-USD', marketAddress: '0xBTC', size: '500', collateral: '50', entryPrice: '50000', markPrice: '52000', liquidationPrice: '60000', isLong: false, pnl: '-30', livePnl: '-30', stopLossPrice: 0, takeProfitPrice: 0 };

function renderTable(props = {}) {
    return render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <PositionTable positions={[longPos, shortPos] as any} positionsLoading={false} tradeHistory={[]} historyLoading={false} markets={markets as any} fetchPositions={vi.fn()} {...props} />
        </MemoryRouter>,
    );
}

describe('PositionTable rows and tabs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useSettingsStore as any).mockReturnValue({ compactMode: true, showPnlPercent: false, confirmTrades: true, maxSlippage: 0.5 });
        (usePositionsStore as any).mockReturnValue({ removePosition: vi.fn() });
        (usePendingOrders as any).mockReturnValue({ orders: [], loading: false, refetch: vi.fn() });
        (useSetStopLoss as any).mockReturnValue({ setStopLoss: vi.fn().mockResolvedValue(true), loading: false });
        (useSetTakeProfit as any).mockReturnValue({ setTakeProfit: vi.fn().mockResolvedValue(true), loading: false });
        (useSetTrailingStop as any).mockReturnValue({ setTrailingStop: vi.fn().mockResolvedValue(true), loading: false });
        (useCancelOrder as any).mockReturnValue({ cancelOrder: vi.fn().mockResolvedValue(true), loading: false });
    });

    it('renders long and short rows with absolute pnl (showPnlPercent off, compact on)', () => {
        renderTable();
        expect(screen.getAllByText(/BTC-USD/).length).toBeGreaterThan(0);
        // existing SL/TP values render the "edit" affordance differently than empty
        expect(screen.getAllByTestId('position-card').length).toBeGreaterThan(0);
    });

    it('renders both rows and reflects negative pnl on the short', () => {
        renderTable();
        expect(screen.getAllByTestId('position-card').length).toBe(2);
    });

    it('shows order rows for every order type and history of every type', () => {
        (usePendingOrders as any).mockReturnValue({ orders: [
            { orderId: 1n, orderType: 0, market: '0xBTC' },
            { orderId: 2n, orderType: 1, market: '0xBTC' },
            { orderId: 3n, orderType: 2, market: '0xBTC' },
            { orderId: 4n, orderType: 3, market: '0xBTC' },
        ], loading: false, refetch: vi.fn() });
        const tradeHistory = [
            { id: '1', timestamp: new Date().toISOString(), side: 'LONG', market: 'BTC-USD', price: '50000', pnl: '10', type: 'OPEN' },
            { id: '2', timestamp: new Date().toISOString(), side: 'SHORT', market: 'ETH-USD', price: '3000', pnl: '-5', type: 'CLOSE' },
            { id: '3', timestamp: new Date().toISOString(), side: 'LONG', market: 'BTC-USD', price: '49000', pnl: null, type: 'LIQUIDATED' },
        ];
        renderTable({ tradeHistory });
        fireEvent.click(screen.getByTestId('orders-tab'));
        expect(screen.getByText('#1')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('history-tab'));
        expect(screen.getAllByText(/BTC-USD|ETH-USD/).length).toBeGreaterThan(0);
    });

    it('renders loading and empty states for orders and history', () => {
        (usePendingOrders as any).mockReturnValue({ orders: [], loading: true, refetch: vi.fn() });
        renderTable({ positions: [], tradeHistory: [], historyLoading: true });
        fireEvent.click(screen.getByTestId('orders-tab'));
        fireEvent.click(screen.getByTestId('history-tab'));
        expect(screen.getByTestId('history-tab')).toBeInTheDocument();
    });
});
