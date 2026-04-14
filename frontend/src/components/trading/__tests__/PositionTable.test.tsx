import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PositionTable } from '../PositionTable';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// Mock the hooks used in PositionTable
vi.mock('../../../hooks/useProgram', () => ({
    useSetStopLoss: () => ({ setStopLoss: vi.fn(), loading: false }),
    useSetTakeProfit: () => ({ setTakeProfit: vi.fn(), loading: false }),
    useSetTrailingStop: () => ({ setTrailingStop: vi.fn(), loading: false }),
    useCancelOrder: () => ({ cancelOrder: vi.fn(), loading: false }),
    useModifyMargin: () => ({ modifyMargin: vi.fn(), loading: false }),
    useClosePosition: () => ({ closePosition: vi.fn(), loading: false }),
    usePartialClose: () => ({ partialClose: vi.fn(), loading: false }),
    useOpenPosition: () => ({ executePosition: vi.fn(), isLoading: false, step: 'IDLE' }),
}));

vi.mock('../../../hooks/usePendingOrders', () => ({
    usePendingOrders: () => ({ orders: [], loading: false, refetch: vi.fn() }),
    getOrderTypeLabel: (type: any) => type,
}));

vi.mock('../../../hooks/usePositions', () => ({
    Position: {}
}));

vi.mock('../../../stores/settingsStore', () => ({
    useSettingsStore: () => ({
        compactMode: false,
        slippage: '0.1',
        confirmTrades: true,
    }),
}));

vi.mock('../../../hooks/useSound', () => ({
    useSound: () => ({
        play: vi.fn(),
    }),
}));

const mockMarkets = [
    {
        symbol: 'ETH',
        marketAddress: '0x123',
        image: 'eth.png'
    },
    {
        symbol: 'BTC',
        marketAddress: '0x456',
        image: 'btc.png'
    }
];

const mockPositions = [
    {
        id: '1',
        sizeRaw: '1000000000000000000000',
        marketAddress: '0x123',
        side: 'LONG',
        isLong: true,
        size: '1000',
        collateral: '100',
        leverage: 10,
        entryPrice: '2000',
        markPrice: '2100',
        liquidationPrice: '1800',
        status: 'OPEN'
    }
];

describe('PositionTable', () => {
    const defaultProps = {
        positions: mockPositions as any,
        positionsLoading: false,
        tradeHistory: [],
        historyLoading: false,
        markets: mockMarkets as any,
        fetchPositions: vi.fn(),
    };

    const renderWithRouter = (ui: React.ReactElement) => {
        return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>);
    };

    it('renders empty state when no positions', () => {
        renderWithRouter(<PositionTable {...defaultProps} positions={[]} />);
        expect(screen.getByText(/No open positions/i)).toBeInTheDocument();
    });

    it('renders list of positions', () => {
        renderWithRouter(<PositionTable {...defaultProps} />);
        const row = screen.getByTestId('position-row');
        expect(row).toBeInTheDocument();
    });

    it('opens trigger modal when clicking trigger button', async () => {
        const user = userEvent.setup();
        renderWithRouter(<PositionTable {...defaultProps} />);
        const triggerBtn = screen.getByTestId('trigger-btn');
        await user.click(triggerBtn);
        expect(screen.getByText(/Position Triggers/i)).toBeInTheDocument();
    });

    it('filters positions by status tabs', async () => {
        const user = userEvent.setup();
        renderWithRouter(<PositionTable {...defaultProps} />);
        
        const ordersTab = screen.getByTestId('orders-tab');
        await user.click(ordersTab);
        
        expect(screen.queryByTestId('position-row')).toBeNull();
        
        const positionsTab = screen.getByTestId('positions-tab');
        await user.click(positionsTab);
        expect(screen.getByTestId('position-row')).toBeInTheDocument();
    });
});
