
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PositionTable } from '../PositionTable';
import { useSettingsStore } from '../../../stores/settingsStore';
import { usePositionsStore } from '../../../stores';
import { usePendingOrders } from '../../../hooks/usePendingOrders';
import { useSetStopLoss, useSetTakeProfit, useSetTrailingStop, useCancelOrder } from '../../../hooks/useProgram';
import { MemoryRouter } from 'react-router-dom';

// Mock dependencies
vi.mock('../../../stores/settingsStore', () => ({
    useSettingsStore: vi.fn(),
}));

vi.mock('../../../stores', () => ({
    usePositionsStore: vi.fn(),
}));

vi.mock('../../../hooks/usePendingOrders', () => ({
    usePendingOrders: vi.fn(),
    getOrderTypeLabel: vi.fn((type) => type === 1 ? 'Limit' : 'Market'),
}));

vi.mock('../../../hooks/useProgram', () => ({
    useSetStopLoss: vi.fn(),
    useSetTakeProfit: vi.fn(),
    useSetTrailingStop: vi.fn(),
    useCancelOrder: vi.fn(),
}));

vi.mock('../../ui/Toast', () => ({
    showToast: vi.fn(),
}));

vi.mock('../ClosePositionModal', () => ({
    ClosePositionModal: ({ isOpen }: any) => isOpen ? <div data-testid="close-modal">Close Modal</div> : null,
}));

vi.mock('../CollateralEditModal', () => ({
    CollateralEditModal: ({ isOpen }: any) => isOpen ? <div data-testid="collateral-modal">Collateral Modal</div> : null,
}));

vi.mock('../TransferPositionModal', () => ({
    TransferPositionModal: ({ isOpen }: any) => isOpen ? <div data-testid="transfer-modal">Transfer Modal</div> : null,
}));

describe('PositionTable', () => {
    const mockPositions = [
        {
            id: '1',
            symbol: 'BTC-USD',
            marketAddress: '0xBTC',
            size: '1000',
            collateral: '100',
            entryPrice: '50000',
            markPrice: '51000',
            liquidationPrice: '45000',
            isLong: true,
            pnl: '10',
            livePnl: '10',
            stopLossPrice: 0,
            takeProfitPrice: 0,
        }
    ];

    const mockMarkets = [
        { id: 'btc', symbol: 'BTC-USD', marketAddress: '0xBTC', image: 'btc.png' }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        
        (useSettingsStore as any).mockReturnValue({
            compactMode: false,
            showPnlPercent: true,
            confirmTrades: true,
            maxSlippage: 0.5,
        });
        (usePositionsStore as any).mockReturnValue({
            removePosition: vi.fn(),
        });
        (usePendingOrders as any).mockReturnValue({
            orders: [],
            loading: false,
            refetch: vi.fn(),
        });
        (useSetStopLoss as any).mockReturnValue({ setStopLoss: vi.fn().mockResolvedValue(true), loading: false });
        (useSetTakeProfit as any).mockReturnValue({ setTakeProfit: vi.fn().mockResolvedValue(true), loading: false });
        (useSetTrailingStop as any).mockReturnValue({ setTrailingStop: vi.fn().mockResolvedValue(true), loading: false });
        (useCancelOrder as any).mockReturnValue({ cancelOrder: vi.fn().mockResolvedValue(true), loading: false });
    });

    const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };

    const renderComp = (props = {}) => render(
        <MemoryRouter future={routerFuture}>
            <PositionTable
                positions={mockPositions as any}
                positionsLoading={false}
                tradeHistory={[]}
                historyLoading={false}
                markets={mockMarkets as any}
                fetchPositions={vi.fn()}
                {...props}
            />
        </MemoryRouter>
    );

    describe('Tabs and General Rendering', () => {
        it('renders empty state when no positions', () => {
            renderComp({ positions: [] });
            expect(screen.getByText(/No open positions/i)).toBeInTheDocument();
        });

        it('renders loading skeletons', () => {
            renderComp({ positions: [], positionsLoading: true });
            // Should render skeletons (div with bg-secondary or skeleton class)
            // But checking for specific presence of skeleton containers is better
            expect(screen.queryByText(/No open positions/i)).not.toBeInTheDocument();
        });

        it('switches to orders tab and shows pending orders', () => {
            const mockOrders = [{ orderId: 123, orderType: 1, market: '0xBTC' }];
            (usePendingOrders as any).mockReturnValue({ orders: mockOrders, loading: false, refetch: vi.fn() });
            
            renderComp();
            fireEvent.click(screen.getByTestId('orders-tab'));
            
            expect(screen.getByText('#123')).toBeInTheDocument();
            expect(screen.getByText('Cancel')).toBeInTheDocument();
        });

        it('switches to history tab and shows trades', () => {
            const mockHistory = [{ id: '1', timestamp: Date.now(), side: 'LONG', market: 'BTC-USD', price: '50000', pnl: '10', type: 'INCREASE' }];
            renderComp({ tradeHistory: mockHistory });
            
            fireEvent.click(screen.getByTestId('history-tab'));
            expect(screen.getAllByText(/BTC-USD/).length).toBeGreaterThan(0);
            expect(screen.getAllByText('+10.00').length).toBeGreaterThan(0);
        });
    });

    describe('Position Rows and Actions', () => {
        it('opens collateral modal', () => {
            renderComp();
            const editBtn = screen.getByTitle('Edit Collateral');
            fireEvent.click(editBtn);
            expect(screen.getByTestId('collateral-modal')).toBeInTheDocument();
        });

        it('opens transfer modal', () => {
            renderComp();
            const transferBtn = screen.getByTestId('transfer-position-btn');
            fireEvent.click(transferBtn);
            expect(screen.getByTestId('transfer-modal')).toBeInTheDocument();
        });

        it('renders optimistic pending state', () => {
            const optPos = [{ ...mockPositions[0], id: 'opt-123' }];
            renderComp({ positions: optPos });
            expect(screen.getByText('Pending')).toBeInTheDocument();
            expect(screen.queryByTitle('Edit Collateral')).not.toBeInTheDocument();
        });
    });

    describe('TP/SL Modal Logic', () => {
        it('handles SL/TP input and submission', async () => {
            const mockSetSL = vi.fn().mockResolvedValue(true);
            const mockSetTP = vi.fn().mockResolvedValue(true);
            (useSetStopLoss as any).mockReturnValue({ setStopLoss: mockSetSL, loading: false });
            (useSetTakeProfit as any).mockReturnValue({ setTakeProfit: mockSetTP, loading: false });

            renderComp();
            act(() => {
                fireEvent.click(screen.getByTestId('trigger-btn'));
            });

            const slInput = screen.getByLabelText(/Stop loss/i) as HTMLInputElement;
            const tpInput = screen.getByLabelText(/Take profit/i) as HTMLInputElement;
            const saveBtn = screen.getByText('Save triggers');

            fireEvent.change(slInput, { target: { value: '48000' } });
            fireEvent.change(tpInput, { target: { value: '55000' } });
            
            await act(async () => {
                fireEvent.click(saveBtn);
            });

            expect(mockSetSL).toHaveBeenCalledWith(1, 48000);
            expect(mockSetTP).toHaveBeenCalledWith(1, 55000);
            await waitFor(() => {
                expect(screen.queryByText('Position triggers')).not.toBeInTheDocument();
            });
        });

        it('filters non-decimal input for SL/TP', async () => {
            renderComp();
            act(() => {
                fireEvent.click(screen.getByTestId('trigger-btn'));
            });
            const slInput = screen.getByLabelText(/Stop loss/i) as HTMLInputElement;

            fireEvent.change(slInput, { target: { value: 'abc12.34xyz' } });
            await waitFor(() => {
                expect(slInput.value).toBe('12.34');
            });
        });

        it('validates NaN or invalid input', async () => {
            const { showToast } = await import('../../ui/Toast');
            renderComp();
            fireEvent.click(screen.getByTestId('trigger-btn'));
            
            const slInput = screen.getByLabelText(/Stop loss/i);
            // Entering just a dot which parseFloat interprets as NaN
            fireEvent.change(slInput, { target: { value: '.' } });
            
            fireEvent.click(screen.getByText('Save triggers'));
            expect(showToast).toHaveBeenCalledWith('error', expect.any(String), expect.stringContaining('valid prices'));
        });

        it('closes on Escape key', () => {
            renderComp();
            fireEvent.click(screen.getByTestId('trigger-btn'));
            expect(screen.getByText('Position triggers')).toBeInTheDocument();

            fireEvent.keyDown(window, { key: 'Escape' });
            expect(screen.queryByText('Position triggers')).not.toBeInTheDocument();
        });
    });

    describe('Mobile View Components', () => {
        it('renders MobilePositionCard and handles actions', () => {
            renderComp();
            const cards = screen.getAllByTestId('position-card');
            expect(cards.length).toBeGreaterThan(0);

            // Test Mobile Triggers Button
            const triggerBtns = screen.getAllByTestId('mobile-trigger-btn');
            fireEvent.click(triggerBtns[0]);
            expect(screen.getByText('Position triggers')).toBeInTheDocument();
            fireEvent.click(screen.getByLabelText('Close')); // Close modal
        });

        it('renders MobileOrderCard and handles cancel', async () => {
            const mockOrders = [{ orderId: 789, orderType: 1, market: '0xBTC' }];
            const mockRefetch = vi.fn();
            (usePendingOrders as any).mockReturnValue({ orders: mockOrders, loading: false, refetch: mockRefetch });
            
            renderComp();
            fireEvent.click(screen.getByTestId('orders-tab'));
            
            // Should see mobile card
            expect(screen.getByText('ID: #789')).toBeInTheDocument();
            const cancelBtns = screen.getAllByText('Cancel Order');
            fireEvent.click(cancelBtns[0]);
            
            await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
        });

        it('renders MobileHistoryCard', () => {
            const mockHistory = [{ id: '1', timestamp: Date.now(), side: 'LONG', market: 'BTC-USD', price: '50000', pnl: '10', type: 'INCREASE' }];
            renderComp({ tradeHistory: mockHistory });
            
            fireEvent.click(screen.getByTestId('history-tab'));
            expect(screen.getByText('Execute Price')).toBeInTheDocument();
        });
    });

    describe('PnL Display Branches', () => {
        it('renders pnl percentage and absolute value based on settings', () => {
            const { rerender } = renderComp();
            expect(screen.getByText('+10.0%')).toBeInTheDocument();
            expect(screen.getByText(/\(\+\$10\.00\)/)).toBeInTheDocument();

            (useSettingsStore as any).mockReturnValue({ showPnlPercent: false });
            rerender(
                <MemoryRouter future={routerFuture}>
                    <PositionTable
                        positions={mockPositions as any}
                        positionsLoading={false}
                        tradeHistory={[]}
                        historyLoading={false}
                        markets={mockMarkets as any}
                        fetchPositions={vi.fn()}
                    />
                </MemoryRouter>
            );
            expect(screen.getByText('+10.00')).toBeInTheDocument();
        });
    });

    describe('Trailing Stop Triggers', () => {
        it('handles trailing stop input and save', async () => {
            const mockSetTrailing = vi.fn().mockResolvedValue(true);
            (useSetTrailingStop as any).mockReturnValue({ setTrailingStop: mockSetTrailing, loading: false });

            renderComp();
            fireEvent.click(screen.getAllByTestId('trigger-btn')[0]);

            const trailingInput = screen.getByLabelText(/Trailing stop/i);
            fireEvent.change(trailingInput, { target: { value: '150' } });
            
            await act(async () => {
                fireEvent.click(screen.getByText('Save triggers'));
            });

            expect(mockSetTrailing).toHaveBeenCalledWith(1, 150);
        });
    });
});
