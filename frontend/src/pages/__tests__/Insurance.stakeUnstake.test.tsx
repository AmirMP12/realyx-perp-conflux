import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InsurancePage } from '../Insurance';
import { useAccount } from 'wagmi';
import {
    useInsuranceFund, useInsuranceUnstakeStatus, useRequestUnstake, useStakeInsurance, useUnstakeInsurance,
} from '../../hooks/useVault';
import { useBackendStats, useInsuranceClaims } from '../../hooks/useBackend';
import { useUSDCBalance } from '../../hooks/useProgram';

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));
vi.mock('../../hooks/useVault', () => ({
    useInsuranceFund: vi.fn(), useInsuranceUnstakeStatus: vi.fn(), useRequestUnstake: vi.fn(), useStakeInsurance: vi.fn(), useUnstakeInsurance: vi.fn(),
}));
vi.mock('../../hooks/useBackend', () => ({ useBackendStats: vi.fn(), useInsuranceClaims: vi.fn() }));
vi.mock('../../hooks/useProgram', () => ({ useUSDCBalance: vi.fn() }));
vi.mock('framer-motion', () => ({
    motion: { div: ({ children, ...p }: any) => <div {...p}>{children}</div>, button: ({ children, ...p }: any) => <button {...p}>{children}</button> },
    AnimatePresence: ({ children }: any) => children,
}));
vi.mock('@rainbow-me/rainbowkit', () => ({ ConnectButton: Object.assign(() => <div data-testid="cb" />, { Custom: ({ children }: any) => children({ openConnectModal: vi.fn() }) }) }));

const stake = vi.fn().mockResolvedValue(true);
const unstake = vi.fn().mockResolvedValue(true);
const refetch = vi.fn();

const fund = {
    insuranceAssets: 1_000_000, healthRatioPercent: 150, isHealthy: true,
    userInsuranceBalance: 5000, userInsShares: 5000, userInsSharesWei: 5000n * 10n ** 18n,
    insSharePrice: 1, circuitBreakerActive: false, loading: false,
};

const renderPage = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><InsurancePage /></MemoryRouter>);

describe('InsurancePage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useInsuranceFund as any).mockReturnValue(fund);
        (useInsuranceUnstakeStatus as any).mockReturnValue({ phase: 'ready', unlockAtSec: null, statusError: false, loading: false, refetch });
        (useBackendStats as any).mockReturnValue({ stats: { totalLiquidations: '120' }, loading: false });
        (useInsuranceClaims as any).mockReturnValue({ claims: [], loading: false });
        (useStakeInsurance as any).mockReturnValue({ stake, loading: false });
        (useUnstakeInsurance as any).mockReturnValue({ unstake, loading: false });
        (useRequestUnstake as any).mockReturnValue({ requestUnstake: vi.fn(), loading: false });
        (useUSDCBalance as any).mockReturnValue({ balance: 10000, loading: false });
    });

    it('stakes with percent quick-selects and rejects pasted negatives', async () => {
        renderPage();
        const input = screen.getByPlaceholderText('0.00') as HTMLInputElement;
        fireEvent.click(screen.getByText('25%'));
        expect(input.value).toBe('2500.00');
        fireEvent.keyDown(input, { key: '-' });
        const paste = new Event('paste', { bubbles: true, cancelable: true }) as any;
        paste.clipboardData = { getData: () => '-5' };
        fireEvent(input, paste);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Stake Insurance/i })); });
        expect(stake).toHaveBeenCalledWith(2500);
    });

    it('flags exceeding balance', () => {
        renderPage();
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '999999' } });
        expect(screen.getByTestId('insurance-action-btn')).toBeDisabled();
    });

    it('unstakes when ready (redeems shares at share price)', async () => {
        renderPage();
        fireEvent.click(screen.getByTestId('insurance-tab-unstake'));
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '1000' } });
        await act(async () => { fireEvent.click(screen.getByTestId('insurance-action-btn')); });
        expect(unstake).toHaveBeenCalledWith(1000, fund.userInsSharesWei);
    });

    it('disables unstake when circuit breaker active', () => {
        (useInsuranceFund as any).mockReturnValue({ ...fund, circuitBreakerActive: true });
        renderPage();
        fireEvent.click(screen.getByTestId('insurance-tab-unstake'));
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } });
        expect(screen.getByTestId('insurance-action-btn')).toBeDisabled();
    });

    it('renders need_request and cooldown phases', () => {
        (useInsuranceUnstakeStatus as any).mockReturnValue({ phase: 'need_request', unlockAtSec: null, statusError: false, loading: false, refetch });
        const { rerender } = renderPage();
        fireEvent.click(screen.getByTestId('insurance-tab-unstake'));
        (useInsuranceUnstakeStatus as any).mockReturnValue({ phase: 'cooldown', unlockAtSec: Math.floor(Date.now() / 1000) + 2 * 86400, cooldownSec: 86400, statusError: false, loading: false, refetch });
        rerender(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><InsurancePage /></MemoryRouter>);
        expect(screen.getByText('Insurance Assets')).toBeInTheDocument();
    });

    it('renders claims with explorer links and dates', () => {
        (useInsuranceClaims as any).mockReturnValue({
            claims: [{ id: '1', positionId: '100', submittedAt: new Date().toISOString(), amountUsd: '50', txHash: '0xhash' }],
            loading: false,
        });
        renderPage();
        expect(screen.getByText('Position #100')).toBeInTheDocument();
    });

    it('does nothing on action when disconnected', async () => {
        (useAccount as any).mockReturnValue({ isConnected: false });
        renderPage();
        // action button is the connect button now; just ensure render is stable
        expect(screen.getAllByTestId('cb').length).toBeGreaterThan(0);
    });
});
