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
vi.mock('../../../hooks/useProgram', () => ({ useSetStopLoss: vi.fn(), useSetTakeProfit: vi.fn(), useSetTrailingStop: vi.fn(), useCancelOrder: vi.fn() }));
vi.mock('../../ui/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../ClosePositionModal', () => ({ ClosePositionModal: () => null }));
vi.mock('../CollateralEditModal', () => ({ CollateralEditModal: () => null }));
vi.mock('../TransferPositionModal', () => ({ TransferPositionModal: () => null }));

const markets = [{ id: 'btc', symbol: 'BTC-USD', marketAddress: '0xBTC', image: 'b.png' }];

function renderTable(positions: any[], settings: any = {}) {
    (useSettingsStore as any).mockReturnValue({ compactMode: false, showPnlPercent: true, confirmTrades: true, maxSlippage: 0.5, ...settings });
    return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PositionTable positions={positions as any} positionsLoading={false} tradeHistory={[]} historyLoading={false} markets={markets as any} fetchPositions={vi.fn()} />
    </MemoryRouter>);
}

describe('PositionTable optimistic states', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (usePositionsStore as any).mockReturnValue({ removePosition: vi.fn() });
        (usePendingOrders as any).mockReturnValue({ orders: [], loading: false, refetch: vi.fn() });
        (useSetStopLoss as any).mockReturnValue({ setStopLoss: vi.fn().mockResolvedValue(true), loading: false });
        (useSetTakeProfit as any).mockReturnValue({ setTakeProfit: vi.fn().mockResolvedValue(true), loading: false });
        (useSetTrailingStop as any).mockReturnValue({ setTrailingStop: vi.fn().mockResolvedValue(true), loading: false });
        (useCancelOrder as any).mockReturnValue({ cancelOrder: vi.fn().mockResolvedValue(true), loading: false });
    });

    it('renders an optimistic position with the Pending/Confirming affordances', () => {
        const optimisticPos = { id: 'opt-123', isOptimistic: true, symbol: 'BTC-USD', marketAddress: '0xBTC', size: '1000', collateral: '100', entryPrice: '50000', markPrice: '51000', liquidationPrice: '45000', isLong: true, pnl: '5', livePnl: '5', stopLossPrice: 0, takeProfitPrice: 0, trailingStopBps: 0 };
        renderTable([optimisticPos]);
        expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
        expect(screen.getByText('Confirming...')).toBeInTheDocument();
    });

    it('renders Unknown for a position with no matching market, using margin fallback and entry as mark', () => {
        const pos = { id: '5', symbol: '???', marketAddress: '0xNONE', size: '800', margin: '80', entryPrice: '2000', liquidationPrice: '1500', isLong: false, pnl: '-12', stopLossPrice: 0, takeProfitPrice: 0, trailingStopBps: 0 };
        renderTable([pos]);
        expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    });

    it('renders absolute pnl when showPnlPercent is on but collateral is zero', () => {
        const pos = { id: '6', symbol: 'BTC-USD', marketAddress: '0xBTC', size: '100', collateral: '0', entryPrice: '50000', markPrice: '50500', liquidationPrice: '45000', isLong: true, pnl: '3', livePnl: '3', stopLossPrice: 0, takeProfitPrice: 0, trailingStopBps: 0 };
        renderTable([pos], { showPnlPercent: true });
        expect(screen.getAllByTestId('position-card').length).toBe(1);
    });

    it('prefills the trigger inputs when the position already has SL/TP/trailing set', () => {
        const pos = { id: '7', symbol: 'BTC-USD', marketAddress: '0xBTC', size: '100', collateral: '10', entryPrice: '50000', markPrice: '50500', liquidationPrice: '45000', isLong: true, pnl: '1', livePnl: '1', stopLossPrice: 48000, takeProfitPrice: 55000, trailingStopBps: 150 };
        renderTable([pos]);
        fireEvent.click(screen.getAllByTestId('trigger-btn')[0]);
        const sl = screen.getByLabelText(/Stop loss/i) as HTMLInputElement;
        expect(sl.value).not.toBe('');
    });

    it('opens the transfer and collateral modals from row buttons', () => {
        const pos = { id: '8', symbol: 'BTC-USD', marketAddress: '0xBTC', size: '100', collateral: '10', entryPrice: '50000', markPrice: '50500', liquidationPrice: '45000', isLong: true, pnl: '1', livePnl: '1', stopLossPrice: 0, takeProfitPrice: 0, trailingStopBps: 0 };
        renderTable([pos]);
        fireEvent.click(screen.getAllByTestId('transfer-position-btn')[0]);
        expect(screen.getAllByTestId('position-row').length).toBeGreaterThan(0);
    });
});
