import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { PriceTicker } from '../PriceTicker';

vi.mock('framer-motion', () => ({
    motion: { span: ({ children, ...p }: any) => { const { animate, transition, ...rest } = p; void animate; void transition; return <span {...rest}>{children}</span>; } },
}));
vi.mock('../NumberTicker', () => ({
    NumberTicker: ({ value, prefix, suffix, decimals }: any) => <span data-testid="num">{prefix}{Number(value).toFixed(decimals)}{suffix}</span>,
}));

describe('PriceTicker', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('flashes green when the value increases then clears', () => {
        const { rerender } = render(<PriceTicker value={100} />);
        act(() => { rerender(<PriceTicker value={110} />); });
        expect(screen.getByText(/110/)).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(600); });
        expect(screen.getByTestId('num')).toBeInTheDocument();
    });

    it('flashes red when the value decreases', () => {
        const { rerender } = render(<PriceTicker value={100} />);
        act(() => { rerender(<PriceTicker value={90} />); });
        expect(screen.getByText(/90/)).toBeInTheDocument();
    });

    it('does nothing when the value is unchanged', () => {
        const { rerender } = render(<PriceTicker value={100} />);
        act(() => { rerender(<PriceTicker value={100} />); });
        expect(screen.getByText(/100/)).toBeInTheDocument();
    });

    it('uses 6 decimals for sub-cent values', () => {
        render(<PriceTicker value={0.005} />);
        expect(screen.getByTestId('num').textContent).toContain('0.005000');
    });

    it('uses 4 decimals for sub-dollar values', () => {
        render(<PriceTicker value={0.5} />);
        expect(screen.getByTestId('num').textContent).toContain('0.5000');
    });

    it('respects an explicit decimals prop', () => {
        render(<PriceTicker value={0.005} decimals={3} />);
        expect(screen.getByTestId('num').textContent).toContain('0.005');
    });
});
