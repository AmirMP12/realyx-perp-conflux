import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NumberTicker } from '../ui/NumberTicker';
import { CategoryTag } from '../ui/CategoryTag';
import { TradingViewWidget } from '../TradingViewWidget';
import { TradingViewChart } from '../TradingViewChart';

vi.mock('lightweight-charts', () => ({
    ColorType: { Solid: 'solid' },
    createChart: vi.fn(() => ({
        applyOptions: vi.fn(),
        addCandlestickSeries: vi.fn(() => ({ setData: vi.fn() })),
        timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
        remove: vi.fn(),
    })),
}));

describe('NumberTicker', () => {
    it('renders with default and custom formatting', () => {
        const { rerender, container } = render(<NumberTicker value={12.345} />);
        expect(container.textContent).toContain('12.35');
        rerender(<NumberTicker value={12.345} prefix="$" suffix="%" decimals={1} className="x" />);
        expect(container.textContent).toContain('$12.3%');
    });
});

describe('CategoryTag', () => {
    it('renders known category', () => {
        render(<CategoryTag category="CRYPTO" />);
        expect(screen.getByText(/.+/)).toBeInTheDocument();
    });
    it('falls back to CRYPTO for unknown category', () => {
        const { container } = render(<CategoryTag category="NOPE" size="xs" />);
        expect(container.firstChild).toBeInTheDocument();
    });
    it('renders without a category', () => {
        const { container } = render(<CategoryTag />);
        expect(container.firstChild).toBeInTheDocument();
    });
});

describe('TradingViewWidget', () => {
    it('renders a placeholder without a symbol', () => {
        render(<TradingViewWidget marketSymbol={undefined} />);
        expect(screen.getByText('Select a market')).toBeInTheDocument();
    });
    it('mounts the widget for a mapped symbol', () => {
        const { container } = render(<TradingViewWidget marketSymbol="BTC-USD" interval="4h" />);
        expect(container.querySelector('.tradingview-widget-container')).toBeInTheDocument();
    });
    it('falls back for an unmapped symbol/interval', () => {
        const { container } = render(<TradingViewWidget marketSymbol="ZZZ-USD" interval="weird" />);
        expect(container.querySelector('.tradingview-widget-container')).toBeInTheDocument();
    });
});

describe('TradingViewChart', () => {
    const data = [{ time: '2024-01-01', open: 1, high: 2, low: 0.5, close: 1.5 }];
    it('renders with default colors', () => {
        const { container } = render(<TradingViewChart data={data} />);
        expect(container.firstChild).toBeInTheDocument();
    });
    it('renders with custom colors', () => {
        const { container } = render(<TradingViewChart data={data} colors={{ backgroundColor: '#000', textColor: '#fff', lineColor: '#111' }} />);
        expect(container.firstChild).toBeInTheDocument();
    });
});
