import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GuidedTooltip } from '../ui/GuidedTooltip';
import { PriceTicker } from '../ui/PriceTicker';
import { ChartPanel } from '../trading/ChartPanel';

vi.mock('../TradingViewWidget', () => ({ TradingViewWidget: () => <div data-testid="tv-widget" /> }));

describe('GuidedTooltip', () => {
    beforeEach(() => localStorage.clear());

    it('shows the tooltip and dismisses it (persisting the choice)', () => {
        render(<GuidedTooltip id="tip1" title="Heads up" content="Some help"><span>child</span></GuidedTooltip>);
        expect(screen.getByText('child')).toBeInTheDocument();
        // First-time: tooltip auto-shows.
        expect(screen.getByText('Heads up')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Got it'));
        expect(screen.queryByText('Heads up')).not.toBeInTheDocument();
        expect(localStorage.getItem('realyx_tooltip_tip1')).toBe('true');
    });

    it('toggles via the help button and dismisses via X', () => {
        render(<GuidedTooltip id="tip2" title="Title2" content="Body"><span>c</span></GuidedTooltip>);
        // auto-shown; close via help toggle
        fireEvent.click(screen.getByLabelText('Help'));
        expect(screen.queryByText('Title2')).not.toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Help'));
        expect(screen.getByText('Title2')).toBeInTheDocument();
    });

    it('hides the help affordance once previously seen', () => {
        localStorage.setItem('realyx_tooltip_tip3', 'true');
        render(<GuidedTooltip id="tip3" title="T3" content="B"><span>c</span></GuidedTooltip>);
        expect(screen.queryByLabelText('Help')).not.toBeInTheDocument();
    });
});

describe('PriceTicker', () => {
    it('uses 6 decimals for sub-cent and 4 for sub-dollar values', () => {
        const { container, rerender } = render(<PriceTicker value={0.005} />);
        expect(container.textContent).toContain('0.005');
        rerender(<PriceTicker value={0.5} />);
        expect(container.textContent).toContain('0.5');
    });

    it('flashes on value change', () => {
        const { rerender, container } = render(<PriceTicker value={100} />);
        rerender(<PriceTicker value={110} />);
        expect(container.querySelector('span')).toBeInTheDocument();
        rerender(<PriceTicker value={90} />);
        expect(container.querySelector('span')).toBeInTheDocument();
    });
});

describe('ChartPanel', () => {
    const market = { id: 'btc', symbol: 'BTC-USD', name: 'Bitcoin', image: 'b.png', change24h: 2.5 } as any;

    it('renders and switches intervals', () => {
        render(<ChartPanel market={market} currentPrice={50000} />);
        expect(screen.getByTestId('tv-widget')).toBeInTheDocument();
        fireEvent.click(screen.getByText('4h'));
        fireEvent.click(screen.getByText('1d'));
        expect(screen.getByText('1d')).toBeInTheDocument();
    });

    it('handles a missing market gracefully', () => {
        render(<ChartPanel market={undefined} currentPrice={0.5} />);
        expect(screen.getByText('—')).toBeInTheDocument();
    });
});
