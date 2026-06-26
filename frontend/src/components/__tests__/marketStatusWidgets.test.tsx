import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MarketSessionBadge } from '../MarketSessionBadge';
import { MarketStatusBadge } from '../MarketStatusBadge';
import { MarketLogo } from '../MarketLogo';
import { FundingCountdown } from '../trading/FundingCountdown';
import { MobileControls } from '../trading/MobileControls';
import { useMarketSession } from '../../hooks/useMarketSession';

vi.mock('../../hooks/useMarketSession', () => ({ useMarketSession: vi.fn() }));

describe('MarketSessionBadge', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows 24/7 for always-open markets', () => {
        (useMarketSession as any).mockReturnValue({ isAlwaysOpen: true, state: 'always-open' });
        render(<MarketSessionBadge category="CRYPTO" />);
        expect(screen.getByText('24/7')).toBeInTheDocument();
    });

    it('shows market open with countdown', () => {
        (useMarketSession as any).mockReturnValue({ isAlwaysOpen: false, state: 'open', closingSoon: false, nextChangeLabel: 'Closes in 2h' });
        render(<MarketSessionBadge category="STOCK" />);
        expect(screen.getByText('Market open')).toBeInTheDocument();
        expect(screen.getByText(/Closes in 2h/)).toBeInTheDocument();
    });

    it('uses amber tone when closing soon', () => {
        (useMarketSession as any).mockReturnValue({ isAlwaysOpen: false, state: 'open', closingSoon: true, nextChangeLabel: 'Closes in 5m' });
        render(<MarketSessionBadge category="STOCK" compact />);
        expect(screen.getByText('Market open')).toBeInTheDocument();
        // compact omits the countdown text
        expect(screen.queryByText(/·/)).not.toBeInTheDocument();
    });

    it('shows market closed', () => {
        (useMarketSession as any).mockReturnValue({ isAlwaysOpen: false, state: 'closed', closingSoon: false, nextChangeLabel: 'Reopens in 14h' });
        render(<MarketSessionBadge category="STOCK" />);
        expect(screen.getByText('Market closed')).toBeInTheDocument();
    });
});

describe('MarketStatusBadge', () => {
    it('renders the active state', () => {
        render(<MarketStatusBadge />);
        expect(screen.getByText('Market Active')).toBeInTheDocument();
    });
});

describe('MarketLogo', () => {
    it('renders an image and falls back to initials on error', () => {
        const { container } = render(<MarketLogo src="logo.png" symbol="BTC-USD" name="Bitcoin" />);
        const img = container.querySelector('img')!;
        expect(img).toBeInTheDocument();
        fireEvent.error(img);
        expect(screen.getByText('BT')).toBeInTheDocument();
    });

    it('renders initials when no src', () => {
        render(<MarketLogo src={undefined} symbol="E" />);
        expect(screen.getByText('E')).toBeInTheDocument();
    });

    it('renders ? when symbol is empty', () => {
        render(<MarketLogo src={undefined} symbol="" />);
        expect(screen.getByText('?')).toBeInTheDocument();
    });
});

describe('FundingCountdown', () => {
    it('renders the next funding countdown', () => {
        render(<FundingCountdown />);
        expect(screen.getByText(/Next funding:/)).toBeInTheDocument();
    });
});

describe('MobileControls', () => {
    it('switches tabs on click', () => {
        const setActiveTab = vi.fn();
        render(<MobileControls activeTab="chart" setActiveTab={setActiveTab} />);
        fireEvent.click(screen.getByText('trade'));
        expect(setActiveTab).toHaveBeenCalledWith('trade');
    });
});
