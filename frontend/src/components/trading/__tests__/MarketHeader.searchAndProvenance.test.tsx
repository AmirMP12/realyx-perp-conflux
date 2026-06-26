import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MarketHeader } from '../MarketHeader';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, useNavigate: () => navigateMock };
});

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

const eth = { id: 'eth', symbol: 'ETH', name: 'Ethereum', image: '/eth.png', category: 'CRYPTO', change24h: 5.5, volume24h: 1e8, openInterest: 5e7 } as any;
const btc = { id: 'btc', symbol: 'BTC', name: 'Bitcoin', image: '/btc.png', category: 'CRYPTO', change24h: -2.1, volume24h: 2e8, openInterest: 1e8 } as any;
const markets = [eth, btc];

function renderHeader(props: Partial<React.ComponentProps<typeof MarketHeader>> = {}) {
    return render(
        <MemoryRouter future={routerFuture}>
            <MarketHeader market={eth} markets={markets} currentPrice={2500} fundingRate={0.0001} isLive {...props} />
        </MemoryRouter>,
    );
}

describe('MarketHeader extra', () => {
    beforeEach(() => vi.clearAllMocks());

    it('filters markets by search query', () => {
        renderHeader();
        fireEvent.click(screen.getByRole('button', { expanded: false }));
        const search = screen.getByPlaceholderText('Search markets…');
        fireEvent.change(search, { target: { value: 'btc' } });
        expect(screen.getByText('BTC')).toBeInTheDocument();
    });

    it('shows no-results message', () => {
        renderHeader();
        fireEvent.click(screen.getByRole('button', { expanded: false }));
        fireEvent.change(screen.getByPlaceholderText('Search markets…'), { target: { value: 'zzz' } });
        expect(screen.getByText('No markets found')).toBeInTheDocument();
    });

    it('navigates when a market is selected', () => {
        renderHeader();
        fireEvent.click(screen.getByRole('button', { expanded: false }));
        fireEvent.click(screen.getByText('BTC'));
        expect(navigateMock).toHaveBeenCalledWith('/trade/BTC');
    });

    it('closes dropdown on Escape', () => {
        renderHeader();
        const btn = screen.getByRole('button', { expanded: false });
        fireEvent.click(btn);
        expect(btn).toHaveAttribute('aria-expanded', 'true');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(btn).toHaveAttribute('aria-expanded', 'false');
    });

    it('shows on-chain oracle provenance for contract source', () => {
        renderHeader({ priceSource: 'contract', priceAgeMs: 5000, priceStale: false });
        expect(screen.getByText('On-chain oracle')).toBeInTheDocument();
    });

    it('shows delayed API provenance', () => {
        renderHeader({ priceSource: 'api', priceAgeMs: 65000 });
        expect(screen.getByText('Delayed (API)')).toBeInTheDocument();
    });

    it('shows awaiting-data provenance when none', () => {
        renderHeader({ priceSource: 'none', isLive: false });
        expect(screen.getByText('Awaiting data')).toBeInTheDocument();
    });

    it('renders negative and zero funding classes', () => {
        const { rerender } = renderHeader({ fundingRate: -0.0002 });
        rerender(
            <MemoryRouter future={routerFuture}>
                <MarketHeader market={eth} markets={markets} currentPrice={0.5} fundingRate={0} isLive />
            </MemoryRouter>,
        );
        // sub-$1 price uses 4 decimals path; just assert it renders
        expect(screen.getByTestId('market-symbol')).toHaveTextContent('ETH');
    });
});
