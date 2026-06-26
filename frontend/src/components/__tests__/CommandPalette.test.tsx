import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette } from '../CommandPalette';

const navigateMock = vi.fn();

vi.mock('react-router-dom', () => ({
    useNavigate: () => navigateMock,
}));

// Identity fallback so symbols/names are deterministic (bypass the brand map).
vi.mock('../../utils/market', () => ({
    applyMarketDisplayFallback: (m: any) => m,
}));

const MARKETS = [
    { id: '1', symbol: 'BTC', name: 'Bitcoin', image: 'btc.png', change24h: 2.5, volume24h: 1000, marketAddress: '0xbtc' },
    { id: '2', symbol: 'ETH', name: 'Ethereum', image: 'eth.png', change24h: -1.2, volume24h: 500, marketAddress: '0xeth' },
];

vi.mock('../../stores', () => ({
    useMarketsStore: (selector: any) => selector({ markets: MARKETS }),
}));

function openWithShortcut() {
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
}

describe('CommandPalette', () => {
    beforeEach(() => {
        navigateMock.mockReset();
    });

    it('is closed by default', () => {
        render(<CommandPalette />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens on Ctrl/Cmd+K', () => {
        render(<CommandPalette />);
        openWithShortcut();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('opens via the custom event', () => {
        render(<CommandPalette />);
        fireEvent(window, new CustomEvent('realyx:open-command-palette'));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('toggles closed on a second shortcut press', () => {
        render(<CommandPalette />);
        openWithShortcut();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        openWithShortcut();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes on Escape', () => {
        render(<CommandPalette />);
        openWithShortcut();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes when the backdrop is clicked', () => {
        render(<CommandPalette />);
        openWithShortcut();
        const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
        fireEvent.mouseDown(backdrop);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not close when the dialog itself is clicked', () => {
        render(<CommandPalette />);
        openWithShortcut();
        const dialog = screen.getByRole('dialog');
        fireEvent.mouseDown(dialog);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('lists navigation targets and markets when not searching', () => {
        render(<CommandPalette />);
        openWithShortcut();
        expect(screen.getByText('Portfolio')).toBeInTheDocument();
        expect(screen.getByText('BTC')).toBeInTheDocument();
        expect(screen.getByText('ETH')).toBeInTheDocument();
    });

    it('filters markets by query', () => {
        render(<CommandPalette />);
        openWithShortcut();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'BTC' } });
        expect(screen.getByText('BTC')).toBeInTheDocument();
        expect(screen.queryByText('ETH')).not.toBeInTheDocument();
    });

    it('matches a market by its name', () => {
        render(<CommandPalette />);
        openWithShortcut();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ethereum' } });
        expect(screen.getByText('ETH')).toBeInTheDocument();
        expect(screen.queryByText('BTC')).not.toBeInTheDocument();
    });

    it('shows an empty state when nothing matches', () => {
        render(<CommandPalette />);
        openWithShortcut();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzzzz' } });
        expect(screen.getByText(/No results/i)).toBeInTheDocument();
    });

    it('handles keyboard navigation gracefully when there are no results', () => {
        render(<CommandPalette />);
        openWithShortcut();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzzzz' } });
        const dialog = screen.getByRole('dialog');
        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        fireEvent.keyDown(dialog, { key: 'ArrowUp' });
        fireEvent.keyDown(dialog, { key: 'Enter' });
        expect(navigateMock).not.toHaveBeenCalled();
        // Enter on an empty list is a no-op; the palette stays open.
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('navigates to the active item on Enter (first nav target by default)', () => {
        render(<CommandPalette />);
        openWithShortcut();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
        expect(navigateMock).toHaveBeenCalledWith('/');
    });

    it('moves the selection with ArrowDown before selecting', () => {
        render(<CommandPalette />);
        openWithShortcut();
        const dialog = screen.getByRole('dialog');
        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        fireEvent.keyDown(dialog, { key: 'Enter' });
        expect(navigateMock).toHaveBeenCalledWith('/trade');
    });

    it('wraps the selection with ArrowUp from the top', () => {
        render(<CommandPalette />);
        openWithShortcut();
        const dialog = screen.getByRole('dialog');
        // From index 0, ArrowUp wraps to the last item (a market) and selects it.
        fireEvent.keyDown(dialog, { key: 'ArrowUp' });
        fireEvent.keyDown(dialog, { key: 'Enter' });
        expect(navigateMock).toHaveBeenCalledWith('/trade/ETH');
    });

    it('navigates when a market row is clicked', () => {
        render(<CommandPalette />);
        openWithShortcut();
        const btcRow = screen.getByText('BTC').closest('button') as HTMLButtonElement;
        fireEvent.click(btcRow);
        expect(navigateMock).toHaveBeenCalledWith('/trade/BTC');
    });

    it('navigates when a navigation row is clicked', () => {
        render(<CommandPalette />);
        openWithShortcut();
        const portfolioRow = screen.getByText('Portfolio').closest('button') as HTMLButtonElement;
        fireEvent.click(portfolioRow);
        expect(navigateMock).toHaveBeenCalledWith('/portfolio');
    });

    it('selects a row on hover, then navigates to it on Enter', () => {
        render(<CommandPalette />);
        openWithShortcut();
        const dialog = screen.getByRole('dialog');
        const portfolioRow = screen.getByText('Portfolio').closest('button') as HTMLButtonElement;
        fireEvent.mouseMove(portfolioRow);
        fireEvent.keyDown(dialog, { key: 'Enter' });
        expect(navigateMock).toHaveBeenCalledWith('/portfolio');
    });

    it('selects a market row on hover, then navigates to it on Enter', () => {
        render(<CommandPalette />);
        openWithShortcut();
        const dialog = screen.getByRole('dialog');
        const btcRow = screen.getByText('BTC').closest('button') as HTMLButtonElement;
        fireEvent.mouseMove(btcRow);
        fireEvent.keyDown(dialog, { key: 'Enter' });
        expect(navigateMock).toHaveBeenCalledWith('/trade/BTC');
    });

    it('closes after a successful navigation', () => {
        render(<CommandPalette />);
        openWithShortcut();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
