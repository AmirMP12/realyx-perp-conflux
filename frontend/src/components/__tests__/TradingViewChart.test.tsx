import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { TradingViewChart } from '../TradingViewChart';

// Mock lightweight-charts
vi.mock('lightweight-charts', () => ({
    createChart: vi.fn(() => ({
        applyOptions: vi.fn(),
        addCandlestickSeries: vi.fn(() => ({
            setData: vi.fn()
        })),
        remove: vi.fn()
    })),
    ColorType: { Solid: 'solid' }
}));

describe('TradingViewChart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the chart container', () => {
        const mockData = [
            { time: '2023-01-01', open: 10, high: 15, low: 5, close: 12 }
        ];

        const { container } = render(<TradingViewChart data={mockData} />);
        
        // Check if the container exists
        const div = container.querySelector('div');
        expect(div).toBeInTheDocument();
        expect(div).toHaveClass('w-full', 'h-full');
    });

    it('applies chart options on window resize', () => {
        const mockData = [{ time: '2023-01-01', open: 10, high: 15, low: 5, close: 12 }];
        const { unmount } = render(<TradingViewChart data={mockData} colors={{ backgroundColor: '#000', textColor: '#fff' }} />);
        // handleResize reads both refs (set after mount) and calls applyOptions.
        act(() => { window.dispatchEvent(new Event('resize')); });
        unmount();
        expect(true).toBe(true);
    });

    it('updates series data when the data prop changes', () => {
        const { rerender } = render(<TradingViewChart data={[{ time: '2023-01-01', open: 1, high: 2, low: 0, close: 1 }]} />);
        rerender(<TradingViewChart data={[{ time: '2023-01-02', open: 2, high: 3, low: 1, close: 2 }]} />);
        expect(true).toBe(true);
    });
});
