/**
 * Format number for compact display with dynamic precision:
 * 1-999,000 -> exact number, then m/b/t/q with trimmed decimals (e.g. 1.2m).
 * Sub-cent values keep meaningful precision instead of collapsing to "$0".
 */
export function formatCompact(num: number | string, options?: { prefix?: string; noDollar?: boolean }): string {
    const prefix = options?.prefix ?? '';
    const noDollar = options?.noDollar ?? false;
    const d = noDollar ? '' : '$';
    const val = Number(num);
    if (!Number.isFinite(val)) return `${prefix}${d}0`;
    const abs = Math.abs(val);
    const sign = val < 0 ? '-' : '';
    const compactValue = (value: number, unit: string) => {
        const formatted = value.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: value < 10 ? 2 : value < 100 ? 1 : 0,
        });
        return `${formatted}${unit}`;
    };

    if (abs >= 1_000_000_000_000_000) return `${sign}${prefix}${d}${compactValue(abs / 1_000_000_000_000_000, 'q')}`;
    if (abs >= 1_000_000_000_000) return `${sign}${prefix}${d}${compactValue(abs / 1_000_000_000_000, 't')}`;
    if (abs >= 1_000_000_000) return `${sign}${prefix}${d}${compactValue(abs / 1_000_000_000, 'b')}`;
    if (abs >= 1_000_000) return `${sign}${prefix}${d}${compactValue(abs / 1_000_000, 'm')}`;
    // Sub-cent values: keep significant digits rather than rounding to "$0".
    if (abs > 0 && abs < 0.01) {
        if (abs < 0.000001) return `${sign}${prefix}${d}${abs.toExponential(2)}`;
        const small = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
        return `${sign}${prefix}${d}${small}`;
    }
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
    let decimals = 2;
    if (absValue > 0 && absValue < 0.01) {
        decimals = 6;
    } else if (absValue > 0 && absValue < 1) {
        decimals = 4;
    }
    return value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Format percent with sign
 */
export function formatPercent(value: number, decimals = 2): string {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(decimals)}%`;
}

/**
 * Parse a USD-ish value (number or comma-formatted string) into a finite number.
 * Returns 0 for null/undefined/NaN so downstream math and display never break.
 */
export function safeUsd(n: string | number | null | undefined): number {
    if (n == null) return 0;
    const x = typeof n === 'number' ? n : parseFloat(String(n).replace(/,/g, ''));
    return Number.isFinite(x) ? x : 0;
}

/**
 * Truncate an EVM address for display, e.g. 0x1234…abcd.
 */
export function truncateAddress(address: string | null | undefined): string {
    if (!address) return '—';
    if (address.length <= 13) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
