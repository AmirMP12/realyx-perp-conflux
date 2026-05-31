import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
    /** `elevated` raises the shadow for hero surfaces (charts, primary panels). */
    variant?: 'default' | 'elevated';
    /** Disable the hover lift (e.g. for static/structural containers). */
    interactive?: boolean;
    padding?: 'none' | 'sm' | 'md' | 'lg';
}

const PADDING = {
    none: '',
    sm: 'p-3',
    md: 'p-4 sm:p-5',
    lg: 'p-6 sm:p-8',
} as const;

/**
 * Surface primitive wrapping the design-system panel styles. Theme-aware via
 * the semantic `--panel-*` tokens so it renders correctly in light and dark.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
    { variant = 'default', interactive = true, padding = 'md', className, children, ...rest },
    ref,
) {
    return (
        <div
            ref={ref}
            className={clsx(
                variant === 'elevated' ? 'glass-panel-elevated' : 'glass-panel',
                !interactive && 'hover:!translate-y-0 hover:!shadow-[var(--panel-shadow)]',
                PADDING[padding],
                className,
            )}
            {...rest}
        >
            {children}
        </div>
    );
});

interface CardSectionProps extends HTMLAttributes<HTMLDivElement> {
    children: ReactNode;
}

/** Optional header row with a bottom divider, consistent across cards. */
export function CardHeader({ children, className, ...rest }: CardSectionProps) {
    return (
        <div className={clsx('flex items-center justify-between gap-3 pb-4 mb-4 border-b border-[var(--border-color)]', className)} {...rest}>
            {children}
        </div>
    );
}

export function CardTitle({ children, className, ...rest }: CardSectionProps) {
    return (
        <h3 className={clsx('text-base font-semibold tracking-tight text-text-primary', className)} {...rest}>
            {children}
        </h3>
    );
}

export default Card;
