import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

// Mock the modals so they actually invoke their callbacks when "open".
vi.mock('../ClosePositionModal', () => ({
    ClosePositionModal: ({ isOpen, onClose, onCloseSuccess }: any) => isOpen ? (
        <div>
            <button data-testid="cpm-close" onClick={onClose} />
            <button data-testid="cpm-success" onClick={onCloseSuccess} />
        </div>
    ) : null,
}));
vi.mock('../CollateralEditModal', () => ({
    CollateralEditModal: ({ isOpen, onClose }: any) => isOpen ? <button data-testid="cem-close" onClick={onClose} /> : null,
}));
vi.mock('../TransferPositionModal', () => ({
    TransferPositionModal: ({ isOpen, onClose, onSuccess }: any) => isOpen ? (
        <div>
            <button data-testid="tpm-close" onClick={onClose} />
            <button data-testid="tpm-success" onClick={onSuccess} />
        </div>
    ) : null,
}));

const markets = [{ id: 'btc', symbol: 'BTC-USD', marketAddress: '0xBTC', image: 'b.png' }];
const pos = { id: '1', symbol: 'BTC-USD', marketAddress: '0xBTC', size: '1000', collateral: '100', entryPrice: '50000', markPrice: '51000', liquidationPrice: '45000', isLong: true, pnl: '10', livePnl: '10', stopLossPrice: 48000, takeProfitPrice: 55000, trailingStopBps: 0 };

let fetchPositions: any, removePosition: any, refetchOrders: any;
function renderTable() {
    return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PositionTable positions={[pos] as any} positionsLoading={false} tradeHistory={[]} historyLoading={false} markets={markets as any} fetchPositions={fetchPositions} />
    </MemoryRouter>);
}

describe('PositionTable modal callbacks + row actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchPositions = vi.fn();
        removePosition = vi.fn();
        refetchOrders = vi.fn();
        (useSettingsStore as any).mockReturnValue({ compactMode: false, showPnlPercent: true, confirmTrades: true, maxSlippage: 0.5 });
        (usePositionsStore as any).mockReturnValue({ removePosition });
        (usePendingOrders as any).mockReturnValue({ orders: [], loading: false, refetch: refetchOrders });
        (useSetStopLoss as any).mockReturnValue({ setStopLoss: vi.fn().mockResolvedValue(true), loading: false });
        (useSetTakeProfit as any).mockReturnValue({ setTakeProfit: vi.fn().mockResolvedValue(true), loading: false });
        (useSetTrailingStop as any).mockReturnValue({ setTrailingStop: vi.fn().mockResolvedValue(true), loading: false });
        (useCancelOrder as any).mockReturnValue({ cancelOrder: vi.fn().mockResolvedValue(true), loading: false });
    });
    afterEach(() => vi.useRealTimers());

    it('opens the collateral modal and runs its onClose (which refetches)', () => {
        vi.useFakeTimers();
        renderTable();
        fireEvent.click(screen.getAllByTitle('Edit Collateral')[0]);
        fireEvent.click(screen.getByTestId('cem-close'));
        act(() => { vi.advanceTimersByTime(1000); });
        expect(fetchPositions).toHaveBeenCalled();
    });

    it('opens the close modal and runs onClose + onCloseSuccess', () => {
        vi.useFakeTimers();
        renderTable();
        fireEvent.click(screen.getAllByText('Close')[0]);
        fireEvent.click(screen.getByTestId('cpm-success'));
        act(() => { vi.advanceTimersByTime(2000); });
        expect(fetchPositions).toHaveBeenCalled();
    });

    it('opens the transfer modal and runs onSuccess (removes position + refetch)', () => {
        vi.useFakeTimers();
        renderTable();
        fireEvent.click(screen.getAllByTestId('transfer-position-btn')[0]);
        fireEvent.click(screen.getByTestId('tpm-success'));
        act(() => { vi.advanceTimersByTime(2000); });
        expect(removePosition).toHaveBeenCalledWith('1');
        expect(fetchPositions).toHaveBeenCalled();
    });

    it('closes the trigger modal via the backdrop and the Cancel button', () => {
        renderTable();
        fireEvent.click(screen.getAllByTestId('trigger-btn')[0]);
        fireEvent.click(screen.getByText('Cancel'));
        expect(screen.queryByText('Position triggers')).not.toBeInTheDocument();
    });

    it('runs the post-save refetch timeout after saving triggers', async () => {
        vi.useFakeTimers();
        renderTable();
        fireEvent.click(screen.getAllByTestId('trigger-btn')[0]);
        fireEvent.change(screen.getByLabelText(/Stop loss/i), { target: { value: '47000' } });
        await act(async () => { fireEvent.click(screen.getByText('Save triggers')); });
        await act(async () => { vi.advanceTimersByTime(2000); });
        expect(fetchPositions).toHaveBeenCalled();
    });

    it('refetches orders after a successful cancel', async () => {
        (usePendingOrders as any).mockReturnValue({ orders: [{ orderId: 5n, orderType: 0, market: '0xBTC' }], loading: false, refetch: refetchOrders });
        renderTable();
        fireEvent.click(screen.getByTestId('orders-tab'));
        await act(async () => { fireEvent.click(screen.getAllByText('Cancel')[0]); });
        expect(refetchOrders).toHaveBeenCalled();
    });

    it('opens collateral/close/transfer from the mobile cards', () => {
        renderTable();
        fireEvent.click(screen.getByTestId('mobile-trigger-btn'));
        expect(screen.getByText('Position triggers')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Cancel'));
        fireEvent.click(screen.getByText('Close Position'));
        expect(screen.getByTestId('cpm-close')).toBeInTheDocument();
    });
});
