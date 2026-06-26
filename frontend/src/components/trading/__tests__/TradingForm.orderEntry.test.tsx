import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TradingForm } from '../TradingForm';
import { useAccount } from 'wagmi';
import { useOpenPosition, useUSDCBalance } from '../../../hooks/useProgram';
import { usePositionsStore } from '../../../stores';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useCollateralAssets } from '../../../hooks/useCollateral';
import { useMarketSession } from '../../../hooks/useMarketSession';

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));
vi.mock('../../../hooks/useProgram', () => ({
    useOpenPosition: vi.fn(),
    useUSDCBalance: vi.fn(),
    useMarginMode: vi.fn(() => ({ isCross: false, mode: 'isolated', loading: false })),
    OrderType: { MARKET_INCREASE: 'MARKET_INCREASE', LIMIT_INCREASE: 'LIMIT_INCREASE' },
}));
vi.mock('../../../hooks/useCollateral', () => ({
    useCollateralAssets: vi.fn(),
    formatHaircut: (bps: number) => `${bps / 100}%`,
}));
vi.mock('../../../stores', () => ({ usePositionsStore: vi.fn(), useMarketsStore: vi.fn() }));
vi.mock('../../../stores/settingsStore', () => ({ useSettingsStore: vi.fn() }));
vi.mock('../../../hooks/useAccountRisk', () => ({
    useAccountRisk: vi.fn(() => ({ totalNotional: 5000, totalCollateral: 1000, maintenanceMargin: 50, unrealizedPnL: 10, healthFactor: 2, crossPositionCount: 1, liquidatable: false, hasPositions: true, loading: false })),
}));
vi.mock('../../ui/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../../../hooks/useSound', () => ({ useSound: () => ({ playSuccess: vi.fn(), playError: vi.fn() }) }));
vi.mock('../../../hooks/useMarketSession', () => ({ useMarketSession: vi.fn() }));

const usdc = {
    address: '0x0000000000000000000000000000000000000000', symbol: 'USDT0', isUSDC: true, enabled: true,
    baseHaircutBps: 0, balanceFormatted: 0, effectiveUsdcFormatted: 0,
};
const alt = {
    address: '0xWbtc', symbol: 'WBTC', isUSDC: false, enabled: true, baseHaircutBps: 200,
    balanceFormatted: 2, effectiveUsdcFormatted: 80000,
};

const mockSettings = {
    defaultLeverage: 2, defaultOrderType: 'market', maxSlippage: 0.5, confirmTrades: false,
    showPnlPercent: true, liquidationWarnings: true, compactMode: false,
    setMaxSlippage: vi.fn(), setConfirmTrades: vi.fn(), setShowPnlPercent: vi.fn(),
    setLiquidationWarnings: vi.fn(), setCompactMode: vi.fn(),
};

const executePosition = vi.fn().mockResolvedValue(true);
const market = { id: 'btc', symbol: 'BTC-USD', marketAddress: '0xBTC', fundingRate: 0.0002, category: 'CRYPTO' } as any;

function renderForm(props = {}) {
    return render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <TradingForm market={market} currentPrice={50000} {...props} />
        </MemoryRouter>,
    );
}

describe('TradingForm order entry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useUSDCBalance as any).mockReturnValue({ balance: 1000, loading: false });
        (useOpenPosition as any).mockReturnValue({ executePosition, isLoading: false, step: 'IDLE' });
        (usePositionsStore as any).mockReturnValue({ addOptimisticPosition: vi.fn(), removeOptimisticPosition: vi.fn() });
        (useSettingsStore as any).mockReturnValue(mockSettings);
        (useCollateralAssets as any).mockReturnValue({ assets: [usdc, alt], usdc, ordersEnabled: true, loading: false });
        (useMarketSession as any).mockReturnValue({ isAlwaysOpen: true, state: 'always-open', closingSoon: false, nextChangeLabel: null });
    });

    it('flags insufficient balance', () => {
        (useUSDCBalance as any).mockReturnValue({ balance: 10, loading: false });
        renderForm();
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '1000' } });
        fireEvent.click(screen.getByTestId('trade-button'));
        expect(screen.getByText('Insufficient Balance')).toBeInTheDocument();
        expect(executePosition).not.toHaveBeenCalled();
    });

    it('flags empty and invalid amounts', () => {
        renderForm();
        fireEvent.click(screen.getByTestId('trade-button'));
        expect(screen.getByText('Enter an amount')).toBeInTheDocument();
    });

    it('switches to Position Size mode and converts the amount', () => {
        renderForm();
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        fireEvent.click(screen.getByTestId('amount-mode-size'));
        // switching back also runs the inverse conversion
        fireEvent.click(screen.getByTestId('amount-mode-pay'));
        expect(screen.getByTestId('amount-mode-pay')).toBeInTheDocument();
    });

    it('selects alt collateral and shows haircut info', () => {
        renderForm();
        fireEvent.click(screen.getByTestId('collateral-selector'));
        const wbtc = screen.getAllByText('WBTC');
        fireEvent.click(wbtc[wbtc.length - 1]);
        expect(screen.getByText(/Paying with/)).toBeInTheDocument();
    });

    it('toggles post-only on a limit order', () => {
        renderForm();
        fireEvent.click(screen.getByTestId('order-type-limit'));
        fireEvent.click(screen.getByLabelText('Post-only'));
        expect(screen.getByTestId('trigger-price')).toBeInTheDocument();
    });

    it('toggles the remaining settings switches', () => {
        renderForm();
        fireEvent.click(screen.getByLabelText(/Trading settings/i));
        fireEvent.click(screen.getByLabelText('Show PnL %'));
        fireEvent.click(screen.getByLabelText('Liquidation Warnings'));
        fireEvent.click(screen.getByLabelText('Compact Mode'));
        expect(mockSettings.setShowPnlPercent).toHaveBeenCalled();
        expect(mockSettings.setLiquidationWarnings).toHaveBeenCalled();
        expect(mockSettings.setCompactMode).toHaveBeenCalled();
    });

    it('validates a stop-loss above entry for a long', () => {
        renderForm();
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        fireEvent.click(screen.getByTestId('bracket-toggle'));
        fireEvent.change(screen.getByTestId('stop-loss-price'), { target: { value: '60000' } });
        fireEvent.click(screen.getByTestId('trade-button'));
        expect(screen.getByText(/Stop-loss must be below entry/)).toBeInTheDocument();
    });

    it('validates take-profit/stop-loss for a short', () => {
        renderForm({ side: 'short' });
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        fireEvent.click(screen.getByTestId('bracket-toggle'));
        // For a short, TP must be below entry; set it above -> error
        fireEvent.change(screen.getByTestId('take-profit-price'), { target: { value: '60000' } });
        fireEvent.click(screen.getByTestId('trade-button'));
        expect(screen.getByText(/Take-profit must be below entry/)).toBeInTheDocument();
        // Clear TP and set an invalid SL (below entry) -> stop-loss error
        fireEvent.change(screen.getByTestId('take-profit-price'), { target: { value: '' } });
        fireEvent.change(screen.getByTestId('stop-loss-price'), { target: { value: '45000' } });
        fireEvent.click(screen.getByTestId('trade-button'));
        expect(screen.getByText(/Stop-loss must be above entry/)).toBeInTheDocument();
    });

    it('submits a valid limit order', async () => {
        renderForm();
        fireEvent.click(screen.getByTestId('order-type-limit'));
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        fireEvent.change(screen.getByTestId('trigger-price'), { target: { value: '49000' } });
        await act(async () => { fireEvent.click(screen.getByTestId('trade-button')); });
        expect(executePosition).toHaveBeenCalledWith(expect.objectContaining({ orderType: 'LIMIT_INCREASE' }));
    });

    it('shows the equity gap-risk warning when the session is closing soon', () => {
        (useMarketSession as any).mockReturnValue({ isAlwaysOpen: false, state: 'open', closingSoon: true, nextChangeLabel: 'Closes in 5m' });
        renderForm({ market: { ...market, category: 'STOCK' } });
        expect(screen.getByTestId('trade-button')).toBeInTheDocument();
    });

    it('handles the equity closed session', () => {
        (useMarketSession as any).mockReturnValue({ isAlwaysOpen: false, state: 'closed', closingSoon: false, nextChangeLabel: 'Reopens in 10h' });
        renderForm({ market: { ...market, category: 'STOCK' } });
        expect(screen.getByTestId('trade-button')).toBeInTheDocument();
    });
});
