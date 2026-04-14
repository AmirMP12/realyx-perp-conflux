/**
 * Format number for compact display with dynamic precision:
 * 1-999,000 -> exact number, then m/b/t with trimmed decimals (e.g. 1.2m).
 */
export function formatCompact(num: number, options?: { prefix?: string; noDollar?: boolean }): string {
    const prefix = options?.prefix ?? '';
    const noDollar = options?.noDollar ?? false;
    const d = noDollar ? '' : '$';
    if (!Number.isFinite(num)) return `${prefix}${d}0`;
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    const compactValue = (value: number, unit: string) => {
        const formatted = value.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: value < 10 ? 2 : value < 100 ? 1 : 0,
        });
        return `${formatted}${unit}`;
    };

    if (abs >= 1_000_000_000_000) return `${sign}${prefix}${d}${compactValue(abs / 1_000_000_000_000, 't')}`;
    if (abs >= 1_000_000_000) return `${sign}${prefix}${d}${compactValue(abs / 1_000_000_000, 'b')}`;
    if (abs >= 1_000_000) return `${sign}${prefix}${d}${compactValue(abs / 1_000_000, 'm')}`;
    return `${sign}${prefix}${d}${abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * Format number with fixed decimals for display (tabular-nums friendly)
 */
export function formatPrice(value: number, decimals = 2): string {
    return value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Format price with dynamic precision based on its value.
 * Assets under $1.00 get 4 decimals (e.g., $0.2622)
 * Assets >= $1.00 get 2 decimals (e.g., $1.50)
 */
export function formatPriceWithPrecision(value: number): string {
    const absValue = Math.abs(value);
    const decimals = (absValue > 0 && absValue < 1) ? 4 : 2;
    return value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Format percent with sign
 */
export function formatPercent(value: number, decimals = 2): string {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(decimals)}%`;
}
