import { useCallback, useEffect, useRef } from 'react';
import clsx from 'clsx';

interface ResizeHandleProps {
    /** Current size in px (height for a horizontal handle). */
    value: number;
    /** Commit a new size. */
    onChange: (next: number) => void;
    min?: number;
    max?: number;
    /**
     * Drag direction. `down` means dragging downward increases the value
     * (handle sits above the panel it resizes), which is the natural feel for
     * a panel below the handle.
     */
    direction?: 'up' | 'down';
    className?: string;
    'aria-label'?: string;
}

/**
 * Thin draggable splitter for resizing a panel. Pointer-driven with keyboard
 * support (arrow keys nudge, Home/End jump to bounds) so it's accessible. The
 * caller persists the committed value (see layoutStore) so the trader's chosen
 * layout survives reloads — a hallmark of pro trading terminals.
 */
export function ResizeHandle({
    value,
    onChange,
    min = 180,
    max = 720,
    direction = 'up',
    className,
    'aria-label': ariaLabel = 'Resize panel',
}: ResizeHandleProps) {
    const dragging = useRef(false);
    const start = useRef({ pointer: 0, value: 0 });

    const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);

    const onPointerMove = useCallback(
        (e: PointerEvent) => {
            if (!dragging.current) return;
            const delta = e.clientY - start.current.pointer;
            // `up` direction: dragging up (negative delta) grows the panel.
            const signed = direction === 'up' ? -delta : delta;
            onChange(clamp(start.current.value + signed));
        },
        [clamp, direction, onChange],
    );

    const stop = useCallback(() => {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }, []);

    useEffect(() => {
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', stop);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', stop);
        };
    }, [onPointerMove, stop]);

    const onPointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        dragging.current = true;
        start.current = { pointer: e.clientY, value };
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        const step = e.shiftKey ? 48 : 16;
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            onChange(clamp(value + (direction === 'up' ? step : -step)));
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(clamp(value + (direction === 'up' ? -step : step)));
        } else if (e.key === 'Home') {
            e.preventDefault();
            onChange(max);
        } else if (e.key === 'End') {
            e.preventDefault();
            onChange(min);
        }
    };

    return (
        <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={ariaLabel}
            aria-valuenow={Math.round(value)}
            aria-valuemin={min}
            aria-valuemax={max}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
            className={clsx(
                'group relative h-2 -my-1 flex items-center justify-center cursor-row-resize touch-none',
                'focus:outline-none',
                className,
            )}
        >
            {/* Hit area is the full strip; the visible grip is a centered pill. */}
            <span
                className={clsx(
                    'h-1 w-10 rounded-full bg-line/70 transition-colors duration-150',
                    'group-hover:bg-brand/60 group-focus-visible:bg-brand group-active:bg-brand',
                )}
            />
        </div>
    );
}

export default ResizeHandle;
