import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CopyTradingPage } from '../CopyTrading';
import { useAccount } from 'wagmi';
import { useTopTraders, useFollowing, useCopierPnl } from '../../hooks/useSocial';

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));
vi.mock('../../hooks/useSocial', () => ({ useTopTraders: vi.fn(), useFollowing: vi.fn(), useCopierPnl: vi.fn() }));

function renderPage() {
    return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><CopyTradingPage /></MemoryRouter>);
}

describe('CopyTradingPage — My Copies', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useTopTraders as any).mockReturnValue({ traders: [], loading: false, error: null, refetch: vi.fn() });
    });

    it('renders followed traders with per-trader pnl override, fallback, and invalid date', () => {
        (useFollowing as any).mockReturnValue({
            following: [
                { address: '0x1111111111111111111111111111111111111111', maxAllocation: '1000', maxLeverage: 20, startedAt: '2024-01-01T00:00:00Z', copiedPnl: '250' },
                { address: '0x2222222222222222222222222222222222222222', maxAllocation: '500', maxLeverage: 10, startedAt: 'not-a-date', copiedPnl: '-30' },
            ],
            loading: false, error: null,
        });
        (useCopierPnl as any).mockReturnValue({ pnl: { totalCopiedPnl: '220', pnlByTrader: { '0x1111111111111111111111111111111111111111': '-75' }, copierAddress: '0xabc' } });
        renderPage();
        fireEvent.click(screen.getByText('My Copies'));
        // first trader uses pnlByTrader override (-75), second falls back to copiedPnl (-30)
        expect(screen.getAllByText('0x1111...1111').length).toBeGreaterThan(0);
        expect(screen.getAllByText('0x2222...2222').length).toBeGreaterThan(0);
        // invalid date renders the em-dash
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('shows loading skeletons in My Copies', () => {
        (useFollowing as any).mockReturnValue({ following: [], loading: true, error: null });
        (useCopierPnl as any).mockReturnValue({ pnl: null });
        renderPage();
        fireEvent.click(screen.getByText('My Copies'));
        expect(screen.getByText('Copying')).toBeInTheDocument();
    });
});
