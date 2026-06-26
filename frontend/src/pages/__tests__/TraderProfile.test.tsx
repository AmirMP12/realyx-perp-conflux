import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TraderProfilePage } from '../TraderProfile';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, useNavigate: () => navigateMock };
});

const traderData = {
    address: '0x1234567890123456789012345678901234567890',
    profitFeeBps: 1500,
    metadataURI: 'https://example.com/profile',
    activeFollowers: 12,
    totalPnl: '4200',
    roi: 33.3,
    winRate: 58.5,
    totalTrades: 120,
    openPositions: [
        { market: 'BTC-USD', isLong: true, size: '1000', leverage: '5', entryPrice: '60000', pnl: '150' },
        { market: 'ETH-USD', isLong: false, size: '500', leverage: '3', entryPrice: '3000', pnl: '-50' },
    ],
};

function renderProfile(address = traderData.address) {
    return render(
        <MemoryRouter initialEntries={[`/trader/${address}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
                <Route path="/trader/:address" element={<TraderProfilePage />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('TraderProfilePage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    it('shows loading skeletons initially', () => {
        (global.fetch as any).mockReturnValue(new Promise(() => {}));
        renderProfile();
        // header h1 not yet present during load
        expect(screen.queryByText('Open Positions (2)')).not.toBeInTheDocument();
    });

    it('renders trader profile with positions after fetch', async () => {
        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => traderData });
        renderProfile();
        await waitFor(() => expect(screen.getByText('Open Positions (2)')).toBeInTheDocument());
        expect(screen.getByText(/15.0% Profit Fee/)).toBeInTheDocument();
        expect(screen.getAllByText('BTC-USD').length).toBeGreaterThan(0);
        expect(screen.getByText('https://example.com/profile')).toBeInTheDocument();
    });

    it('renders empty positions message', async () => {
        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ...traderData, openPositions: [] }) });
        renderProfile();
        await waitFor(() => expect(screen.getByText('Open Positions (0)')).toBeInTheDocument());
        expect(screen.getByText(/No open positions/)).toBeInTheDocument();
    });

    it('shows not-found error on 404', async () => {
        (global.fetch as any).mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
        renderProfile();
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Trader not found'));
    });

    it('shows feature-disabled error on 501', async () => {
        (global.fetch as any).mockResolvedValue({ ok: false, status: 501, json: async () => ({}) });
        renderProfile();
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not enabled/));
    });

    it('shows generic error and navigates back to copy trading', async () => {
        (global.fetch as any).mockRejectedValue(new Error('network down'));
        renderProfile();
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('network down'));
        fireEvent.click(screen.getByText('Back to Copy Trading'));
        expect(navigateMock).toHaveBeenCalledWith('/copy-trading');
    });

    it('back button calls navigate(-1)', async () => {
        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => traderData });
        renderProfile();
        await waitFor(() => expect(screen.getByText('Back')).toBeInTheDocument());
        fireEvent.click(screen.getByText('Back'));
        expect(navigateMock).toHaveBeenCalledWith(-1);
    });
});
