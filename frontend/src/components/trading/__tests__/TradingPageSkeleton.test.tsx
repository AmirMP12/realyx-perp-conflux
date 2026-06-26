import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TradingPageSkeleton } from '../TradingPageSkeleton';

describe('TradingPageSkeleton', () => {
    it('exposes an accessible busy/loading region', () => {
        render(<TradingPageSkeleton />);
        const region = screen.getByLabelText('Loading market');
        expect(region).toBeInTheDocument();
        expect(region).toHaveAttribute('aria-busy', 'true');
    });

    it('renders multiple shimmer placeholders mirroring the layout', () => {
        const { container } = render(<TradingPageSkeleton />);
        const shimmers = container.querySelectorAll('[class*="animate-shimmer"]');
        // Header, chart, form, and positions placeholders add up to many blocks.
        expect(shimmers.length).toBeGreaterThan(10);
    });

    it('does not render a spinner-only fallback', () => {
        const { container } = render(<TradingPageSkeleton />);
        expect(container.querySelector('.animate-spin')).toBeNull();
    });
});
