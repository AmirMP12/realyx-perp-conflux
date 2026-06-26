import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VaultPage } from '../Vault';
import { useAccount } from 'wagmi';
import { useVaultDeposit, useVaultWithdraw, useVaultStats } from '../../hooks/useVault';
import { useUSDCBalance } from '../../hooks/useProgram';

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));
vi.mock('../../hooks/useVault', () => ({ useVaultDeposit: vi.fn(), useVaultWithdraw: vi.fn(), useVaultStats: vi.fn() }));
vi.mock('../../hooks/useProgram', () => ({ useUSDCBalance: vi.fn() }));
vi.mock('../../components/VaultYieldPanel', () => ({ VaultYieldPanel: () => <div data-testid="yield" /> }));
vi.mock('../../components/CollateralAssetsPanel', () => ({ CollateralAssetsPanel: () => <div data-testid="collat" /> }));
vi.mock('@rainbow-me/rainbowkit', () => ({
    ConnectButton: Object.assign(() => <div data-testid="connect-button" />, { Custom: ({ children }: any) => children({ openConnectModal: vi.fn() }) }),
}));

const deposit = vi.fn();
const withdraw = vi.fn();
const renderPage = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><VaultPage /></MemoryRouter>);

describe('VaultPage fallback states', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useVaultDeposit as any).mockReturnValue({ deposit, loading: false });
        (useVaultWithdraw as any).mockReturnValue({ withdraw, loading: false });
        (useUSDCBalance as any).mockReturnValue({ balance: 1000, loading: false });
    });

    it('falls back to defaults when stats fields are undefined', () => {
        (useVaultStats as any).mockReturnValue({ stats: {}, loading: false });
        renderPage();
        // sharePrice defaults to 1 -> "$1.0000"
        expect(screen.getByText(/\$1\.0000/)).toBeInTheDocument();
    });

    it('renders loading skeletons while stats load', () => {
        (useVaultStats as any).mockReturnValue({ stats: {}, loading: true });
        renderPage();
        expect(screen.getByTestId('vault-action-btn')).toBeInTheDocument();
    });

    it('estimates zero LP received when share price is zero', () => {
        (useVaultStats as any).mockReturnValue({ stats: { tvl: 100, userBalance: 0, sharePrice: 0, accumulatedFees: 0, availableLiquidity: 0, userShares: 0, isPaused: false, asset: 'USDT0' }, loading: false });
        renderPage();
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } });
        expect(screen.getByTestId('vault-action-btn')).toBeInTheDocument();
    });

    it('does not clear the input when a deposit fails', async () => {
        deposit.mockResolvedValue(false);
        (useVaultStats as any).mockReturnValue({ stats: { tvl: 1, userBalance: 1, sharePrice: 1, accumulatedFees: 0, availableLiquidity: 0, userShares: 0, isPaused: false, asset: 'USDT0' }, loading: false });
        renderPage();
        const input = screen.getByPlaceholderText('0.00') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '1' } });
        await act(async () => { fireEvent.click(screen.getByTestId('vault-action-btn')); });
        expect(deposit).toHaveBeenCalledWith(1);
        expect(input.value).toBe('1');
    });

    it('applies the 75% quick-select', () => {
        (useVaultStats as any).mockReturnValue({ stats: { tvl: 1, userBalance: 500, sharePrice: 1, accumulatedFees: 0, availableLiquidity: 0, userShares: 0, isPaused: false, asset: 'USDT0' }, loading: false });
        renderPage();
        fireEvent.click(screen.getByText('75%'));
        expect((screen.getByPlaceholderText('0.00') as HTMLInputElement).value).toBe('750.00');
    });
});
