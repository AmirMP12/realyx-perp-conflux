import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import { MemoryRouter } from 'react-router-dom';

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

describe('Sidebar', () => {
    const mockOnClose = vi.fn();

    it('renders nothing when isMobileOpen is false', () => {
        const { container } = render(
            <MemoryRouter future={routerFuture}>
                <Sidebar isMobileOpen={false} onClose={mockOnClose} />
            </MemoryRouter>
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders menu items when isMobileOpen is true', () => {
        render(
            <MemoryRouter future={routerFuture}>
                <Sidebar isMobileOpen={true} onClose={mockOnClose} />
            </MemoryRouter>
        );

        expect(screen.getByText('Markets')).toBeInTheDocument();
        expect(screen.getByText('Trade')).toBeInTheDocument();
        expect(screen.getByText('Vault')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
        expect(screen.getByText('Faucet')).toBeInTheDocument();
    });

    it('calls onClose when clicking backdrop or close button', () => {
        render(
            <MemoryRouter future={routerFuture}>
                <Sidebar isMobileOpen={true} onClose={mockOnClose} />
            </MemoryRouter>
        );

        const buttons = screen.getAllByRole('button');
        fireEvent.click(buttons[0]);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onClose when clicking a link', () => {
        render(
            <MemoryRouter future={routerFuture}>
                <Sidebar isMobileOpen={true} onClose={mockOnClose} />
            </MemoryRouter>
        );

        const tradeLink = screen.getByText('Trade');
        fireEvent.click(tradeLink);
        expect(mockOnClose).toHaveBeenCalled();
    });
});
