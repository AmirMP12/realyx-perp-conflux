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
import { showToast } from '../../ui/Toast';

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
const alt = { address: '0xWbtc', symbol: 'WBTC', isUSDC: false, enabled: true, baseHaircutBps: 200, balanceFormatted: 2, effectiveUsdcFormatted: 80000 };

function makeSettings(over: any = {}) {
    return {
        defaultLeverage: 2, defaultOrderType: 'market', maxSlippage: 0.5, confirmTrades: false,
        showPnlPercent: true, liquidationWarnings: true, compactMode: false,
        setMaxSlippage: vi.fn(), setConfirmTrades: vi.fn(), setShowPnlPercent: vi.fn(), setLiquidationWarnings: vi.fn(), setCompactMode: vi.fn(),
        ...over,
    };
}
const market = { id: 'btc', symbol: 'BTC-USD', marketAddress: '0xBTC', fundingRate: 0.0002, category: 'CRYPTO' } as any;
const baseRisk = { totalNotional: 5000, totalCollateral: 1000, maintenanceMargin: 50, unrealizedPnL: 10, crossPositionCount: 2, healthFactor: 2, liquidatable: false, hasPositions: true, loading: false };

let executePosition: any;
function renderForm(props: any = {}, settingsOver: any = {}) {
    (useSettingsStore as any).mockReturnValue(makeSettings(settingsOver));
    return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><TradingForm market={market} currentPrice={50000} {...props} /></MemoryRouter>);
}

describe('TradingForm input modes and preview', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useUSDCBalance as any).mockReturnValue({ balance: 100000, loading: false });
        executePosition = vi.fn().mockResolvedValue(true);
        (useOpenPosition as any).mockReturnValue({ executePosition, isLoading: false, step: 'IDLE' });
        (usePositionsStore as any).mockReturnValue({ addOptimisticPosition: vi.fn(), removeOptimisticPosition: vi.fn() });
        (useCollateralAssets as any).mockReturnValue({ assets: [usdc, alt], usdc, ordersEnabled: true, loading: false });
        (useAccountRisk as any).mockReturnValue(baseRisk);
        (useMarginMode as any).mockReturnValue({ mode: 'isolated', isCross: false, loading: false });
        (useMarketSession as any).mockReturnValue({ isAlwaysOpen: true, state: 'always-open', closingSoon: false, nextChangeLabel: null });
    });

    it('initializes order type to limit from settings.defaultOrderType', () => {
        renderForm({}, { defaultOrderType: 'limit' });
        expect(screen.getByTestId('trigger-price')).toBeInTheDocument();
    });

    it('restores a pending trade by marketAddress match (including trigger price)', () => {
        sessionStorage.setItem('pending_trade', JSON.stringify({
            marketId: 'different', marketAddress: '0xBTC',
            size: '250', leverage: 5, side: 'short', orderType: 'limit', triggerPrice: '48000',
        }));
        renderForm();
        expect((screen.getByTestId('margin-input') as HTMLInputElement).value).toBe('250');
        expect((screen.getByTestId('trigger-price') as HTMLInputElement).value).toBe('48000');
    });

    it('rejects a non-empty amount that parses to zero', () => {
        renderForm();
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '0' } });
        fireEvent.click(screen.getByTestId('trade-button'));
        expect(screen.getByText('Invalid amount')).toBeInTheDocument();
    });

    it('shows APPROVING and COMMITTING status text', () => {
        (useOpenPosition as any).mockReturnValue({ executePosition, isLoading: true, step: 'APPROVING' });
        const { unmount } = renderForm();
        expect(screen.getByText(/Approving/)).toBeInTheDocument();
        unmount();
        (useOpenPosition as any).mockReturnValue({ executePosition, isLoading: true, step: 'COMMITTING' });
        renderForm();
        expect(screen.getByText(/Committing/)).toBeInTheDocument();
    });

    it('edits the custom max-slippage input', () => {
        const settings = makeSettings();
        (useSettingsStore as any).mockReturnValue(settings);
        render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><TradingForm market={market} currentPrice={50000} /></MemoryRouter>);
        fireEvent.click(screen.getByLabelText(/Trading settings/i));
        const custom = screen.getByPlaceholderText('Custom') as HTMLInputElement;
        fireEvent.change(custom, { target: { value: '2.5' } });
        expect(settings.setMaxSlippage).toHaveBeenCalledWith(2.5);
        fireEvent.change(custom, { target: { value: 'abc' } });
        expect(settings.setMaxSlippage).toHaveBeenCalledWith(0);
    });

    it('toggles amount mode with no input (skips conversion)', () => {
        renderForm();
        fireEvent.click(screen.getByTestId('amount-mode-size'));
        fireEvent.click(screen.getByTestId('amount-mode-pay'));
        expect(screen.getByTestId('amount-mode-pay')).toBeInTheDocument();
    });

    it('applies percentage and max buttons in both pay and size modes', () => {
        renderForm();
        // pay mode percentage + max
        fireEvent.click(screen.getByText('25%'));
        fireEvent.click(screen.getByText('Max'));
        // switch to size mode and use them again
        fireEvent.click(screen.getByTestId('amount-mode-size'));
        fireEvent.click(screen.getByText('50%'));
        fireEvent.click(screen.getByText('75%'));
        fireEvent.click(screen.getByText('Max'));
        expect((screen.getByTestId('margin-input') as HTMLInputElement).value).not.toBe('');
    });

    it('uses the "max size at leverage" helper button', () => {
        renderForm();
        const maxSize = screen.getByText(/Max size at/);
        fireEvent.click(maxSize);
        expect((screen.getByTestId('margin-input') as HTMLInputElement).value).not.toBe('');
        // and in size mode
        fireEvent.click(screen.getByTestId('amount-mode-size'));
        fireEvent.click(screen.getByText(/Max size at/));
        expect((screen.getByTestId('margin-input') as HTMLInputElement).value).not.toBe('');
    });

    it('renders the liquidation panel at several leverages (safe/warn/danger tones)', () => {
        renderForm();
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        for (const lev of ['2x', '6x', '8x', '10x']) {
            fireEvent.click(screen.getByText(lev));
        }
        expect(screen.getByTestId('liq-price')).toBeInTheDocument();
    });

    it('renders the closed-session gap warning with a null next-change label', () => {
        (useMarketSession as any).mockReturnValue({ isAlwaysOpen: false, state: 'closed', closingSoon: false, nextChangeLabel: null });
        renderForm({ market: { ...market, category: 'STOCK' } });
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        expect(screen.getByText(/overnight gap risk/)).toBeInTheDocument();
    });

    it('opens the confirm modal for a limit GTC order (post-only off)', async () => {
        renderForm({}, { confirmTrades: true, defaultOrderType: 'limit' });
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        fireEvent.change(screen.getByTestId('trigger-price'), { target: { value: '49000' } });
        await act(async () => { fireEvent.click(screen.getByTestId('trade-button')); });
        expect(screen.getByText('GTC')).toBeInTheDocument();
    });

    it('executes directly when confirmTrades is off and reports failure', async () => {
        executePosition.mockResolvedValue(false);
        renderForm({}, { confirmTrades: false });
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        await act(async () => { fireEvent.click(screen.getByTestId('trade-button')); });
        expect(executePosition).toHaveBeenCalled();
    });

    it('surfaces a thrown error from executePosition', async () => {
        executePosition.mockRejectedValue(new Error('on-chain boom'));
        renderForm({}, { confirmTrades: false });
        fireEvent.change(screen.getByTestId('margin-input'), { target: { value: '100' } });
        await act(async () => { fireEvent.click(screen.getByTestId('trade-button')); });
        expect(showToast).toHaveBeenCalledWith('error', 'Trade Failed', expect.any(String));
    });

    it('renders the Connect Wallet button when disconnected', () => {
        (useAccount as any).mockReturnValue({ isConnected: false });
        renderForm();
        expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
    });

    it('shows the mint-USDT0 link when the wallet balance is exactly zero', () => {
        (useUSDCBalance as any).mockReturnValue({ balance: 0, loading: false });
        renderForm();
        expect(screen.getByText(/Mint test USDT0/)).toBeInTheDocument();
    });
});
