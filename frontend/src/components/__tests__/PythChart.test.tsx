import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PythChart } from '../PythChart';
import { usePythPriceHistory } from '../../hooks/usePythPriceHistory';

// Mock dependencies
vi.mock('../../hooks/usePythPriceHistory', () => ({
    usePythPriceHistory: vi.fn()
}));

vi.mock('lightweight-charts', () => ({
    createChart: vi.fn(() => ({
        applyOptions: vi.fn(),
        addCandlestickSeries: vi.fn(() => ({
            setData: vi.fn()
        })),
        timeScale: vi.fn(() => ({
            fitContent: vi.fn()
        })),
        remove: vi.fn()
    })),
    ColorType: { Solid: 'solid' }
}));

describe('PythChart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders "Select a market" when no feedId is provided', () => {
        (usePythPriceHistory as any).mockReturnValue({
            data: [],
            loading: false,
            error: null
        });

        render(<PythChart feedId={undefined} />);
        expect(screen.getByText('Select a market')).toBeInTheDocument();
    });

    it('renders loader while loading and no data', () => {
        (usePythPriceHistory as any).mockReturnValue({
            data: [],
            loading: true,
            error: null
        });

        render(<PythChart feedId="0x123" />);
        expect(screen.getByText(/Loading price data/i)).toBeInTheDocument();
    });

    it('renders error message on failure', () => {
        (usePythPriceHistory as any).mockReturnValue({
            data: [],
            loading: false,
            error: 'Connection failed'
        });

        render(<PythChart feedId="0x123" />);
        expect(screen.getByText('Error loading chart')).toBeInTheDocument();
        expect(screen.getByText('Connection failed')).toBeInTheDocument();
    });

    it('renders chart container and powered by message when data is available', () => {
        (usePythPriceHistory as any).mockReturnValue({
            data: [
                { time: 1000, open: 10, high: 15, low: 5, close: 12 }
            ],
            loading: false,
            error: null
        });

        render(<PythChart feedId="0x123" />);
        expect(screen.getByText('Powered by')).toBeInTheDocument();
        expect(screen.getByText('Pyth Network')).toBeInTheDocument();
    });
});
