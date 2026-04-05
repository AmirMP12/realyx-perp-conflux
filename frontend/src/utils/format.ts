/**
 * Format number for compact display (e.g. $1.2M, $450K, $2.50)
 */
export function formatCompact(num: number, options?: { prefix?: string; noDollar?: boolean }): string {
    const prefix = options?.prefix ?? '';
    const noDollar = options?.noDollar ?? false;
    const d = noDollar ? '' : '$';
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    if (abs >= 1_000_000) return `${sign}${prefix}${d}${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}${prefix}${d}${(abs / 1_000).toFixed(2)}K`;
    return `${sign}${prefix}${d}${num.toFixed(2)}`;
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
