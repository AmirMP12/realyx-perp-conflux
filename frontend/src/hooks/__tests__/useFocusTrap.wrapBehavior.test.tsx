import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useFocusTrap } from '../useFocusTrap';

const Trap = ({ active, empty = false }: { active: boolean; empty?: boolean }) => {
    const ref = useFocusTrap(active);
    return (
        <div ref={ref} data-testid="container">
            {!empty && (
                <>
                    <button data-testid="first">First</button>
                    <input data-testid="middle" />
                    <button data-testid="last">Last</button>
                </>
            )}
        </div>
    );
};

describe('useFocusTrap wrap behavior', () => {
    it('focuses the first focusable element on activate', () => {
        const { getByTestId } = render(<Trap active />);
        expect(document.activeElement).toBe(getByTestId('first'));
    });

    it('wraps from last to first on Tab', () => {
        const { getByTestId } = render(<Trap active />);
        const container = getByTestId('container');
        const last = getByTestId('last');
        last.focus();
        fireEvent.keyDown(container, { key: 'Tab' });
        expect(document.activeElement).toBe(getByTestId('first'));
    });

    it('wraps from first to last on Shift+Tab', () => {
        const { getByTestId } = render(<Trap active />);
        const container = getByTestId('container');
        getByTestId('first').focus();
        fireEvent.keyDown(container, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(getByTestId('last'));
    });

    it('does not wrap when not at a boundary', () => {
        const { getByTestId } = render(<Trap active />);
        const container = getByTestId('container');
        const middle = getByTestId('middle');
        middle.focus();
        fireEvent.keyDown(container, { key: 'Tab' });
        // still on middle (browser handles normal tab; trap only intercepts boundaries)
        expect(document.activeElement).toBe(middle);
        fireEvent.keyDown(container, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(middle);
    });

    it('ignores non-Tab keys', () => {
        const { getByTestId } = render(<Trap active />);
        const container = getByTestId('container');
        getByTestId('last').focus();
        fireEvent.keyDown(container, { key: 'Enter' });
        expect(document.activeElement).toBe(getByTestId('last'));
    });

    it('does nothing when there are no focusable elements', () => {
        const prev = document.body;
        const { getByTestId } = render(<Trap active empty />);
        // no throw, container has no focusable children
        expect(getByTestId('container')).toBeInTheDocument();
        void prev;
    });

    it('restores focus to the previously focused element on cleanup', () => {
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        outside.focus();
        const { unmount } = render(<Trap active />);
        unmount();
        expect(document.activeElement).toBe(outside);
        outside.remove();
    });
});
