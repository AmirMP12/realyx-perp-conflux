import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TradingForm } from '../TradingForm';
import { useAccount } from 'wagmi';
import { useOpenPosition, useUSDCBalance } from '../../../hooks/useProgram';
import { usePositionsStore } from '../../../stores';
import { useSettingsStore } from '../../../stores/settingsStore';
import { showToast } from '../../ui/Toast';

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));
vi.mock('../../../hooks/useProgram', () => ({
    useOpenPosition: vi.fn(),
    useUSDCBalance: vi.fn(),
    useMarginMode: vi.fn(() => ({ isCross: true, mode: 'cross', loading: false })),
    OrderType: { MARKET_INCREASE: 'MARKET_INCREASE', LIMIT_INCREASE: 'LIMIT_INCREASE' },
}));
vi.mock('../../../hooks/useCollateral', () => {
    const usdc = {
        address: '0x0000000000000000000000000000000000000000', symbol: 'USDC', decimals: 6, isUSDC: true,
        enabled: true, baseHaircutBps: 0, liquidationHaircutBps: 0, maxHaircutBps: 0, maxProtocolExposure: 0n,
        totalDeposited: 0n, exposureUsdc: 0n, balance: 0n, balanceFormatted: 0, effectiveUsdc: 0n,
        effectiveUsdcFormatted: 0, exposureUtilization: null,
    };
    return {
        useCollateralAssets: vi.fn(() => ({ usdc, altAssets: [], assets: [usdc], registryConfigured: false, hasAltCollateral: false, ordersEnabled: false, usdcAddress: '0x555', loading: false, refetch: vi.fn() })),
        formatHaircut: (bps: number) => `${bps / 100}%`,
    };
});
vi.mock('../../../stores', () => ({ usePositionsStore: vi.fn(), useMarketsStore: vi.fn() }));
vi.mock('../../../stores/settingsStore', () => ({ useSettingsStore: vi.fn() }));
vi.mock('../../../hooks/useAccountRisk', () => ({
    useAccountRisk: vi.fn(() => ({ totalNotional: 0, totalCollateral: 0, maintenanceMargin: 0, unrealizedPnL: 0, healthFactor: Infinity, crossPositionCount: 0, liquidatable: false, hasPositions: false, loading: false })),
}));
vi.mock('../../ui/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../../../hooks/useSound', () => ({ useSound: () => ({ playSuccess: vi.fn(), playError: vi.fn() }) }));

const mockMarket = { id: 'btc-market', symbol: 'BTC-USD', marketAddress: '0xBTC', fundingRate: 0.0001 };
const mockExecutePosition = vi.fn();
const mockAddOptimistic = vi.fn();
const mockRemoveOptimistic = vi.fn();

const mockSettings = {
    defaultLeverage: 2, defaultOrderType: 'market', maxSlippage: 0.5, confirmTrades: true,
    showPnlPercent: true, liquidationWarnings: true, compactMode: false,
    setMaxSlippage: vi.fn(), setConfirmTrades: vi.fn(), setShowPnlPercent: vi.fn(),
    setLiquidationWarnings: vi.fn(), setCompactMode: vi.fn(),
};

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };

function renderForm(props = {}) {
    return render(
        <MemoryRouter future={routerFuture}>
            <TradingForm market={mockMarket as any} currentPrice={50000} {...props} />
        </MemoryRouter>,
    );
}

describe('TradingForm extra', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useUSDCBalance as any).mockReturnValue({ balance: 1000, loading: false });
        (useOpenPosition as any).mockReturnValue({ executePosition: mockExecutePosition, isLoading: false, step: 'IDLE' });
        (usePositionsStore as any).mockReturnValue({ addOptimisticPosition: mockAddOptimistic, removeOptimisticPosition: mockRemoveOptimistic });
        (useSettingsStore as any).mockReturnValue(mockSettings);
    });

    it('completes the confirm flow on success', async () => {
        mockExecutePosition.mockResolvedValue(true);
        const onTradeSuccess = vi.fn();
        renderForm({ onTradeSuccess });
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        await act(async () => { fireEvent.click(screen.getByTestId('trade-button')); });
        expect(screen.getByTestId('confirm-modal-title')).toBeInTheDocument();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
        expect(mockAddOptimistic).toHaveBeenCalled();
        expect(mockExecutePosition).toHaveBeenCalled();
        expect(mockRemoveOptimistic).toHaveBeenCalled();
        expect(onTradeSuccess).toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('success', 'Position Opened', expect.any(String));
    });

    it('removes the optimistic position when execution returns false', async () => {
        mockExecutePosition.mockResolvedValue(false);
        renderForm();
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        await act(async () => { fireEvent.click(screen.getByTestId('trade-button')); });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
        expect(mockRemoveOptimistic).toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalledWith('success', 'Position Opened', expect.any(String));
    });

    it('handles an execution error', async () => {
        mockExecutePosition.mockRejectedValue(new Error('boom'));
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderForm();
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        await act(async () => { fireEvent.click(screen.getByTestId('trade-button')); });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
        expect(showToast).toHaveBeenCalledWith('error', 'Trade Failed', 'boom');
        errSpy.mockRestore();
    });

    it('cancels the confirmation modal', async () => {
        renderForm();
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        await act(async () => { fireEvent.click(screen.getByTestId('trade-button')); });
        expect(screen.getByTestId('confirm-modal-title')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByTestId('confirm-modal-title')).not.toBeInTheDocument();
        expect(mockExecutePosition).not.toHaveBeenCalled();
    });

    it('blocks an invalid take-profit for a long via bracket validation', async () => {
        renderForm();
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        fireEvent.click(screen.getByTestId('bracket-toggle'));
        fireEvent.change(screen.getByTestId('take-profit-price'), { target: { value: '40000' } });
        fireEvent.click(screen.getByTestId('trade-button'));
        expect(screen.getByText(/Take-profit must be above entry/)).toBeInTheDocument();
        expect(mockExecutePosition).not.toHaveBeenCalled();
    });

    it('accepts a valid bracket and submits', async () => {
        mockExecutePosition.mockResolvedValue(true);
        (useSettingsStore as any).mockReturnValue({ ...mockSettings, confirmTrades: false });
        renderForm();
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        fireEvent.click(screen.getByTestId('bracket-toggle'));
        fireEvent.change(screen.getByTestId('take-profit-price'), { target: { value: '60000' } });
        fireEvent.change(screen.getByTestId('stop-loss-price'), { target: { value: '40000' } });
        await act(async () => { fireEvent.click(screen.getByTestId('trade-button')); });
        expect(mockExecutePosition).toHaveBeenCalledWith(
            expect.objectContaining({ takeProfitTrigger: '60000', stopLossTrigger: '40000' }),
        );
    });
});
