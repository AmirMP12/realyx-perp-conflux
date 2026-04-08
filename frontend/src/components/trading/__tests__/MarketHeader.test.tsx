import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarketHeader } from '../MarketHeader';
import { MemoryRouter } from 'react-router-dom';

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

const mockMarket = {
    id: 'eth',
    symbol: 'ETH',
    name: 'Ethereum',
    image: '/eth.png',
    category: 'CRYPTO',
    change24h: 5.5,
    volume24h: 100000000,
    openInterest: 50000000,
} as any;

const mockMarkets = [mockMarket, {
    id: 'btc',
    symbol: 'BTC',
    name: 'Bitcoin',
    image: '/btc.png',
    category: 'CRYPTO',
    change24h: -2.1,
    volume24h: 200000000,
    openInterest: 100000000,
}];

describe('MarketHeader', () => {
    it('renders market info and stats', () => {
        render(
            <MemoryRouter future={routerFuture}>
                <MarketHeader 
                    market={mockMarket} 
                    markets={mockMarkets as any} 
                    currentPrice={2500} 
                    fundingRate={0.0001} 
                    isLive={true} 
                />
            </MemoryRouter>
        );
        
        expect(screen.getByTestId('market-symbol')).toHaveTextContent('ETH');
        expect(screen.getAllByText('Ethereum')[0]).toBeInTheDocument();
        // The same change text appears in multiple responsive sections.
        expect(screen.getAllByText(/5\.50\s*%/).length).toBeGreaterThan(0);
        expect(screen.getByText(/\$\s*100\.0\s*M/)).toBeInTheDocument(); // 100M Vol
    });

    it('toggles market dropdown', () => {
        render(
            <MemoryRouter future={routerFuture}>
                <MarketHeader 
                    market={mockMarket} 
                    markets={mockMarkets as any} 
                    currentPrice={2500} 
                    fundingRate={0.0001} 
                    isLive={true} 
                />
            </MemoryRouter>
        );
        
        const dropdownBtn = screen.getByRole('button', { expanded: false });
        fireEvent.click(dropdownBtn);
        
        const listbox = screen.getByRole('listbox');
        expect(dropdownBtn).toHaveAttribute('aria-expanded', 'true');
        expect(listbox.className).toContain('visible');
        expect(screen.getByText('BTC')).toBeInTheDocument();
        
        fireEvent.click(dropdownBtn);
        expect(dropdownBtn).toHaveAttribute('aria-expanded', 'false');
        expect(listbox.className).toContain('invisible');
    });

    it('handles click outside to close dropdown', () => {
        render(
            <MemoryRouter future={routerFuture}>
                <div data-testid="outside">Outside</div>
                <MarketHeader 
                    market={mockMarket} 
                    markets={mockMarkets as any} 
                    currentPrice={2500} 
                    fundingRate={0.0001} 
                    isLive={true} 
                />
            </MemoryRouter>
        );
        
        const dropdownBtn = screen.getByRole('button', { expanded: false });
        fireEvent.click(dropdownBtn);
        const listbox = screen.getByRole('listbox');
        expect(dropdownBtn).toHaveAttribute('aria-expanded', 'true');
        expect(listbox.className).toContain('visible');
        
        const outside = screen.getByTestId('outside');
        fireEvent.mouseDown(outside);
        
        expect(dropdownBtn).toHaveAttribute('aria-expanded', 'false');
        expect(listbox.className).toContain('invisible');
    });
});
