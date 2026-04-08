import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TradingForm } from '../TradingForm';
import { MemoryRouter } from 'react-router-dom';
import { useOpenPosition, useUSDCBalance } from '../../../hooks/useProgram';
// No useSettingsStore here

// Mocks for hooks
vi.mock('../../../hooks/useProgram', () => ({
    useUSDCBalance: vi.fn(() => ({ balance: 1000, loading: false })),
    useOpenPosition: vi.fn(() => ({ executePosition: vi.fn(), isLoading: false, step: 'IDLE' })),
    OrderType: { MARKET_INCREASE: 0, LIMIT_INCREASE: 2 },
    useUSDC: vi.fn(() => ({ address: '0x555' })),
}));

vi.mock('../../../hooks/useSound', () => ({
    useSound: () => ({ playSuccess: vi.fn(), playError: vi.fn() }),
}));

vi.mock('../../../hooks/useFocusTrap', () => ({
    useFocusTrap: vi.fn(),
}));

import { create } from 'zustand';

const useSettingsStoreActual = create((set) => ({
    defaultLeverage: 10,
    defaultOrderType: 'market' as const,
    confirmTrades: true,
    maxSlippage: 0.5,
    orderType: 'market' as const,
    setConfirmTrades: (confirmTrades: boolean) => set({ confirmTrades }),
    setMaxSlippage: (maxSlippage: number) => set({ maxSlippage }),
    setOrderType: (orderType: 'market' | 'limit') => set({ orderType }),
}));

vi.mock('../../../stores/settingsStore', () => ({
    useSettingsStore: vi.fn((selector: any) => useSettingsStoreActual(selector)),
}));

const mockMarket = {
    id: 'eth',
    symbol: 'ETH',
    name: 'Ethereum',
    marketAddress: '0x123',
    indexPrice: 2500,
    fundingRate: 0.0001,
} as any;

describe('TradingForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useUSDCBalance as any).mockReturnValue({ balance: 1000, loading: false });
        (useOpenPosition as any).mockReturnValue({ executePosition: vi.fn(), isLoading: false, step: 'IDLE' });
        useSettingsStoreActual.setState({
            defaultLeverage: 10,
            defaultOrderType: 'market',
            confirmTrades: true,
            maxSlippage: 0.5,
            orderType: 'market',
        });
    });

    it('renders and allows side switching', async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <TradingForm market={mockMarket} currentPrice={2500} />
            </MemoryRouter>
        );
        const shortBtn = screen.getByText(/Short/i);
        await user.click(shortBtn);
        expect(screen.getByTestId('trade-button').textContent).toContain('ETH');
    });

    it('shows error for zero amount', async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <TradingForm market={mockMarket} currentPrice={2500} />
            </MemoryRouter>
        );
        const buyBtn = screen.getByTestId('trade-button');
        await user.click(buyBtn);
        expect(await screen.findByText(/Enter an amount/i)).toBeInTheDocument();
    });

    it('shows error for insufficient balance', async () => {
        const user = userEvent.setup();
        (useUSDCBalance as any).mockReturnValue({ balance: 5, loading: false });
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <TradingForm market={mockMarket} currentPrice={2500} />
            </MemoryRouter>
        );
        
        const input = screen.getByTestId('margin-input');
        await user.type(input, '100');
        
        const buyBtn = screen.getByTestId('trade-button');
        await user.click(buyBtn);
        
        expect(await screen.findByText(/Insufficient Balance/i)).toBeInTheDocument();
    });

    it('opens confirm modal when confirmTrades is true', async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <TradingForm market={mockMarket} currentPrice={2500} />
            </MemoryRouter>
        );
        
        const input = screen.getByTestId('margin-input');
        await user.type(input, '100');
        
        const buyBtn = screen.getByTestId('trade-button');
        await user.click(buyBtn);

        expect(await screen.findByTestId('confirm-modal-title')).toHaveTextContent('Confirm Trade');
    });

    it('skips confirm modal when confirmTrades is false', async () => {
        const user = userEvent.setup();
        useSettingsStoreActual.setState({
            defaultLeverage: 10,
            defaultOrderType: 'market',
            confirmTrades: false,
            maxSlippage: 0.5,
        });
        const mockExecute = vi.fn().mockResolvedValue(true);
        (useOpenPosition as any).mockReturnValue({ executePosition: mockExecute, isLoading: false, step: 'IDLE' });

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <TradingForm market={mockMarket} currentPrice={2500} />
            </MemoryRouter>
        );
        
        const input = screen.getByTestId('margin-input');
        await user.type(input, '100');
        
        const buyBtn = screen.getByTestId('trade-button');
        await user.click(buyBtn);

        await waitFor(() => {
            expect(mockExecute).toHaveBeenCalled();
        });
        expect(screen.queryByTestId('confirm-modal-title')).not.toBeInTheDocument();
    });

    it('handles limit orders', async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <TradingForm market={mockMarket} currentPrice={2500} />
            </MemoryRouter>
        );

        const limitBtn = screen.getByTestId('order-type-limit');
        await user.click(limitBtn);

        // Verify trigger price input appears
        expect(await screen.findByTestId('trigger-price')).toBeInTheDocument();
        
        const triggerInput = screen.getByTestId('trigger-price');
        await user.type(triggerInput, '2400');
        expect(triggerInput).toHaveValue(2400);

        const marginInput = screen.getByTestId('margin-input');
        await user.type(marginInput, '100');

        const tradeBtn = screen.getByTestId('trade-button');
        await user.click(tradeBtn);

        expect(await screen.findByTestId('confirm-modal-title')).toHaveTextContent('Confirm Trade');
    });
});
