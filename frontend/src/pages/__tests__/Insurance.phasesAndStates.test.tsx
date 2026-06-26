import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InsurancePage } from '../Insurance';
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

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));
vi.mock('../../hooks/useVault', () => ({
    useInsuranceFund: vi.fn(),
    useInsuranceUnstakeStatus: vi.fn(),
    useRequestUnstake: vi.fn(),
    useStakeInsurance: vi.fn(),
    useUnstakeInsurance: vi.fn(),
}));
vi.mock('../../hooks/useBackend', () => ({ useBackendStats: vi.fn(), useInsuranceClaims: vi.fn() }));
vi.mock('../../hooks/useProgram', () => ({ useUSDCBalance: vi.fn() }));
vi.mock('framer-motion', () => ({
    motion: { div: ({ children, ...p }: any) => <div {...p}>{children}</div>, button: ({ children, ...p }: any) => <button {...p}>{children}</button> },
    AnimatePresence: ({ children }: any) => children,
}));
vi.mock('@rainbow-me/rainbowkit', () => ({
    ConnectButton: Object.assign(() => <div data-testid="connect-button" />, { Custom: ({ children }: any) => children({ openConnectModal: vi.fn() }) }),
}));

const renderPage = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><InsurancePage /></MemoryRouter>);

const fund = {
    insuranceAssets: 1_000_000, healthRatioPercent: 150, isHealthy: true,
    userInsuranceBalance: 5000, userInsShares: 5000, userInsSharesWei: BigInt(5000) * 10n ** 18n,
    insSharePrice: 1, circuitBreakerActive: false, loading: false,
};

describe('InsurancePage extra', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useInsuranceFund as any).mockReturnValue(fund);
        (useInsuranceUnstakeStatus as any).mockReturnValue({ phase: 'need_request', unlockAtSec: null, statusError: null, loading: false, refetch: vi.fn() });
        (useBackendStats as any).mockReturnValue({ stats: { totalLiquidations: '5' }, loading: false });
        (useInsuranceClaims as any).mockReturnValue({ claims: [], loading: false });
        (useStakeInsurance as any).mockReturnValue({ stake: vi.fn(), loading: false });
        (useUnstakeInsurance as any).mockReturnValue({ unstake: vi.fn(), loading: false });
        (useRequestUnstake as any).mockReturnValue({ requestUnstake: vi.fn(), loading: false });
        (useUSDCBalance as any).mockReturnValue({ balance: 10000, loading: false });
    });

    it('shows connect prompts when disconnected', () => {
        (useAccount as any).mockReturnValue({ isConnected: false });
        renderPage();
        expect(screen.getAllByText(/Connect/i).length).toBeGreaterThan(0);
        expect(screen.getAllByTestId('connect-button').length).toBeGreaterThan(0);
    });

    it('renders claims loading skeletons', () => {
        (useInsuranceClaims as any).mockReturnValue({ claims: [], loading: true });
        renderPage();
        expect(screen.getByText('Recent Claims')).toBeInTheDocument();
    });

    it('renders the cooldown phase', () => {
        (useInsuranceUnstakeStatus as any).mockReturnValue({
            phase: 'cooldown', unlockAtSec: Math.floor(Date.now() / 1000) + 3600, statusError: null, loading: false, refetch: vi.fn(),
        });
        renderPage();
        expect(screen.getByText('Insurance Assets')).toBeInTheDocument();
    });

    it('renders a status error phase', () => {
        (useInsuranceUnstakeStatus as any).mockReturnValue({
            phase: 'error', unlockAtSec: null, statusError: 'rpc down', loading: false, refetch: vi.fn(),
        });
        renderPage();
        expect(screen.getByText('Insurance Assets')).toBeInTheDocument();
    });

    it('reflects an unhealthy fund with circuit breaker active', () => {
        (useInsuranceFund as any).mockReturnValue({ ...fund, isHealthy: false, healthRatioPercent: 40, circuitBreakerActive: true });
        renderPage();
        expect(screen.getByText('40.00%')).toBeInTheDocument();
    });
});
