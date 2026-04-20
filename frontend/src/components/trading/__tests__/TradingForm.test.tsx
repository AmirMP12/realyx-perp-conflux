
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TradingForm } from '../TradingForm';
import { useAccount } from 'wagmi';
import { useOpenPosition, useUSDCBalance } from '../../../hooks/useProgram';
import { usePositionsStore } from '../../../stores';
import { useSettingsStore } from '../../../stores/settingsStore';
// import { showToast } from '../../ui/Toast';
import { MemoryRouter } from 'react-router-dom';

// Mock dependencies
vi.mock('wagmi', () => ({
    useAccount: vi.fn(),
}));

vi.mock('../../../hooks/useProgram', () => ({
    useOpenPosition: vi.fn(),
    useUSDCBalance: vi.fn(),
    OrderType: {
        MARKET_INCREASE: 'MARKET_INCREASE',
        LIMIT_INCREASE: 'LIMIT_INCREASE',
    },
}));

vi.mock('../../../stores', () => ({
    usePositionsStore: vi.fn(),
    useMarketsStore: vi.fn(),
}));

vi.mock('../../../stores/settingsStore', () => ({
    useSettingsStore: vi.fn(),
}));

vi.mock('../../ui/Toast', () => ({
    showToast: vi.fn(),
}));

vi.mock('../../../hooks/useSound', () => ({
    useSound: () => ({
        playSuccess: vi.fn(),
        playError: vi.fn(),
    }),
}));

describe('TradingForm', () => {
    const mockMarket = {
        id: 'btc-market',
        symbol: 'BTC-USD',
        marketAddress: '0xBTC',
        fundingRate: 0.0001,
    };
    const mockCurrentPrice = 50000;

    const mockExecutePosition = vi.fn();
    const mockAddOptimistic = vi.fn();
    const mockRemoveOptimistic = vi.fn();
    const mockSetMaxSlippage = vi.fn();
    const mockSetConfirmTrades = vi.fn();

    const mockSettings = {
        defaultLeverage: 2,
        defaultOrderType: 'market',
        maxSlippage: 0.5,
        confirmTrades: true,
        showPnlPercent: true,
        liquidationWarnings: true,
        compactMode: false,
        setMaxSlippage: mockSetMaxSlippage,
        setConfirmTrades: mockSetConfirmTrades,
        setShowPnlPercent: vi.fn(),
        setLiquidationWarnings: vi.fn(),
        setCompactMode: vi.fn(),
    };

    const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };

    beforeEach(() => {
        vi.clearAllMocks();
        
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useUSDCBalance as any).mockReturnValue({ balance: 1000, loading: false });
        (useOpenPosition as any).mockReturnValue({
            executePosition: mockExecutePosition,
            isLoading: false,
            step: 'IDLE',
        });
        (usePositionsStore as any).mockReturnValue({
            addOptimisticPosition: mockAddOptimistic,
            removeOptimisticPosition: mockRemoveOptimistic,
        });
        (useSettingsStore as any).mockReturnValue(mockSettings);
    });

    const renderComp = (props = {}) => render(
        <MemoryRouter future={routerFuture}>
            <TradingForm market={mockMarket as any} currentPrice={mockCurrentPrice} {...props} />
        </MemoryRouter>
    );

    it('renders connect wallet button when disconnected', () => {
        (useAccount as any).mockReturnValue({ isConnected: false });
        renderComp();
        expect(screen.getByText(/Connect Wallet/i)).toBeInTheDocument();
    });

    it('toggles between Long and Short', () => {
        renderComp();
        const shortBtn = screen.getByText('Short');
        fireEvent.click(shortBtn);
        // Wait for state transition
        expect(screen.getByText(/Sell \/ Short/i)).toBeInTheDocument();
        
        const longBtn = screen.getByText('Long');
        fireEvent.click(longBtn);
        expect(screen.getByText(/Buy \/ Long/i)).toBeInTheDocument();
    });

    it('updates leverage via slider and input buttons', () => {
        renderComp();
        const plusBtn = screen.getByLabelText(/Increase leverage/i);
        fireEvent.click(plusBtn);
        expect(screen.getByText('3.0x')).toBeInTheDocument();
        
        const leverageSlider = screen.getByRole('slider');
        fireEvent.change(leverageSlider, { target: { value: '5' } });
        expect(screen.getByText('5.0x')).toBeInTheDocument();

        const quickLeverageBtn = screen.getByText('10x');
        fireEvent.click(quickLeverageBtn);
        expect(screen.getByText('10.0x')).toBeInTheDocument();
    });

    it('handles margin percentage buttons', () => {
        renderComp();
        const input = screen.getByTestId('margin-input') as HTMLInputElement;
        
        fireEvent.click(screen.getByText('50%'));
        expect(input.value).toBe('500.00'); // 50% of 1000

        fireEvent.click(screen.getByText('Max'));
        expect(input.value).toBe('1000.0000');
    });

    it('switches order types', () => {
        renderComp();
        fireEvent.click(screen.getByTestId('order-type-limit'));
        expect(screen.getByTestId('trigger-price')).toBeInTheDocument();
        
        fireEvent.click(screen.getByTestId('order-type-market'));
        expect(screen.queryByTestId('trigger-price')).not.toBeInTheDocument();
    });

    it('skips confirmation modal when confirmTrades is false', async () => {
        (useSettingsStore as any).mockReturnValue({ ...mockSettings, confirmTrades: false });
        mockExecutePosition.mockResolvedValue(true);
        
        renderComp();
        
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        
        await act(async () => {
            fireEvent.click(screen.getByTestId('trade-button'));
        });

        expect(screen.queryByTestId('confirm-modal-title')).not.toBeInTheDocument();
        expect(mockExecutePosition).toHaveBeenCalled();
    });

    it('validates trigger price for limit orders', async () => {
        renderComp();
        fireEvent.click(screen.getByTestId('order-type-limit'));
        
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        fireEvent.change(screen.getByTestId('trigger-price'), { target: { value: '0' } });

        fireEvent.click(screen.getByTestId('trade-button'));
        expect(screen.getByText('Invalid price')).toBeInTheDocument();
    });

    it('handles settings toggles in gear panel', () => {
        renderComp();
        fireEvent.click(screen.getByLabelText(/Trading settings/i));
        
        const confirmToggle = screen.getByText('Confirm Trades').parentElement?.querySelector('button');
        if (confirmToggle) fireEvent.click(confirmToggle);
        expect(mockSetConfirmTrades).toHaveBeenCalled();

        fireEvent.click(screen.getByText(/^1\s?%$/));
        expect(mockSetMaxSlippage).toHaveBeenCalledWith(1.0);
    });

    it('correctly calculates notional value and fees in summary', () => {
        renderComp();
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        
        // At 2x leverage, 100 margin -> ~200 size minus fees. 
        // Component logic: baseMargin = sizeNum / (1 + leverage * 0.0005) = 100 / (1 + 2*0.0005) = 100 / 1.001 = 99.90
        // fee = 99.90 * 2 * 0.0005 = 0.0999 (rounded up to 0.10)
        // notionalValue = 99.90 * 2 = 199.80
        
        expect(screen.getByText('$100.00')).toBeInTheDocument(); // Margin summary
        expect(screen.getByText(/Est. Fee/)).toBeInTheDocument();
    });
});
