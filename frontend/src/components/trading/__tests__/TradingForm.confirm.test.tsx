import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TradingForm } from '../TradingForm';
import { useAccount } from 'wagmi';
import { useOpenPosition, useUSDCBalance, useMarginMode } from '../../../hooks/useProgram';
import { usePositionsStore } from '../../../stores';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useCollateralAssets } from '../../../hooks/useCollateral';
import { useAccountRisk } from '../../../hooks/useAccountRisk';
import { useMarketSession } from '../../../hooks/useMarketSession';

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));
vi.mock('../../../hooks/useProgram', () => ({ useOpenPosition: vi.fn(), useUSDCBalance: vi.fn(), useMarginMode: vi.fn(), OrderType: { MARKET_INCREASE: 'MARKET_INCREASE', LIMIT_INCREASE: 'LIMIT_INCREASE' } }));
vi.mock('../../../hooks/useCollateral', () => ({ useCollateralAssets: vi.fn(), formatHaircut: (b: number) => `${b / 100}%` }));
vi.mock('../../../stores', () => ({ usePositionsStore: vi.fn(), useMarketsStore: vi.fn() }));
vi.mock('../../../stores/settingsStore', () => ({ useSettingsStore: vi.fn() }));
vi.mock('../../../hooks/useAccountRisk', () => ({ useAccountRisk: vi.fn() }));
vi.mock('../../ui/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../../../hooks/useSound', () => ({ useSound: () => ({ playSuccess: vi.fn(), playError: vi.fn() }) }));
vi.mock('../../../hooks/useMarketSession', () => ({ useMarketSession: vi.fn() }));

const usdc = { address: '0x0000000000000000000000000000000000000000', symbol: 'USDT0', isUSDC: true, enabled: true, baseHaircutBps: 0, balanceFormatted: 0, effectiveUsdcFormatted: 0 };
const alt = { address: '0xWbtc', symbol: 'WBTC', isUSDC: false, enabled: true, baseHaircutBps: 200, balanceFormatted: 5, effectiveUsdcFormatted: 200000 };
const settings = {
    defaultLeverage: 3, defaultOrderType: 'market', maxSlippage: 0.5, confirmTrades: true,
    showPnlPercent: true, liquidationWarnings: true, compactMode: false,
    setMaxSlippage: vi.fn(), setConfirmTrades: vi.fn(), setShowPnlPercent: vi.fn(), setLiquidationWarnings: vi.fn(), setCompactMode: vi.fn(),
};
const market = { id: 'btc', symbol: 'BTC-USD', marketAddress: '0xBTC', fundingRate: 0.0002, category: 'CRYPTO' } as any;

function renderForm(props = {}) {
    return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><TradingForm market={market} currentPrice={50000} {...props} /></MemoryRouter>);
}

describe('TradingForm confirm modal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useUSDCBalance as any).mockReturnValue({ balance: 100000, loading: false });
        (useOpenPosition as any).mockReturnValue({ executePosition: vi.fn().mockResolvedValue(true), isLoading: false, step: 'IDLE' });
        (usePositionsStore as any).mockReturnValue({ addOptimisticPosition: vi.fn(), removeOptimisticPosition: vi.fn() });
        (useSettingsStore as any).mockReturnValue(settings);
        (useCollateralAssets as any).mockReturnValue({ assets: [usdc, alt], usdc, ordersEnabled: true, loading: false });
        (useAccountRisk as any).mockReturnValue({ totalNotional: 0, totalCollateral: 0, maintenanceMargin: 0, unrealizedPnL: 0, healthFactor: Infinity, crossPositionCount: 0, liquidatable: false, hasPositions: false, loading: false });
        (useMarginMode as any).mockReturnValue({ mode: 'cross', isCross: true, loading: false });
        (useMarketSession as any).mockReturnValue({ isAlwaysOpen: true, state: 'always-open', closingSoon: false, nextChangeLabel: null });
    });

    it('opens the confirm modal for a long market order', async () => {
        renderForm();
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '500' } });
        await act(async () => { fireEvent.click(screen.getByTestId('trade-button')); });
        expect(screen.getByTestId('confirm-modal-title')).toBeInTheDocument();
        expect(screen.getByText('Side')).toBeInTheDocument();
    });

    it('opens a rich confirm modal: short limit + post-only + bracket + alt collateral', async () => {
        renderForm({ side: 'short' });
        // alt collateral
        fireEvent.click(screen.getByTestId('collateral-selector'));
        const wbtc = screen.getAllByText('WBTC');
        fireEvent.click(wbtc[wbtc.length - 1]);
        // limit + post-only
        fireEvent.click(screen.getByTestId('order-type-limit'));
        fireEvent.click(screen.getByLabelText('Post-only'));
        fireEvent.change(screen.getByTestId('trigger-price'), { target: { value: '50000' } });
        // bracket valid for short: TP below, SL above
        fireEvent.click(screen.getByTestId('bracket-toggle'));
        fireEvent.change(screen.getByTestId('take-profit-price'), { target: { value: '48000' } });
        fireEvent.change(screen.getByTestId('stop-loss-price'), { target: { value: '52000' } });
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '500' } });
        await act(async () => { fireEvent.click(screen.getByTestId('trade-button')); });
        expect(screen.getByTestId('confirm-modal-title')).toBeInTheDocument();
        expect(screen.getAllByText('Collateral Haircut').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Take-Profit').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Stop-Loss').length).toBeGreaterThan(0);
    });
});
