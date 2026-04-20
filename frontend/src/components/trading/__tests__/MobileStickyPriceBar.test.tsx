import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileStickyPriceBar } from '../MobileStickyPriceBar';

describe('MobileStickyPriceBar', () => {
  const defaultProps = {
    symbol: 'BTC/USD',
    price: 50000.5,
    change24h: 2.5,
    marketId: 'btc-usd',
    image: 'btc.png',
    onBuyClick: vi.fn(),
    onSellClick: vi.fn(),
  };

  it('renders symbol and price correctly', () => {
    render(<MobileStickyPriceBar {...defaultProps} />);
    
    expect(screen.getByText('BTC/USD')).toBeInTheDocument();
    expect(screen.getByText('+2.50%')).toBeInTheDocument();
    expect(screen.getByText('+2.50%')).toHaveClass('text-[var(--long)]');
  });

  it('renders negative change correctly', () => {
    render(<MobileStickyPriceBar {...defaultProps} change24h={-1.2} />);
    
    expect(screen.getByText('-1.20%')).toBeInTheDocument();
    expect(screen.getByText('-1.20%')).toHaveClass('text-[var(--short)]');
  });

  it('calls buy and sell callbacks', () => {
    render(<MobileStickyPriceBar {...defaultProps} />);
    
    fireEvent.click(screen.getByText('Buy'));
    expect(defaultProps.onBuyClick).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Sell'));
    expect(defaultProps.onSellClick).toHaveBeenCalled();
  });

  it('renders image when provided', () => {
    render(<MobileStickyPriceBar {...defaultProps} />);
    const img = screen.getByAltText('BTC/USD');
    expect(img).toHaveAttribute('src', 'btc.png');
  });
});
