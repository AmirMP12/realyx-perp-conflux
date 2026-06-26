import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Navbar } from '../Navbar';

vi.mock('../WalletConnect', () => ({ WalletConnectButton: () => <div data-testid="wallet" /> }));
vi.mock('../ProtocolStatsBar', () => ({ ProtocolStatsBar: () => <div /> }));
vi.mock('../NetworkIndicator', () => ({ NetworkIndicator: () => <div /> }));

const future = { v7_startTransition: true, v7_relativeSplatPath: true };

describe('Navbar navigation', () => {
    it('marks Markets active at the index route', () => {
        render(<MemoryRouter initialEntries={['/']} future={future}><Navbar /></MemoryRouter>);
        expect(screen.getByText('Markets')).toBeInTheDocument();
    });

    it('marks the More menu active on a sub-route and opens/closes it', () => {
        render(<MemoryRouter initialEntries={['/vault']} future={future}><Navbar /></MemoryRouter>);
        const moreBtn = screen.getByRole('button', { name: /More/ });
        fireEvent.click(moreBtn);
        expect(moreBtn).toHaveAttribute('aria-expanded', 'true');
        // active item highlighted (Vault)
        expect(screen.getAllByText('Vault').length).toBeGreaterThan(0);
        // Escape closes
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(moreBtn).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes the menu on outside click', () => {
        render(<MemoryRouter initialEntries={['/trade']} future={future}><div data-testid="outside">x</div><Navbar /></MemoryRouter>);
        const moreBtn = screen.getByRole('button', { name: /More/ });
        fireEvent.click(moreBtn);
        expect(moreBtn).toHaveAttribute('aria-expanded', 'true');
        fireEvent.mouseDown(screen.getByTestId('outside'));
        expect(moreBtn).toHaveAttribute('aria-expanded', 'false');
    });
});
