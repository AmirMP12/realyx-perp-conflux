import { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

interface NumberTickerProps {
    value: number;
    className?: string;
    prefix?: string;
    suffix?: string;
    decimals?: number;
}

export function NumberTicker({ value, className = '', prefix = '', suffix = '', decimals = 2 }: NumberTickerProps) {
    const spring = useSpring(value, { mass: 0.8, stiffness: 75, damping: 15 });
    const displayValue = useTransform(spring, (current) => {
        // Manually format to minimal decimal places, or fixed
        return `${prefix}${current.toFixed(decimals)}${suffix}`;
    });

    useEffect(() => {
        spring.set(value);
    }, [value, spring]);

    return (
        <motion.span className={className}>
            {displayValue}
        </motion.span>
    );
}
