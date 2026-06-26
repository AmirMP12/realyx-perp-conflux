import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TraderProfilePage } from '../TraderProfile';

vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, useNavigate: () => vi.fn() };
});

function renderProfile(address = '0x1234567890123456789012345678901234567890') {
    return render(
        <MemoryRouter initialEntries={[`/trader/${address}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
                <Route path="/trader/:address" element={<TraderProfilePage />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('TraderProfilePage edge cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    it('shows the generic "Failed to load" error for non-404/501 statuses', async () => {
        (global.fetch as any).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        renderProfile();
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to load'));
    });

    it('renders a zero-fee trader with negative PnL and ROI', async () => {
        const negTrader = {
            address: '0x1234567890123456789012345678901234567890',
            profitFeeBps: 0,
            metadataURI: '',
            activeFollowers: 0,
            totalPnl: '-1500',
            roi: -12.4,
            winRate: 40,
            totalTrades: 10,
            openPositions: [
                { market: 'BTC-USD', isLong: false, size: '100', leverage: '2', entryPrice: '50000', pnl: '-30' },
            ],
        };
        (global.fetch as any).mockResolvedValue({ ok: true, json: async () => negTrader });
        renderProfile();
        await waitFor(() => expect(screen.getByText('Open Positions (1)')).toBeInTheDocument());
        // No profit-fee chip when profitFeeBps === 0
        expect(screen.queryByText(/Profit Fee/)).not.toBeInTheDocument();
        // metadata section hidden when metadataURI is empty
        expect(screen.queryByText('Trader Profile')).not.toBeInTheDocument();
    });
});
