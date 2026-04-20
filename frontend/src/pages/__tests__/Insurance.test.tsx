import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InsurancePage } from '../Insurance';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { useAccount } from 'wagmi';
import {
    useInsuranceFund,
    useInsuranceUnstakeStatus,
    useRequestUnstake,
    useStakeInsurance,
    useUnstakeInsurance,
} from '../../hooks/useVault';
import { useBackendStats, useInsuranceClaims } from '../../hooks/useBackend';
import { useUSDCBalance } from '../../hooks/useProgram';

// Mock wagmi
vi.mock('wagmi', () => ({
    useAccount: vi.fn(),
}));

// Mock hooks
vi.mock('../../hooks/useVault', () => ({
    useInsuranceFund: vi.fn(),
    useInsuranceUnstakeStatus: vi.fn(),
    useRequestUnstake: vi.fn(),
    useStakeInsurance: vi.fn(),
    useUnstakeInsurance: vi.fn(),
}));

vi.mock('../../hooks/useBackend', () => ({
    useBackendStats: vi.fn(),
    useInsuranceClaims: vi.fn(),
}));

vi.mock('../../hooks/useProgram', () => ({
    useUSDCBalance: vi.fn(),
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
        button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    },
    AnimatePresence: ({ children }: any) => children,
}));

// Mock RainbowKit
vi.mock('@rainbow-me/rainbowkit', () => ({
    ConnectButton: () => <div data-testid="connect-button" />,
}));
// Mock ConnectButton.Custom
vi.mock('@rainbow-me/rainbowkit', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        ConnectButton: {
            ...actual.ConnectButton,
            Custom: ({ children }: any) => children({ openConnectModal: vi.fn() }),
        }
    };
});

describe('InsurancePage', () => {
    const mockStake = vi.fn();
    const mockUnstake = vi.fn();
    const mockRequestUnstake = vi.fn();
    const mockRefetchUnstakeStatus = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(useAccount).mockReturnValue({ isConnected: true } as any);

        vi.mocked(useInsuranceFund).mockReturnValue({
            insuranceAssets: 1000000,
            healthRatioPercent: 150,
            isHealthy: true,
            userInsuranceBalance: 5000,
            userInsShares: 5000,
            userInsSharesWei: BigInt(5000 * 1e18),
            insSharePrice: 1.0,
            circuitBreakerActive: false,
            loading: false
        } as any);

        vi.mocked(useInsuranceUnstakeStatus).mockReturnValue({
            phase: 'need_request',
            unlockAtSec: null,
            statusError: null,
            loading: false,
            refetch: mockRefetchUnstakeStatus
        } as any);

        vi.mocked(useBackendStats).mockReturnValue({
            stats: { totalLiquidations: '120' },
            loading: false
        } as any);

        vi.mocked(useInsuranceClaims).mockReturnValue({
            claims: [],
            loading: false
        } as any);

        vi.mocked(useStakeInsurance).mockReturnValue({ stake: mockStake, loading: false } as any);
        vi.mocked(useUnstakeInsurance).mockReturnValue({ unstake: mockUnstake, loading: false } as any);
        vi.mocked(useRequestUnstake).mockReturnValue({ requestUnstake: mockRequestUnstake, loading: false } as any);
        vi.mocked(useUSDCBalance).mockReturnValue({ balance: 10000, loading: false } as any);
    });

    const renderWithRouter = (ui: React.ReactElement) => {
        return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>);
    };

    it('renders overall stats and health correctly', () => {
        renderWithRouter(<InsurancePage />);
        expect(screen.getByText('Insurance Assets')).toBeInTheDocument();
        expect(screen.getByText('$1m')).toBeInTheDocument();
        expect(screen.getByText('150.00%')).toBeInTheDocument();
        expect(screen.getByText('Healthy')).toBeInTheDocument();
    });

    it('handles staking workflow', async () => {
        const user = userEvent.setup();
        mockStake.mockResolvedValue(true);
        renderWithRouter(<InsurancePage />);
        
        const input = screen.getByPlaceholderText('0.00');
        await user.type(input, '100');
        
        const stakeBtn = screen.getByRole('button', { name: /Stake Insurance/i });
        await user.click(stakeBtn);
        
        expect(mockStake).toHaveBeenCalledWith(100);
        expect(input).toHaveValue('');
    });

    it('handles unstaking request phase', async () => {
        const user = userEvent.setup();
        renderWithRouter(<InsurancePage />);
        
        await user.click(screen.getByRole('button', { name: /unstake/i }));
        
        const requestBtn = screen.getByText(/Begin unstake waiting period/i);
        await user.click(requestBtn);
        
        expect(mockRequestUnstake).toHaveBeenCalled();
    });

    it('handles unstaking execution phase', async () => {
        const user = userEvent.setup();
        vi.mocked(useInsuranceUnstakeStatus).mockReturnValue({
            phase: 'ready',
            unlockAtSec: null,
            statusError: null,
            loading: false,
            refetch: vi.fn()
        } as any);
        mockUnstake.mockResolvedValue(true);
        
        renderWithRouter(<InsurancePage />);
        
        await user.click(screen.getByRole('button', { name: /unstake/i }));
        
        const input = screen.getByPlaceholderText('0.00');
        await user.type(input, '500');
        
        const unstakeBtn = screen.getByRole('button', { name: /Unstake Insurance/i });
        await user.click(unstakeBtn);
        
        expect(mockUnstake).toHaveBeenCalledWith(500, expect.anything());
    });

    it('handles MAX button correctly', async () => {
        const user = userEvent.setup();
        renderWithRouter(<InsurancePage />);
        
        // Stake mode max (USDC balance)
        const stakeInput = screen.getByPlaceholderText('0.00');
        await user.click(screen.getByTestId('max-button'));
        expect(stakeInput).toHaveValue('10000.00');
        
        // Unstake mode max (Insurance balance)
        const unstakeTab = screen.getByTestId('insurance-tab-unstake');
        await user.click(unstakeTab);
        
        // Verify tab switch
        await waitFor(() => {
            expect(screen.getByTestId('insurance-action-btn')).toHaveTextContent('Unstake Insurance');
        });
        
        // RE-QUERY both input and button because they were unmounted/remounted
        const unstakeInput = screen.getByPlaceholderText('0.00');
        const unstakeMaxBtn = screen.getByTestId('max-button');
        
        await user.click(unstakeMaxBtn);
        expect(unstakeInput).toHaveValue('5000.00');
    });

    it('renders recent claims', () => {
        vi.mocked(useInsuranceClaims).mockReturnValue({
            claims: [
                { id: '1', positionId: '100', submittedAt: new Date().toISOString(), amountUsd: '50', txHash: '0xhash' }
            ],
            loading: false
        } as any);
        
        renderWithRouter(<InsurancePage />);
        expect(screen.getByText('Position #100')).toBeInTheDocument();
        expect(screen.getByText('-$50')).toBeInTheDocument();
    });
});
