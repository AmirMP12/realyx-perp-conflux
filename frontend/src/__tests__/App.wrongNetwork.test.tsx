import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { useMarkets } from '../hooks/useBackend';
import toast from 'react-hot-toast';

vi.mock('../components/ProtocolStatsBar', () => ({ ProtocolStatsBar: () => <div /> }));
vi.mock('../components/OnboardingChecklist', () => ({ OnboardingChecklist: () => null }));

vi.mock('wagmi', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, useAccount: vi.fn(), useChainId: vi.fn(), useSwitchChain: vi.fn() };
});
vi.mock('../hooks/useBackend', () => ({ useMarkets: vi.fn() }));
vi.mock('react-hot-toast', () => {
    const fn: any = vi.fn();
    fn.dismiss = vi.fn();
    fn.error = vi.fn();
    return { default: fn };
});

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };
const switchChain = vi.fn();

describe('App wrong-network toast', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.setItem('realyx_risk_disclosure_seen', 'true');
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useChainId as any).mockReturnValue(1); // wrong chain
        (useSwitchChain as any).mockReturnValue({ switchChain });
        (useMarkets as any).mockReturnValue({ markets: [] });
    });

    it('renders the toast switch action and triggers switchChain', () => {
        render(<MemoryRouter future={routerFuture}><App /></MemoryRouter>);
        // The wrong-network toast is invoked with a render function.
        const call = (toast as any).mock.calls.find((c: any[]) => typeof c[0] === 'function');
        expect(call).toBeTruthy();
        const renderFn = call[0];
        const dismiss = vi.fn();
        render(renderFn({ id: 'network-default-warning' }) as any, { container: document.body.appendChild(document.createElement('div')) });
        fireEvent.click(screen.getByText('Switch network'));
        expect(switchChain).toHaveBeenCalledWith({ chainId: expect.any(Number) });
    });

    it('dismisses the warning when on the correct chain', () => {
        (useChainId as any).mockReturnValue(71);
        render(<MemoryRouter future={routerFuture}><App /></MemoryRouter>);
        expect(toast.dismiss).toHaveBeenCalledWith('network-default-warning');
    });
});
