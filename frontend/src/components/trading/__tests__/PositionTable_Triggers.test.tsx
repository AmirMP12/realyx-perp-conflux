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

const markets = [{ id: 'btc', symbol: 'BTC-USD', marketAddress: '0xBTC', image: 'b.png' }];
const pos = { id: '1', symbol: 'BTC-USD', marketAddress: '0xBTC', size: '1000', collateral: '100', entryPrice: '50000', markPrice: '51000', liquidationPrice: '45000', isLong: true, pnl: '10', livePnl: '10', stopLossPrice: 48000, takeProfitPrice: 55000, trailingStopBps: 0 };

let setStopLoss: any, setTakeProfit: any, setTrailingStop: any;
function renderTable() {
    return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PositionTable positions={[pos] as any} positionsLoading={false} tradeHistory={[]} historyLoading={false} markets={markets as any} fetchPositions={vi.fn()} />
    </MemoryRouter>);
}

describe('PositionTable trigger modal validation + diffing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useSettingsStore as any).mockReturnValue({ compactMode: false, showPnlPercent: true, confirmTrades: true, maxSlippage: 0.5 });
        (usePositionsStore as any).mockReturnValue({ removePosition: vi.fn() });
        (usePendingOrders as any).mockReturnValue({ orders: [], loading: false, refetch: vi.fn() });
        setStopLoss = vi.fn().mockResolvedValue(true);
        setTakeProfit = vi.fn().mockResolvedValue(true);
        setTrailingStop = vi.fn().mockResolvedValue(true);
        (useSetStopLoss as any).mockReturnValue({ setStopLoss, loading: false });
        (useSetTakeProfit as any).mockReturnValue({ setTakeProfit, loading: false });
        (useSetTrailingStop as any).mockReturnValue({ setTrailingStop, loading: false });
        (useCancelOrder as any).mockReturnValue({ cancelOrder: vi.fn().mockResolvedValue(true), loading: false });
    });

    function openModal() {
        fireEvent.click(screen.getAllByTestId('trigger-btn')[0]);
    }

    it('rejects an invalid (NaN) stop-loss value', async () => {
        renderTable();
        openModal();
        const sl = screen.getByLabelText(/Stop loss/i);
        fireEvent.change(sl, { target: { value: '.' } });
        await act(async () => { fireEvent.click(screen.getByText('Save triggers')); });
        expect(showToast).toHaveBeenCalledWith('error', 'Invalid', expect.any(String));
        expect(setStopLoss).not.toHaveBeenCalled();
    });

    it('only sends the take-profit and trailing values that changed', async () => {
        renderTable();
        openModal();
        // SL stays at its prefilled 48000 (unchanged), change TP and trailing
        fireEvent.change(screen.getByLabelText(/Take profit/i), { target: { value: '60000' } });
        fireEvent.change(screen.getByLabelText(/trailing/i), { target: { value: '100' } });
        await act(async () => { fireEvent.click(screen.getByText('Save triggers')); });
        expect(setTakeProfit).toHaveBeenCalledWith(expect.anything(), 60000);
        expect(setTrailingStop).toHaveBeenCalledWith(expect.anything(), 100);
        expect(setStopLoss).not.toHaveBeenCalled();
    });

    it('falls back to a generic message when the error has no shortMessage', async () => {
        setStopLoss.mockRejectedValue({});
        renderTable();
        openModal();
        fireEvent.change(screen.getByLabelText(/Stop loss/i), { target: { value: '46000' } });
        await act(async () => { fireEvent.click(screen.getByText('Save triggers')); });
        await waitFor(() => expect(showToast).toHaveBeenCalledWith('error', 'Failed', 'Failed to update position'));
    });

    it('closes the trigger modal when Escape is pressed', () => {
        renderTable();
        openModal();
        expect(screen.getByText('Position triggers')).toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByText('Position triggers')).not.toBeInTheDocument();
    });
});
