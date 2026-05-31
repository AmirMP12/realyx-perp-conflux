import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../Modal';

describe('Modal', () => {
    it('does not render content when closed', () => {
        render(
            <Modal open={false} onClose={vi.fn()} title="Hidden">
                <p>Body</p>
            </Modal>,
        );
        expect(screen.queryByText('Body')).not.toBeInTheDocument();
    });

    it('renders title, description and children when open', () => {
        render(
            <Modal open onClose={vi.fn()} title="Confirm" description="Are you sure?">
                <p>Body content</p>
            </Modal>,
        );
        expect(screen.getByText('Confirm')).toBeInTheDocument();
        expect(screen.getByText('Are you sure?')).toBeInTheDocument();
        expect(screen.getByText('Body content')).toBeInTheDocument();
    });

    it('invokes onClose when the close button is clicked', () => {
        const onClose = vi.fn();
        render(
            <Modal open onClose={onClose} title="Confirm">
                <p>Body</p>
            </Modal>,
        );
        fireEvent.click(screen.getByRole('button', { name: /close dialog/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('hides the close button when hideClose is set', () => {
        render(
            <Modal open onClose={vi.fn()} title="NoClose" hideClose>
                <p>Body</p>
            </Modal>,
        );
        expect(screen.queryByRole('button', { name: /close dialog/i })).not.toBeInTheDocument();
    });
});
