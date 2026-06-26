import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResizeHandle } from '../ResizeHandle';

/** Dispatches a window-level pointer event carrying a clientY coordinate. */
function windowPointer(type: 'pointermove' | 'pointerup', clientY = 0) {
    const evt = new Event(type, { bubbles: true });
    (evt as any).clientY = clientY;
    window.dispatchEvent(evt);
}

describe('ResizeHandle', () => {
    afterEach(() => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    it('renders an accessible separator with value bounds', () => {
        render(<ResizeHandle value={300} onChange={vi.fn()} min={240} max={760} aria-label="Resize positions panel" />);
        const handle = screen.getByRole('separator');
        expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
        expect(handle).toHaveAttribute('aria-label', 'Resize positions panel');
        expect(handle).toHaveAttribute('aria-valuenow', '300');
        expect(handle).toHaveAttribute('aria-valuemin', '240');
        expect(handle).toHaveAttribute('aria-valuemax', '760');
        expect(handle).toHaveAttribute('tabindex', '0');
    });

    describe('keyboard control (direction="up")', () => {
        it('ArrowUp grows the panel', () => {
            const onChange = vi.fn();
            render(<ResizeHandle value={300} onChange={onChange} direction="up" />);
            fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowUp' });
            expect(onChange).toHaveBeenCalledWith(316); // +16 default step
        });

        it('ArrowDown shrinks the panel', () => {
            const onChange = vi.fn();
            render(<ResizeHandle value={300} onChange={onChange} direction="up" />);
            fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowDown' });
            expect(onChange).toHaveBeenCalledWith(284);
        });

        it('Shift increases the step size', () => {
            const onChange = vi.fn();
            render(<ResizeHandle value={300} onChange={onChange} direction="up" />);
            fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowUp', shiftKey: true });
            expect(onChange).toHaveBeenCalledWith(348); // +48
        });

        it('Home jumps to max, End jumps to min', () => {
            const onChange = vi.fn();
            render(<ResizeHandle value={300} onChange={onChange} min={240} max={760} />);
            const handle = screen.getByRole('separator');
            fireEvent.keyDown(handle, { key: 'Home' });
            expect(onChange).toHaveBeenLastCalledWith(760);
            fireEvent.keyDown(handle, { key: 'End' });
            expect(onChange).toHaveBeenLastCalledWith(240);
        });

        it('clamps to the max bound', () => {
            const onChange = vi.fn();
            render(<ResizeHandle value={750} onChange={onChange} min={240} max={760} />);
            fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowUp', shiftKey: true });
            expect(onChange).toHaveBeenCalledWith(760); // 750 + 48 clamped to 760
        });

        it('clamps to the min bound', () => {
            const onChange = vi.fn();
            render(<ResizeHandle value={250} onChange={onChange} min={240} max={760} />);
            fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowDown', shiftKey: true });
            expect(onChange).toHaveBeenCalledWith(240); // 250 - 48 clamped to 240
        });
    });

    describe('keyboard control (direction="down")', () => {
        it('inverts arrow behaviour', () => {
            const onChange = vi.fn();
            render(<ResizeHandle value={300} onChange={onChange} direction="down" />);
            const handle = screen.getByRole('separator');
            fireEvent.keyDown(handle, { key: 'ArrowUp' });
            expect(onChange).toHaveBeenLastCalledWith(284);
            fireEvent.keyDown(handle, { key: 'ArrowDown' });
            expect(onChange).toHaveBeenLastCalledWith(316);
        });
    });

    describe('pointer drag', () => {
        it('grows the panel when dragging up (direction="up")', () => {
            const onChange = vi.fn();
            render(<ResizeHandle value={300} onChange={onChange} min={240} max={760} direction="up" />);
            const handle = screen.getByRole('separator');

            fireEvent.pointerDown(handle, { clientY: 200 });
            windowPointer('pointermove', 100); // moved up 100px -> +100
            expect(onChange).toHaveBeenLastCalledWith(400);
            expect(document.body.style.cursor).toBe('row-resize');

            windowPointer('pointerup');
            expect(document.body.style.cursor).toBe('');
        });

        it('shrinks the panel when dragging down (direction="up")', () => {
            const onChange = vi.fn();
            render(<ResizeHandle value={500} onChange={onChange} min={240} max={760} direction="up" />);
            fireEvent.pointerDown(screen.getByRole('separator'), { clientY: 100 });
            windowPointer('pointermove', 250); // moved down 150px -> -150
            expect(onChange).toHaveBeenLastCalledWith(350);
            windowPointer('pointerup');
        });

        it('clamps the dragged value to the bounds', () => {
            const onChange = vi.fn();
            render(<ResizeHandle value={700} onChange={onChange} min={240} max={760} direction="up" />);
            fireEvent.pointerDown(screen.getByRole('separator'), { clientY: 300 });
            windowPointer('pointermove', 0); // up 300 -> 1000, clamped to 760
            expect(onChange).toHaveBeenLastCalledWith(760);
            windowPointer('pointerup');
        });

        it('does not fire onChange after the drag ends', () => {
            const onChange = vi.fn();
            render(<ResizeHandle value={300} onChange={onChange} direction="up" />);
            fireEvent.pointerDown(screen.getByRole('separator'), { clientY: 200 });
            windowPointer('pointermove', 150);
            onChange.mockClear();
            windowPointer('pointerup');
            windowPointer('pointermove', 50);
            expect(onChange).not.toHaveBeenCalled();
        });

        it('grows the panel when dragging down (direction="down")', () => {
            const onChange = vi.fn();
            render(<ResizeHandle value={300} onChange={onChange} min={240} max={760} direction="down" />);
            fireEvent.pointerDown(screen.getByRole('separator'), { clientY: 100 });
            windowPointer('pointermove', 200); // down 100px -> +100 for direction "down"
            expect(onChange).toHaveBeenLastCalledWith(400);
            windowPointer('pointerup');
        });
    });

    it('ignores keys it does not handle', () => {
        const onChange = vi.fn();
        render(<ResizeHandle value={300} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('separator'), { key: 'Enter' });
        fireEvent.keyDown(screen.getByRole('separator'), { key: 'a' });
        expect(onChange).not.toHaveBeenCalled();
    });
});
