import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { PythChart } from '../PythChart';
import { usePythPriceHistory } from '../../hooks/usePythPriceHistory';

const createPriceLine = vi.fn(() => ({ id: 'line' }));
const removePriceLine = vi.fn();
const series = { setData: vi.fn(), createPriceLine, removePriceLine };

vi.mock('lightweight-charts', () => ({
    ColorType: { Solid: 'solid' },
    createChart: vi.fn(() => ({
        applyOptions: vi.fn(),
        addCandlestickSeries: vi.fn(() => series),
        timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
        remove: vi.fn(),
    })),
}));
vi.mock('../../hooks/usePythPriceHistory', () => ({ usePythPriceHistory: vi.fn() }));

const data = [{ time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.5 }];

describe('PythChart', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows the select-market placeholder without a feedId', () => {
        (usePythPriceHistory as any).mockReturnValue({ data: [], loading: false, error: null });
        const { getByText } = render(<PythChart feedId={undefined} />);
        expect(getByText('Select a market')).toBeInTheDocument();
    });

    it('shows the loading state', () => {
        (usePythPriceHistory as any).mockReturnValue({ data: [], loading: true, error: null });
        const { getByText } = render(<PythChart feedId="0xfeed" marketSymbol="BTC-USD" />);
        expect(getByText(/Loading price data/)).toBeInTheDocument();
    });

    it('shows the error state', () => {
        (usePythPriceHistory as any).mockReturnValue({ data: [], loading: false, error: 'boom' });
        const { getByText } = render(<PythChart feedId="0xfeed" />);
        expect(getByText('Error loading chart')).toBeInTheDocument();
    });

    it('renders data and draws price lines (entry/liq/tp)', () => {
        (usePythPriceHistory as any).mockReturnValue({ data, loading: false, error: null });
        render(<PythChart feedId="0xfeed" data-x priceLines={[
            { price: 50000, color: '#fff', title: 'Entry' },
            { price: 45000, color: '#f00', title: 'Liq', lineStyle: 0 },
            { price: 0, color: '#0f0', title: 'skip' }, // price<=0 skipped
        ]} />);
        expect(series.setData).toHaveBeenCalled();
        expect(createPriceLine).toHaveBeenCalledTimes(2);
    });

    it('shows the refresh overlay when loading with existing data', () => {
        (usePythPriceHistory as any).mockReturnValue({ data, loading: true, error: null });
        const { container } = render(<PythChart feedId="0xfeed" />);
        expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    });
});
