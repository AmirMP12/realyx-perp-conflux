import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { showToast } from '../Toast';
import toast from 'react-hot-toast';

// Mock react-hot-toast custom call
vi.mock('react-hot-toast', async () => {
    const actual = await vi.importActual('react-hot-toast');
    return {
        ...actual as any,
        default: {
            ... (actual as any).default,
            custom: vi.fn((cb) => {
                // Simulate rendering the custom component
                const t = { id: '1', visible: true };
                return cb(t);
            }),
            dismiss: vi.fn(),
        },
    };
});

describe('Toast', () => {
    it('calls toast.custom when showToast is invoked', () => {
        showToast('success', 'Test Title', 'Test Message');
        expect(toast.custom).toHaveBeenCalled();
    });

    it('renders the GlassToast content', () => {
        let capturedComponent: any = null;
        (toast.custom as any).mockImplementationOnce((cb: any) => {
            capturedComponent = cb({ id: '1', visible: true });
        });

        showToast('success', 'Test Title', 'Test Message');
        render(capturedComponent);
        
        expect(screen.getByText('Test Title')).toBeInTheDocument();
        expect(screen.getByText('Test Message')).toBeInTheDocument();
        expect(screen.getByTestId('icon-CheckCircle')).toBeInTheDocument();
    });

    it('dismisses toast when close button is clicked', () => {
        let capturedComponent: any = null;
        (toast.custom as any).mockImplementationOnce((cb: any) => {
            capturedComponent = cb({ id: '1', visible: true });
        });

        showToast('error', 'Error Title');
        render(capturedComponent);
        
        const closeBtn = screen.getByLabelText('Dismiss notification');
        fireEvent.click(closeBtn);
        
        expect(toast.dismiss).toHaveBeenCalledWith('1');
    });
});
