import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CopyTradingPage } from '../CopyTrading';
import { useAccount } from 'wagmi';
import { useTopTraders, useFollowing, useCopierPnl } from '../../hooks/useSocial';

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));
vi.mock('../../hooks/useSocial', () => ({
    useTopTraders: vi.fn(),
    useFollowing: vi.fn(),
    useCopierPnl: vi.fn(),
}));

const traders = [
    { address: '0x1111111111111111111111111111111111111111', profitFeeBps: 1000, metadataURI: '', activeFollowers: 10, totalPnl: '5000', roi: 25, winRate: 60, totalTrades: 100 },
    { address: '0x2222222222222222222222222222222222222222', profitFeeBps: 0, metadataURI: '', activeFollowers: 5, totalPnl: '-1000', roi: -5, winRate: 40, totalTrades: 50 },
];

function renderPage() {
    return render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <CopyTradingPage />
        </MemoryRouter>,
    );
}

describe('CopyTradingPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useTopTraders as any).mockReturnValue({ traders, loading: false, error: null, refetch: vi.fn() });
        (useFollowing as any).mockReturnValue({ following: [], loading: false, error: null });
        (useCopierPnl as any).mockReturnValue({ pnl: null });
    });

    it('renders header and discover tab with trader cards', () => {
        renderPage();
        expect(screen.getByText('Copy Trading')).toBeInTheDocument();
        expect(screen.getByText('Lead Traders')).toBeInTheDocument();
        expect(screen.getAllByText('0x1111...1111').length).toBeGreaterThan(0);
    });

    it('filters traders by search', () => {
        renderPage();
        const search = screen.getByPlaceholderText('Search by address...');
        fireEvent.change(search, { target: { value: '0x2222' } });
        expect(screen.getByText('0x2222...2222')).toBeInTheDocument();
        expect(screen.queryByText('0x1111...1111')).not.toBeInTheDocument();
    });

    it('changes sort order', () => {
        renderPage();
        fireEvent.click(screen.getByText('PnL'));
        fireEvent.click(screen.getByText('Followers'));
        expect(screen.getByRole('button', { name: 'ROI' })).toBeInTheDocument();
    });

    it('refreshes traders', () => {
        const refetch = vi.fn();
        (useTopTraders as any).mockReturnValue({ traders, loading: false, error: null, refetch });
        renderPage();
        fireEvent.click(screen.getByLabelText('Refresh traders'));
        expect(refetch).toHaveBeenCalled();
    });

    it('shows loading skeletons', () => {
        (useTopTraders as any).mockReturnValue({ traders: [], loading: true, error: null, refetch: vi.fn() });
        renderPage();
        expect(screen.getByText('Copy Trading')).toBeInTheDocument();
    });

    it('shows empty state when no traders', () => {
        (useTopTraders as any).mockReturnValue({ traders: [], loading: false, error: null, refetch: vi.fn() });
        renderPage();
        expect(screen.getByText('No lead traders yet')).toBeInTheDocument();
    });

    it('shows error message', () => {
        (useTopTraders as any).mockReturnValue({ traders: [], loading: false, error: 'boom', refetch: vi.fn() });
        renderPage();
        expect(screen.getByRole('alert')).toHaveTextContent('boom');
    });

    it('switches to My Copies tab and shows empty state when connected', () => {
        renderPage();
        fireEvent.click(screen.getByText('My Copies'));
        expect(screen.getByText("You're not copying anyone yet")).toBeInTheDocument();
    });

    it('shows connect prompt in My Copies when disconnected', () => {
        (useAccount as any).mockReturnValue({ isConnected: false });
        renderPage();
        fireEvent.click(screen.getByText('My Copies'));
        expect(screen.getByText('Connect your wallet')).toBeInTheDocument();
    });

    it('renders followed traders table', () => {
        (useFollowing as any).mockReturnValue({
            following: [
                { address: '0x3333333333333333333333333333333333333333', maxAllocation: '1000', maxLeverage: 20, startedAt: '2024-01-01T00:00:00Z', copiedPnl: '250' },
            ],
            loading: false,
            error: null,
        });
        (useCopierPnl as any).mockReturnValue({ pnl: { totalCopiedPnl: '250', pnlByTrader: {}, copierAddress: '0xabc' } });
        renderPage();
        fireEvent.click(screen.getByText('My Copies'));
        expect(screen.getAllByText('0x3333...3333').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Manage').length).toBeGreaterThan(0);
    });

    it('shows error in My Copies tab', () => {
        (useFollowing as any).mockReturnValue({ following: [], loading: false, error: 'fail' });
        renderPage();
        fireEvent.click(screen.getByText('My Copies'));
        expect(screen.getByRole('alert')).toHaveTextContent('fail');
    });
});
