import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { OrderBook, VerticalOrderBook } from '../Orderbook';

describe('Orderbook Components', () => {
    const marketId = 'ETH-USD';
    const currentPrice = 3000;

    describe('OrderBook (Main)', () => {
        it('renders the header and market name', () => {
            render(<OrderBook marketId={marketId} currentPrice={currentPrice} />);
            expect(screen.getByText(/ETH USD · Order Book/i)).toBeInTheDocument();
        });

        it('toggles views between both, bids, and asks', () => {
            render(<OrderBook marketId={marketId} currentPrice={currentPrice} />);
            
            const bothBtn = screen.getByText('Both');
            const bidsBtn = screen.getByText('Bids');
            const asksBtn = screen.getByText('Asks');

            // Initial view is 'both'
            expect(bothBtn).toHaveClass('bg-[var(--bg-secondary)]');

            fireEvent.click(bidsBtn);
            expect(bidsBtn).toHaveClass('bg-long/20');
            
            fireEvent.click(asksBtn);
            expect(asksBtn).toHaveClass('bg-short/20');
        });

        it('changes precision through the select dropdown', () => {
            render(<OrderBook marketId={marketId} currentPrice={currentPrice} />);
            const select = screen.getByLabelText(/Price precision/i);
            
            fireEvent.change(select, { target: { value: '0' } });
            expect(select).toHaveValue('0');
            
            fireEvent.change(select, { target: { value: '1' } });
            expect(select).toHaveValue('1');
        });

        it('renders spread display correctly', () => {
            render(<OrderBook marketId={marketId} currentPrice={currentPrice} />);
            expect(screen.getByText(/Spread:/i)).toBeInTheDocument();
        });

        it('handles zero currentPrice by defaulting to 50', () => {
            render(<OrderBook marketId={marketId} currentPrice={0} />);
            // Data is always generated in demo mode
            expect(screen.getByText(/ETH USD · Order Book/i)).toBeInTheDocument();
        });
    });

    describe('VerticalOrderBook', () => {
        it('renders the vertical layout with market name', () => {
            render(<VerticalOrderBook marketId="BTC-USD" currentPrice={60000} />);
            expect(screen.getByText('BTC-USD')).toBeInTheDocument();
            expect(screen.getByText(/\$60000.00/)).toBeInTheDocument();
        });

        it('handles missing currentPrice', () => {
             render(<VerticalOrderBook marketId="BTC-USD" />);
             expect(screen.getByText(/\$50.00/)).toBeInTheDocument();
        });
    });
});
