import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlashValue } from '../FlashValue';

describe('FlashValue', () => {
    it('renders its children', () => {
        render(<FlashValue value={1}>$100.00</FlashValue>);
        expect(screen.getByText('$100.00')).toBeInTheDocument();
    });

    it('does not apply a flash class on the initial render', () => {
        render(<FlashValue value={1}>X</FlashValue>);
        const el = screen.getByText('X');
        expect(el.className).not.toContain('flash-up');
        expect(el.className).not.toContain('flash-down');
        // Base layout classes are always present.
        expect(el.className).toContain('rounded');
    });

    it('flashes up when the value increases', () => {
        const { rerender } = render(<FlashValue value={100}>X</FlashValue>);
        rerender(<FlashValue value={101}>X</FlashValue>);
        expect(screen.getByText('X').className).toContain('flash-up');
    });

    it('flashes down when the value decreases', () => {
        const { rerender } = render(<FlashValue value={100}>X</FlashValue>);
        rerender(<FlashValue value={99}>X</FlashValue>);
        expect(screen.getByText('X').className).toContain('flash-down');
    });

    it('switches direction across successive ticks', () => {
        const { rerender } = render(<FlashValue value={100}>X</FlashValue>);
        rerender(<FlashValue value={120}>X</FlashValue>);
        expect(screen.getByText('X').className).toContain('flash-up');
        rerender(<FlashValue value={110}>X</FlashValue>);
        const el = screen.getByText('X');
        expect(el.className).toContain('flash-down');
        expect(el.className).not.toContain('flash-up');
    });

    it('keeps the previous direction when the value is unchanged', () => {
        const { rerender } = render(<FlashValue value={100}>X</FlashValue>);
        rerender(<FlashValue value={105}>X</FlashValue>);
        expect(screen.getByText('X').className).toContain('flash-up');
        // Re-render with the same value: no new tick, direction is retained.
        rerender(<FlashValue value={105}>X</FlashValue>);
        expect(screen.getByText('X').className).toContain('flash-up');
    });

    it('ignores non-finite values without crashing or flashing', () => {
        const { rerender } = render(<FlashValue value={100}>X</FlashValue>);
        rerender(<FlashValue value={Number.NaN}>X</FlashValue>);
        const el = screen.getByText('X');
        expect(el.className).not.toContain('flash-up');
        expect(el.className).not.toContain('flash-down');
    });

    it('merges a caller-provided className', () => {
        render(
            <FlashValue value={1} className="text-emerald-400">
                X
            </FlashValue>,
        );
        expect(screen.getByText('X').className).toContain('text-emerald-400');
    });
});
