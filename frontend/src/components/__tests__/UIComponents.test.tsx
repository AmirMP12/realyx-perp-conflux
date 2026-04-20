
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarketStatusBadge } from '../MarketStatusBadge';
import { MarketLogo } from '../MarketLogo';
import { showToast } from '../ui/Toast';
import toast from 'react-hot-toast';

vi.mock('react-hot-toast', () => ({
    default: {
        custom: vi.fn(),
        dismiss: vi.fn(),
    },
}));

describe('UI Components', () => {
    describe('MarketStatusBadge', () => {
        it('renders active status', () => {
            render(<MarketStatusBadge />);
            expect(screen.getByText('Market Active')).toBeInTheDocument();
        });
    });

    describe('MarketLogo', () => {
        it('renders image when src is provided', () => {
            render(<MarketLogo src="btc.png" symbol="BTC-USD" />);
            const img = screen.getByRole('img');
            expect(img).toHaveAttribute('src', 'btc.png');
        });

        it('renders initials as fallback on error', () => {
            render(<MarketLogo src="invalid.png" symbol="ETH-USD" />);
            const img = screen.getByRole('img');
            fireEvent.error(img);
            expect(screen.getByText('ET')).toBeInTheDocument();
        });

        it('derives initials correctly from symbol', () => {
            const { rerender } = render(<MarketLogo src={undefined} symbol="BTC-USD" />);
            expect(screen.getByText('BT')).toBeInTheDocument(); // Slice(0,2)

            rerender(<MarketLogo src={undefined} symbol="A-USD" />);
            expect(screen.getByText('A')).toBeInTheDocument();
        });
    });

    describe('Toast', () => {
        it('calls react-hot-toast custom with GlassToast', () => {
            showToast('success', 'Success Title', 'Success Message');
            expect(toast.custom).toHaveBeenCalled();
        });
        
        // Covering branches in the GlassToast internal logic by rendering it or checking color variants
        // Since GlassToast is not exported, we rely on showToast branch testing.
        it('handles different types', () => {
            showToast('error', 'Error Title');
            showToast('info', 'Info Title');
            expect(toast.custom).toHaveBeenCalledTimes(3);
        });
    });
});
