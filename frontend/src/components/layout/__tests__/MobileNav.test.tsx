import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MobileNav } from '../MobileNav';
import { MemoryRouter } from 'react-router-dom';

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };

describe('MobileNav', () => {
    it('renders navigation items', () => {
        render(
            <MemoryRouter future={routerFuture}>
                <MobileNav />
            </MemoryRouter>
        );
        
        expect(screen.getByText('Markets')).toBeInTheDocument();
        expect(screen.getByText('Trade')).toBeInTheDocument();
        expect(screen.getByText('Portfolio')).toBeInTheDocument();
        expect(screen.getByText('More')).toBeInTheDocument();
    });

    it('opens and closes the "More" menu', () => {
        render(
            <MemoryRouter future={routerFuture}>
                <MobileNav />
            </MemoryRouter>
        );
        
        const moreBtn = screen.getByText('More').closest('button');
        fireEvent.click(moreBtn!);
        
        expect(screen.getByText('Analytics')).toBeInTheDocument();
        expect(screen.getByText('Leaderboard')).toBeInTheDocument();
        
        // Close with X button
        const closeBtn = screen.getByLabelText('Close more menu');
        fireEvent.click(closeBtn);
        
        expect(screen.queryByText('Analytics')).not.toBeInTheDocument();
    });

    it('closes the menu when clicking the backdrop', () => {
        render(
            <MemoryRouter future={routerFuture}>
                <MobileNav />
            </MemoryRouter>
        );
        
        fireEvent.click(screen.getByText('More').closest('button')!);
        expect(screen.getByText('Analytics')).toBeInTheDocument();
        
        // Find the backdrop div by its class
        const overlay = document.querySelector('.bg-black\\/60');
        if (overlay) fireEvent.click(overlay);
        
        expect(screen.queryByText('Analytics')).not.toBeInTheDocument();
    });

    it('navigates to all sub-links in the More menu', () => {
        render(
            <MemoryRouter future={routerFuture}>
                <MobileNav />
            </MemoryRouter>
        );
        
        const subLinks = ['Analytics', 'Leaderboard', 'Referrals', 'Insurance', 'Settings'];
        
        subLinks.forEach(name => {
            // Open menu
            fireEvent.click(screen.getByText('More').closest('button')!);
            // Click link
            const link = screen.getByText(name).closest('a');
            fireEvent.click(link!);
            // Verify closed
            expect(screen.queryByText(name)).not.toBeInTheDocument();
        });
    });

    it('highlights active route', () => {
        render(
            <MemoryRouter initialEntries={['/portfolio']} future={routerFuture}>
                <MobileNav />
            </MemoryRouter>
        );
        
        const portfolioLink = screen.getByText('Portfolio').closest('a');
        expect(portfolioLink).toHaveClass('text-[var(--primary)]');
    });

    it('navigates through all primary nav items', () => {
        render(
            <MemoryRouter future={routerFuture}>
                <MobileNav />
            </MemoryRouter>
        );
        
        const items = ['Markets', 'Trade', 'Portfolio', 'Vault'];
        items.forEach(name => {
            const link = screen.getByText(name).closest('a');
            expect(link).toBeInTheDocument();
            fireEvent.click(link!);
        });
    });
});
