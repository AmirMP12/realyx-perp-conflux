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

const deposit = vi.fn().mockResolvedValue(true);
const withdraw = vi.fn().mockResolvedValue(true);

const stats = { tvl: 1_000_000, userBalance: 500, sharePrice: 1.05, accumulatedFees: 1000, availableLiquidity: 50000, userShares: 480, isPaused: false, asset: 'USDT0' };

const renderPage = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><VaultPage /></MemoryRouter>);

describe('VaultPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useVaultDeposit as any).mockReturnValue({ deposit, loading: false });
        (useVaultWithdraw as any).mockReturnValue({ withdraw, loading: false });
        (useVaultStats as any).mockReturnValue({ stats, loading: false });
        (useUSDCBalance as any).mockReturnValue({ balance: 1000, loading: false });
    });

    it('deposits with a typed amount', async () => {
        renderPage();
        const input = screen.getByPlaceholderText('0.00');
        fireEvent.change(input, { target: { value: '100' } });
        await act(async () => { fireEvent.click(screen.getByTestId('vault-action-btn')); });
        expect(deposit).toHaveBeenCalledWith(100);
    });

    it('uses MAX and percentage quick-selects', () => {
        renderPage();
        const input = screen.getByPlaceholderText('0.00') as HTMLInputElement;
        fireEvent.click(screen.getByText('MAX'));
        expect(input.value).toBe('1000.00');
        fireEvent.click(screen.getByText('25%'));
        expect(input.value).toBe('250.00');
    });

    it('rejects pasted negatives and minus key', () => {
        renderPage();
        const input = screen.getByPlaceholderText('0.00') as HTMLInputElement;
        fireEvent.keyDown(input, { key: '-' });
        const paste = new Event('paste', { bubbles: true, cancelable: true }) as any;
        paste.clipboardData = { getData: () => '-5' };
        fireEvent(input, paste);
        expect(input.value).toBe('');
    });

    it('flags amounts exceeding balance', () => {
        renderPage();
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '99999' } });
        expect(screen.getByText(/exceeds your available balance/)).toBeInTheDocument();
        expect(screen.getByTestId('vault-action-btn')).toBeDisabled();
    });

    it('switches to withdraw and withdraws', async () => {
        renderPage();
        fireEvent.click(screen.getByText('withdraw'));
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '50' } });
        await act(async () => { fireEvent.click(screen.getByTestId('vault-action-btn')); });
        expect(withdraw).toHaveBeenCalledWith(50);
    });

    it('shows connect prompt when disconnected', () => {
        (useAccount as any).mockReturnValue({ isConnected: false });
        renderPage();
        expect(screen.getAllByTestId('connect-button').length).toBeGreaterThan(0);
    });

    it('shows paused status', () => {
        (useVaultStats as any).mockReturnValue({ stats: { ...stats, isPaused: true }, loading: false });
        renderPage();
        expect(screen.getByText('Paused')).toBeInTheDocument();
    });
});
