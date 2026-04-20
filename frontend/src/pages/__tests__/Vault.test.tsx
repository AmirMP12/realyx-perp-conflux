import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VaultPage } from '../Vault';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { useAccount } from 'wagmi';
import { useVaultDeposit, useVaultWithdraw, useVaultStats } from '../../hooks/useVault';
import { useUSDCBalance } from '../../hooks/useProgram';

// Mock wagmi
vi.mock('wagmi', () => ({
    useAccount: vi.fn(),
}));

// Mock hooks
vi.mock('../../hooks/useVault', () => ({
    useVaultDeposit: vi.fn(),
    useVaultWithdraw: vi.fn(),
    useVaultStats: vi.fn(),
}));

vi.mock('../../hooks/useProgram', () => ({
    useUSDCBalance: vi.fn(),
}));

// Mock UI components
vi.mock('../../components/ui', () => ({
    Skeleton: ({ className }: { className?: string }) => <div className={className} data-testid="skeleton" />,
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: any) => {
            const { layoutId, layout, initial, animate, exit, transition, variants, ...rest } = props;
            return <div {...rest}>{children}</div>;
        },
        button: ({ children, ...props }: any) => {
            const { whileHover, whileTap, layoutId, layout, initial, animate, exit, transition, variants, ...rest } = props;
            return <button {...rest}>{children}</button>;
        },
    },
    AnimatePresence: ({ children }: any) => children,
}));

// Mock RainbowKit ConnectButton
vi.mock('@rainbow-me/rainbowkit', () => ({
    ConnectButton: Object.assign(
        ({ label }: any) => <button>{label || 'Connect Wallet'}</button>,
        {
            Custom: ({ children }: any) => children({
                openConnectModal: vi.fn(),
                openAccountModal: vi.fn(),
                openChainModal: vi.fn(),
                mounted: true,
            })
        }
    ),
}));

describe('VaultPage', () => {
    const depositSpy = vi.fn();
    const withdrawSpy = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(useAccount).mockReturnValue({ isConnected: true } as any);
        
        vi.mocked(useVaultDeposit).mockReturnValue({
            deposit: depositSpy,
            loading: false
        });

        vi.mocked(useVaultWithdraw).mockReturnValue({
            withdraw: withdrawSpy,
            loading: false
        });

        vi.mocked(useVaultStats).mockReturnValue({
            stats: {
                tvl: 5000000,
                sharePrice: 1.25,
                userBalance: 1000,
                userShares: 800,
                accumulatedFees: 50000,
                availableLiquidity: 4000000,
                isPaused: false,
                asset: 'USDC'
            },
            loading: false
        });

        vi.mocked(useUSDCBalance).mockReturnValue({
            balance: 5000,
            loading: false
        });
    });

    const renderWithRouter = (ui: React.ReactElement) => {
        return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>);
    };

    it('renders vault stats correctly', () => {
        renderWithRouter(<VaultPage />);
        expect(screen.getByText(/\$5m/i)).toBeInTheDocument();
        expect(screen.getByText(/\$1.25/)).toBeInTheDocument();
        expect(screen.getByText(/\$50,000/)).toBeInTheDocument();
    });

    it('handles deposit action', async () => {
        const user = userEvent.setup();
        renderWithRouter(<VaultPage />);
        
        const input = screen.getByPlaceholderText(/0.00/);
        await user.type(input, '100');
        
        const actionBtn = screen.getByTestId('vault-action-btn');
        await user.click(actionBtn);
        
        expect(depositSpy).toHaveBeenCalledWith(100);
    });

    it('handles withdraw action', async () => {
        const user = userEvent.setup();
        renderWithRouter(<VaultPage />);
        
        const withdrawTab = screen.getByRole('button', { name: /Withdraw/i });
        await user.click(withdrawTab);
        
        await screen.findByText(/USD$/); // Wait for tab switch
        
        const input = screen.getByPlaceholderText(/0.00/);
        await user.type(input, '50');
        
        const actionBtn = screen.getByTestId('vault-action-btn');
        await user.click(actionBtn);
        
        expect(withdrawSpy).toHaveBeenCalledWith(50);
    });

    it('sets max deposit amount correctly', async () => {
        const user = userEvent.setup();
        renderWithRouter(<VaultPage />);
        
        const maxBtn = screen.getByText(/MAX/i);
        await user.click(maxBtn);
        
        const input = screen.getByPlaceholderText(/0.00/) as HTMLInputElement;
        expect(input.value).toBe('5000.00'); // USDC balance
    });

    it('sets max withdraw amount correctly', async () => {
        const user = userEvent.setup();
        renderWithRouter(<VaultPage />);
        
        const withdrawTab = screen.getByRole('button', { name: /Withdraw/i });
        await user.click(withdrawTab);
        
        await screen.findByText(/USD$/); // Wait for tab switch
        
        const maxBtn = screen.getByText(/MAX/i);
        await user.click(maxBtn);
        
        const input = screen.getByPlaceholderText(/0.00/) as HTMLInputElement;
        await waitFor(() => expect(input.value).toBe('1000.00'), { timeout: 2000 });
    });

    it('shows connect wallet button when not connected', () => {
        vi.mocked(useAccount).mockReturnValue({ isConnected: false } as any);
        renderWithRouter(<VaultPage />);
        expect(screen.getAllByText(/Connect Wallet/i).length).toBeGreaterThan(0);
    });

    it('shows loading state on action buttons', () => {
        vi.mocked(useVaultDeposit).mockReturnValue({
            deposit: vi.fn(),
            loading: true
        });
        renderWithRouter(<VaultPage />);
        const actionBtn = screen.getByTestId('vault-action-btn');
        expect(actionBtn).toBeDisabled();
    });
});
