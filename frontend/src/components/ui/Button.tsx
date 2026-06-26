import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'long' | 'short' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Renders a spinner and disables interaction. */
    loading?: boolean;
    /** Stretches the button to fill its container. */
    fullWidth?: boolean;
    leftIcon?: ReactNode;
    rightIcon?: ReactNode;
}

const SIZE: Record<ButtonSize, string> = {
    sm: 'h-8 px-3 text-xs rounded-lg',
    md: 'h-10 px-4 text-sm rounded-xl',
    lg: 'h-12 px-6 text-base rounded-xl',
};

const GAP: Record<ButtonSize, string> = {
    sm: 'gap-1.5',
    md: 'gap-2',
    lg: 'gap-2.5',
};

const VARIANT: Record<ButtonVariant, string> = {
    primary:
        'text-white bg-[linear-gradient(135deg,#2d42fc_0%,#5062ff_100%)] shadow-[0_8px_20px_rgba(45,66,252,0.34)] hover:brightness-[1.05] hover:-translate-y-px active:translate-y-0',
    secondary:
        'bg-[var(--bg-tertiary)] text-text-primary border border-[var(--border-color)] hover:border-[var(--border-color-hover)]',
    ghost:
        'bg-transparent text-text-secondary hover:text-text-primary hover:bg-[var(--bg-tertiary)]',
    long:
        'text-white bg-[var(--long)] hover:brightness-[1.08] hover:-translate-y-px active:translate-y-0',
    short:
        'text-white bg-[var(--short)] hover:brightness-[1.08] hover:-translate-y-px active:translate-y-0',
    danger:
        'text-white bg-[var(--short)] hover:brightness-[1.08]',
};

/**
 * Canonical button primitive for the design system. Variants and sizes are
 * token-driven so they adapt to light/dark themes automatically. Use this
 * instead of hand-rolled `.btn-*` classes for new UI.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {
        variant = 'primary',
        size = 'md',
        loading = false,
        fullWidth = false,
        leftIcon,
        rightIcon,
        className,
        disabled,
        children,
        type = 'button',
        ...rest
    },
    ref,
) {
    const isDisabled = disabled || loading;
    return (
        <button
            ref={ref}
            type={type}
            disabled={isDisabled}
            aria-busy={loading || undefined}
            className={clsx(
                'relative inline-flex items-center justify-center font-semibold whitespace-nowrap',
                'transition-[transform,background,box-shadow,filter,border-color] duration-200',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]',
                'disabled:opacity-50 disabled:pointer-events-none disabled:translate-y-0',
                'motion-reduce:transform-none motion-reduce:transition-none',
                SIZE[size],
                VARIANT[variant],
                fullWidth && 'w-full',
                className,
            )}
            {...rest}
        >
            {loading && (
                <span
                    className="absolute inset-0 flex items-center justify-center"
                    aria-hidden="true"
                >
                    <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                </span>
            )}
            <span className={clsx('inline-flex items-center', GAP[size], loading && 'opacity-0')}>
                {leftIcon ? <span className="inline-flex shrink-0">{leftIcon}</span> : null}
                {children}
                {rightIcon ? <span className="inline-flex shrink-0">{rightIcon}</span> : null}
            </span>
        </button>
    );
});

export default Button;
