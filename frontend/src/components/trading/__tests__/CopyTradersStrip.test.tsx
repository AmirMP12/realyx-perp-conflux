import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CopyTradersStrip } from '../CopyTradersStrip';
import { useTopTraders } from '../../../hooks/useSocial';

vi.mock('../../../hooks/useSocial', () => ({ useTopTraders: vi.fn() }));

const traders = [
    { address: '0x1111111111111111111111111111111111111111', profitFeeBps: 0, metadataURI: '', activeFollowers: 10, totalPnl: '5000', roi: 25, winRate: 60, totalTrades: 10 },
    { address: '0x2222222222222222222222222222222222222222', profitFeeBps: 0, metadataURI: '', activeFollowers: 5, totalPnl: '-200', roi: -3, winRate: 40, totalTrades: 5 },
    { address: '0x3333333333333333333333333333333333333333', profitFeeBps: 0, metadataURI: '', activeFollowers: 2, totalPnl: '100', roi: 1, winRate: 50, totalTrades: 2 },
    { address: '0x4444444444444444444444444444444444444444', profitFeeBps: 0, metadataURI: '', activeFollowers: 1, totalPnl: '50', roi: 0.5, winRate: 50, totalTrades: 1 },
    { address: '0x5555555555555555555555555555555555555555', profitFeeBps: 0, metadataURI: '', activeFollowers: 0, totalPnl: '0', roi: 0, winRate: 0, totalTrades: 0 },
];

function renderStrip() {
    return render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <CopyTradersStrip />
        </MemoryRouter>,
    );
}

describe('CopyTradersStrip', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders nothing while loading', () => {
        (useTopTraders as any).mockReturnValue({ traders: [], loading: true });
        const { container } = renderStrip();
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when no traders', () => {
        (useTopTraders as any).mockReturnValue({ traders: [], loading: false });
        const { container } = renderStrip();
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the top 4 traders with ROI', () => {
        (useTopTraders as any).mockReturnValue({ traders, loading: false });
        renderStrip();
        expect(screen.getByText('Copy top traders')).toBeInTheDocument();
        expect(screen.getByText('+25.0%')).toBeInTheDocument();
        expect(screen.getByText('-3.0%')).toBeInTheDocument();
        // only 4 shown
        expect(screen.queryByText('0x5555...5555')).not.toBeInTheDocument();
        expect(screen.getByText('View all')).toBeInTheDocument();
    });
});
