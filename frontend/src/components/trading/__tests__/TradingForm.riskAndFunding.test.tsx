import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
vi.mock('../../../hooks/useProgram', () => ({
    useOpenPosition: vi.fn(), useUSDCBalance: vi.fn(), useMarginMode: vi.fn(),
    OrderType: { MARKET_INCREASE: 'MARKET_INCREASE', LIMIT_INCREASE: 'LIMIT_INCREASE' },
}));
vi.mock('../../../hooks/useCollateral', () => ({ useCollateralAssets: vi.fn(), formatHaircut: (b: number) => `${b / 100}%` }));
vi.mock('../../../stores', () => ({ usePositionsStore: vi.fn(), useMarketsStore: vi.fn() }));
vi.mock('../../../stores/settingsStore', () => ({ useSettingsStore: vi.fn() }));
vi.mock('../../../hooks/useAccountRisk', () => ({ useAccountRisk: vi.fn() }));
vi.mock('../../ui/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../../../hooks/useSound', () => ({ useSound: () => ({ playSuccess: vi.fn(), playError: vi.fn() }) }));
vi.mock('../../../hooks/useMarketSession', () => ({ useMarketSession: vi.fn() }));

const usdc = { address: '0x0000000000000000000000000000000000000000', symbol: 'USDT0', isUSDC: true, enabled: true, baseHaircutBps: 0, balanceFormatted: 0, effectiveUsdcFormatted: 0 };
const alt = { address: '0xWbtc', symbol: 'WBTC', isUSDC: false, enabled: true, baseHaircutBps: 200, balanceFormatted: 2, effectiveUsdcFormatted: 80000 };

const settings = {
    defaultLeverage: 2, defaultOrderType: 'market', maxSlippage: 0.5, confirmTrades: false,
    showPnlPercent: true, liquidationWarnings: true, compactMode: false,
    setMaxSlippage: vi.fn(), setConfirmTrades: vi.fn(), setShowPnlPercent: vi.fn(), setLiquidationWarnings: vi.fn(), setCompactMode: vi.fn(),
};
const market = { id: 'btc', symbol: 'BTC-USD', marketAddress: '0xBTC', fundingRate: 0.0002, category: 'CRYPTO' } as any;

function render2(risk: any, marginMode = 'cross') {
    (useMarginMode as any).mockReturnValue({ mode: marginMode, isCross: marginMode === 'cross', loading: false });
    (useAccountRisk as any).mockReturnValue(risk);
    return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><TradingForm market={market} currentPrice={50000} /></MemoryRouter>);
}

const baseRisk = { totalNotional: 5000, totalCollateral: 1000, maintenanceMargin: 50, unrealizedPnL: 10, crossPositionCount: 2, liquidatable: false, hasPositions: true, loading: false };

describe('TradingForm risk and funding', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useUSDCBalance as any).mockReturnValue({ balance: 100000, loading: false });
        (useOpenPosition as any).mockReturnValue({ executePosition: vi.fn().mockResolvedValue(true), isLoading: false, step: 'IDLE' });
        (usePositionsStore as any).mockReturnValue({ addOptimisticPosition: vi.fn(), removeOptimisticPosition: vi.fn() });
        (useSettingsStore as any).mockReturnValue(settings);
        (useCollateralAssets as any).mockReturnValue({ assets: [usdc, alt], usdc, ordersEnabled: true, loading: false });
        (useMarketSession as any).mockReturnValue({ isAlwaysOpen: true, state: 'always-open', closingSoon: false, nextChangeLabel: null });
    });

    it('renders account health (danger) for a finite low health factor', () => {
        render2({ ...baseRisk, healthFactor: 1.05, crossPositionCount: 1 });
        expect(screen.getAllByText('Account Health').length).toBeGreaterThan(0);
        expect(screen.getByText(/At risk/)).toBeInTheDocument();
    });

    it('renders account health (warn) for a mid health factor', () => {
        render2({ ...baseRisk, healthFactor: 1.3 });
        expect(screen.getByText(/Caution/)).toBeInTheDocument();
    });

    it('renders account health (infinite) as ∞', () => {
        render2({ ...baseRisk, healthFactor: Infinity });
        expect(screen.getByText(/∞/)).toBeInTheDocument();
    });

    it('shows liquidation risk warning at high leverage', () => {
        render2({ ...baseRisk, healthFactor: 2 });
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        fireEvent.click(screen.getByText('10x'));
        expect(screen.getByTestId('liq-price')).toBeInTheDocument();
    });

    it('shows alt-collateral summary rows when an alt is selected', () => {
        render2({ ...baseRisk, healthFactor: 2 });
        fireEvent.click(screen.getByTestId('collateral-selector'));
        const wbtc = screen.getAllByText('WBTC');
        fireEvent.click(wbtc[wbtc.length - 1]);
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        expect(screen.getByText('Collateral Haircut')).toBeInTheDocument();
    });

    it('shows bracket summary rows for a valid TP/SL', () => {
        render2({ ...baseRisk, healthFactor: 2 });
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        fireEvent.click(screen.getByTestId('bracket-toggle'));
        fireEvent.change(screen.getByTestId('take-profit-price'), { target: { value: '55000' } });
        fireEvent.change(screen.getByTestId('stop-loss-price'), { target: { value: '45000' } });
        expect(screen.getByText('Take-Profit')).toBeInTheDocument();
        expect(screen.getByText('Stop-Loss')).toBeInTheDocument();
    });

    it('shows funding "you earn" for a short when long pays', () => {
        render2({ ...baseRisk, healthFactor: 2 }, 'isolated');
        // default side long -> "You pay"; switch to short -> "You earn"
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        fireEvent.click(screen.getByText('Short'));
        expect(screen.getByText(/You earn/)).toBeInTheDocument();
    });

    it('shows neutral funding when rate is zero', () => {
        (useMarketSession as any).mockReturnValue({ isAlwaysOpen: true, state: 'always-open', closingSoon: false, nextChangeLabel: null });
        (useMarginMode as any).mockReturnValue({ mode: 'isolated', isCross: false, loading: false });
        (useAccountRisk as any).mockReturnValue({ ...baseRisk, healthFactor: 2, hasPositions: false });
        render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><TradingForm market={{ ...market, fundingRate: 0 }} currentPrice={50000} /></MemoryRouter>);
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        expect(screen.getByText('Flat')).toBeInTheDocument();
    });
});
