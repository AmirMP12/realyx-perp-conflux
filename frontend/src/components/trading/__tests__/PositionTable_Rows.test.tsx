import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PositionTable } from '../PositionTable';
import { useSettingsStore } from '../../../stores/settingsStore';
import { usePositionsStore } from '../../../stores';
import { usePendingOrders } from '../../../hooks/usePendingOrders';
import { useSetStopLoss, useSetTakeProfit, useSetTrailingStop, useCancelOrder } from '../../../hooks/useProgram';
import { showToast } from '../../ui/Toast';

vi.mock('../../../stores/settingsStore', () => ({ useSettingsStore: vi.fn() }));
vi.mock('../../../stores', () => ({ usePositionsStore: vi.fn() }));
vi.mock('../../../hooks/usePendingOrders', () => ({ usePendingOrders: vi.fn(), getOrderTypeLabel: (t: number) => `T${t}` }));
vi.mock('../../../hooks/useProgram', () => ({ useSetStopLoss: vi.fn(), useSetTakeProfit: vi.fn(), useSetTrailingStop: vi.fn(), useCancelOrder: vi.fn() }));
vi.mock('../../ui/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../ClosePositionModal', () => ({ ClosePositionModal: () => null }));
vi.mock('../CollateralEditModal', () => ({ CollateralEditModal: () => null }));
vi.mock('../TransferPositionModal', () => ({ TransferPositionModal: () => null }));

const markets = [{ id: 'btc', symbol: 'BTC-USD', marketAddress: '0xBTC', image: 'b.png' }, { id: 'eth', symbol: 'ETH-USD', marketAddress: '0xETH', image: 'e.png' }];
const longPos = { id: '1', symbol: 'BTC-USD', marketAddress: '0xBTC', size: '1000', collateral: '100', entryPrice: '50000', markPrice: '51000', liquidationPrice: '45000', isLong: true, pnl: '10', livePnl: '10', stopLossPrice: 48000, takeProfitPrice: 55000, trailingStopBps: 0 };
const shortPos = { id: '2', symbol: 'ETH-USD', marketAddress: '0xETH', size: '500', collateral: '50', entryPrice: '3000', markPrice: '3100', liquidationPrice: '3600', isLong: false, pnl: '-30', livePnl: '-30', stopLossPrice: 0, takeProfitPrice: 0, trailingStopBps: 0 };

let setStopLoss: any;
function renderTable(props = {}) {
    return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PositionTable positions={[longPos, shortPos] as any} positionsLoading={false} tradeHistory={[]} historyLoading={false} markets={markets as any} fetchPositions={vi.fn()} {...props} />
    </MemoryRouter>);
}

describe('PositionTable rows + trigger modal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useSettingsStore as any).mockReturnValue({ compactMode: false, showPnlPercent: true, confirmTrades: true, maxSlippage: 0.5 });
        (usePositionsStore as any).mockReturnValue({ removePosition: vi.fn() });
        (usePendingOrders as any).mockReturnValue({ orders: [], loading: false, refetch: vi.fn() });
        setStopLoss = vi.fn().mockResolvedValue(true);
        (useSetStopLoss as any).mockReturnValue({ setStopLoss, loading: false });
        (useSetTakeProfit as any).mockReturnValue({ setTakeProfit: vi.fn().mockResolvedValue(true), loading: false });
        (useSetTrailingStop as any).mockReturnValue({ setTrailingStop: vi.fn().mockResolvedValue(true), loading: false });
        (useCancelOrder as any).mockReturnValue({ cancelOrder: vi.fn().mockResolvedValue(true), loading: false });
    });

    it('renders desktop long and short rows', () => {
        renderTable();
        expect(screen.getAllByText('BTC-USD').length).toBeGreaterThan(0);
        expect(screen.getAllByText('ETH-USD').length).toBeGreaterThan(0);
    });

    it('saves only the changed stop-loss from the trigger modal', async () => {
        renderTable();
        fireEvent.click(screen.getAllByTestId('trigger-btn')[0]);
        const sl = screen.getByLabelText(/Stop loss/i) as HTMLInputElement;
        fireEvent.change(sl, { target: { value: '47000' } });
        await act(async () => { fireEvent.click(screen.getByText('Save triggers')); });
        expect(setStopLoss).toHaveBeenCalledWith(expect.anything(), 47000);
    });

    it('shows an error toast when a trigger update fails', async () => {
        setStopLoss.mockRejectedValue({ shortMessage: 'on-chain revert' });
        renderTable();
        fireEvent.click(screen.getAllByTestId('trigger-btn')[0]);
        fireEvent.change(screen.getByLabelText(/Stop loss/i), { target: { value: '46000' } });
        await act(async () => { fireEvent.click(screen.getByText('Save triggers')); });
        await waitFor(() => expect(showToast).toHaveBeenCalledWith('error', 'Failed', expect.any(String)));
    });

    it('does not refetch when an order cancel fails', async () => {
        const refetch = vi.fn();
        (usePendingOrders as any).mockReturnValue({ orders: [{ orderId: 7n, orderType: 2, market: '0xBTC' }], loading: false, refetch });
        (useCancelOrder as any).mockReturnValue({ cancelOrder: vi.fn().mockResolvedValue(false), loading: false });
        renderTable();
        fireEvent.click(screen.getByTestId('orders-tab'));
        await act(async () => { fireEvent.click(screen.getAllByText('Cancel')[0]); });
        expect(refetch).not.toHaveBeenCalled();
    });
});
