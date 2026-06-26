import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';

type Dir = 'up' | 'down';

interface FlashValueProps {
    /**
     * Numeric value used only to detect tick direction. Formatting stays the
     * caller's responsibility (pass the formatted string as `children`).
     */
    value: number;
    children: ReactNode;
    className?: string;
}

/**
 * Terminal-style price/PnL cell. On each value change it briefly flashes a
 * background tint — green when the value ticks up, red when it ticks down —
 * then fades back to transparent. This is the single biggest "is this a real
 * trading venue?" tell, and it makes live cells (mark price, PnL) read as
 * alive rather than static.
 *
 * Onset is instant and the fade-out is driven by a CSS keyframe; the animation
 * is restarted on every tick by remounting via a changing `key`. Respects
 * `prefers-reduced-motion` (the flash is disabled in index.css).
 */
export function FlashValue({ value, children, className }: FlashValueProps) {
    const prev = useRef(value);
    const [dir, setDir] = useState<Dir | null>(null);
    // Incremented on every change so the `key` flips and the CSS animation
    // re-triggers even when the direction is unchanged tick-to-tick.
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!Number.isFinite(value) || value === prev.current) {
            prev.current = value;
            return;
        }
        setDir(value > prev.current ? 'up' : 'down');
        setTick((t) => t + 1);
        prev.current = value;
    }, [value]);

    return (
        <span
            key={tick}
            className={clsx(
                'rounded px-1 -mx-1',
                dir === 'up' && 'flash-up',
                dir === 'down' && 'flash-down',
                className,
            )}
        >
            {children}
        </span>
    );
}

export default FlashValue;
