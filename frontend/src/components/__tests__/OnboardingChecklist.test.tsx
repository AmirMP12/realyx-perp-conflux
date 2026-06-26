import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingChecklist } from '../OnboardingChecklist';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { useUSDCBalance } from '../../hooks/useProgram';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('wagmi', () => ({
    useAccount: vi.fn(),
    useChainId: vi.fn(),
    useSwitchChain: vi.fn(),
}));

vi.mock('../../hooks/useProgram', () => ({
    useUSDCBalance: vi.fn(),
}));

vi.mock('../../config/wagmi', () => ({
    realyxChains: [{ id: 71 }],
}));

const switchChain = vi.fn();

function renderChecklist() {
    return render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <OnboardingChecklist />
        </MemoryRouter>,
    );
}

describe('OnboardingChecklist', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        (useAccount as any).mockReturnValue({ isConnected: false });
        (useChainId as any).mockReturnValue(1);
        (useSwitchChain as any).mockReturnValue({ switchChain });
        (useUSDCBalance as any).mockReturnValue({ balance: 0 });
    });

    it('renders the connect step first when disconnected', () => {
        renderChecklist();
        expect(screen.getByText('Get started')).toBeInTheDocument();
        expect(screen.getByText('0 of 4 steps')).toBeInTheDocument();
        expect(screen.getByText('Connect')).toBeInTheDocument();
    });

    it('returns null when previously dismissed', () => {
        localStorage.setItem('realyx_onboarding_dismissed_v1', 'true');
        const { container } = renderChecklist();
        expect(container).toBeEmptyDOMElement();
    });

    it('dismisses and persists when X clicked', () => {
        renderChecklist();
        fireEvent.click(screen.getByLabelText('Dismiss onboarding'));
        expect(localStorage.getItem('realyx_onboarding_dismissed_v1')).toBe('true');
    });

    it('collapses and expands', () => {
        renderChecklist();
        const toggle = screen.getByLabelText('Collapse checklist');
        fireEvent.click(toggle);
        expect(screen.getByLabelText('Expand checklist')).toBeInTheDocument();
    });

    it('shows the network step when connected on wrong chain', () => {
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useChainId as any).mockReturnValue(1);
        renderChecklist();
        const switchBtn = screen.getByText('Switch');
        fireEvent.click(switchBtn);
        expect(switchChain).toHaveBeenCalledWith({ chainId: 71 });
    });

    it('shows the mint step when connected on correct chain without funds', () => {
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useChainId as any).mockReturnValue(71);
        (useUSDCBalance as any).mockReturnValue({ balance: 0 });
        renderChecklist();
        fireEvent.click(screen.getByText('Mint'));
        expect(navigateMock).toHaveBeenCalledWith('/settings');
    });

    it('shows the trade step when fully set up and navigates on trade', () => {
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useChainId as any).mockReturnValue(71);
        (useUSDCBalance as any).mockReturnValue({ balance: 100 });
        renderChecklist();
        expect(screen.getByText('3 of 4 steps')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Trade'));
        expect(navigateMock).toHaveBeenCalledWith('/trade');
        expect(localStorage.getItem('realyx_onboarding_dismissed_v1')).toBe('true');
    });
});
