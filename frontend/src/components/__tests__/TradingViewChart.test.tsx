import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
});
