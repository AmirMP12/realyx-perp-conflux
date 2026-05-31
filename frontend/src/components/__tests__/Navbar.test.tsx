import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Navbar } from '../Navbar';
import { MemoryRouter } from 'react-router-dom';

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

// Mock sub-components to simplify testing
vi.mock('../WalletConnect', () => ({
    WalletConnectButton: () => <button>Connect Wallet</button>
}));
vi.mock('../ProtocolStatsBar', () => ({
    ProtocolStatsBar: () => <div>Stats Bar</div>
}));
vi.mock('../NetworkIndicator', () => ({
    NetworkIndicator: () => <div>Network</div>
}));

describe('Navbar', () => {
    it('renders logo and primary links', () => {
        render(
            <MemoryRouter future={routerFuture}>
                <Navbar />
            </MemoryRouter>
        );
        
        expect(screen.getByText((_content, element) => {
            return element?.tagName.toLowerCase() === 'span' && element.textContent === 'Realyx';
        })).toBeInTheDocument();
        expect(screen.getByText('Markets')).toBeInTheDocument();
        expect(screen.getByText('Trade')).toBeInTheDocument();
        expect(screen.getByText('Portfolio')).toBeInTheDocument();
    });

    it('toggles "More" dropdown', () => {
        render(
            <MemoryRouter future={routerFuture}>
                <Navbar />
            </MemoryRouter>
        );
        
        const moreBtn = screen.getByText(/More/i);
        fireEvent.click(moreBtn);
        
        // Dropdown links should be visible
        expect(screen.getByText('Vault')).toBeInTheDocument();
        expect(screen.getByText('Insurance')).toBeInTheDocument();
        expect(screen.getByText('Leaderboard')).toBeInTheDocument();
        
        fireEvent.click(moreBtn);
        // Should be hidden
        expect(screen.queryByText('Vault')).not.toBeInTheDocument();
    });

    it('highlights active link based on route', () => {
        render(
            <MemoryRouter future={routerFuture} initialEntries={['/trade']}>
                <Navbar />
            </MemoryRouter>
        );

        const tradeLink = screen.getByText('Trade').closest('a');
        expect(tradeLink).toHaveAttribute('aria-current', 'page');

        const marketsLink = screen.getByText('Markets').closest('a');
        expect(marketsLink).not.toHaveAttribute('aria-current', 'page');
    });

    it('handles click outside to close dropdown', () => {
        render(
            <MemoryRouter future={routerFuture}>
                <div data-testid="outside">Outside</div>
                <Navbar />
            </MemoryRouter>
        );
        
        const moreBtn = screen.getByText(/More/i);
        fireEvent.click(moreBtn);
        expect(screen.getByText('Vault')).toBeInTheDocument();
        
        const outside = screen.getByTestId('outside');
        fireEvent.mouseDown(outside);
        
        expect(screen.queryByText('Vault')).not.toBeInTheDocument();
    });
});
