import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { NumberTicker } from './NumberTicker';
import clsx from 'clsx';

interface PriceTickerProps {
    value: number;
    prefix?: string;
    suffix?: string;
    decimals?: number;
    className?: string;
    flashDuration?: number;
}

/** Smooth animated price with brief flash on change (green up, red down) */
export function PriceTicker({
    value,
    prefix = '$',
    suffix = '',
    decimals = 2,
    className = '',
    flashDuration = 600,
}: PriceTickerProps) {
    const prev = useRef(value);
    const [flash, setFlash] = useState<'up' | 'down' | null>(null);

    useEffect(() => {
        if (value === prev.current) return;
        const dir = value > prev.current ? 'up' : 'down';
        prev.current = value;
        setFlash(dir);
        const t = setTimeout(() => setFlash(null), flashDuration);
        return () => clearTimeout(t);
    }, [value, flashDuration]);

    const effectiveDecimals = (decimals === 2 && Math.abs(value) > 0 && Math.abs(value) < 1) ? 4 : decimals;

    return (
        <motion.span
            className={clsx(
                'inline-block tabular-nums transition-colors duration-300',
                flash === 'up' && 'text-[var(--long)]',
                flash === 'down' && 'text-[var(--short)]',
                !flash && 'text-[inherit]',
                className
            )}
            animate={flash ? { scale: [1, 1.015, 1] } : {}}
            transition={{ duration: flashDuration / 1000, ease: 'easeOut' }}
        >
            <NumberTicker value={value} prefix={prefix} suffix={suffix} decimals={effectiveDecimals} />
        </motion.span>
    );
}
