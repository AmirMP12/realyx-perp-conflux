import { describe, it, expect } from 'vitest';
import { formatCompact, formatPrice, formatPriceWithPrecision, formatPercent } from '../utils/format';

describe('formatCompact', () => {
    it('formats millions with dynamic shorthand precision', () => {
        expect(formatCompact(1_200_000)).toBe('$1.2m');
        expect(formatCompact(-1_200_000)).toBe('-$1.2m');
    });

    it('formats billions and trillions with dynamic shorthand precision', () => {
        expect(formatCompact(1_200_000_000)).toBe('$1.2b');
        expect(formatCompact(1_200_000_000_000)).toBe('$1.2t');
    });

    it('formats 1,000 to 999,000 as full numbers', () => {
        expect(formatCompact(1_000)).toBe('$1,000');
        expect(formatCompact(12_500)).toBe('$12,500');
        expect(formatCompact(450_000)).toBe('$450,000');
        expect(formatCompact(999_000)).toBe('$999,000');
    });

    it('formats 1-999 without shorthand', () => {
        expect(formatCompact(2.5)).toBe('$2.5');
        expect(formatCompact(999)).toBe('$999');
        expect(formatCompact(0.99)).toBe('$0.99');
    });

    it('handles noDollar option', () => {
        expect(formatCompact(1_200_000, { noDollar: true })).toBe('1.2m');
    });

    it('handles prefix option', () => {
        expect(formatCompact(1_200_000, { prefix: 'Total: ' })).toBe('Total: $1.2m');
    });
});

describe('formatPrice', () => {
    it('formats with default decimals', () => {
        expect(formatPrice(1234.567)).toBe('1,234.57');
    });

    it('formats with custom decimals', () => {
        expect(formatPrice(1234.567, 4)).toBe('1,234.5670');
    });
});

describe('formatPriceWithPrecision', () => {
    it('uses 4 decimals for values < 1', () => {
        expect(formatPriceWithPrecision(0.26224)).toBe('0.2622');
    });

    it('uses 2 decimals for values >= 1', () => {
        expect(formatPriceWithPrecision(1.5)).toBe('1.50');
        expect(formatPriceWithPrecision(1234.56)).toBe('1,234.56');
    });
});

describe('formatPercent', () => {
    it('adds plus sign for positive values', () => {
        expect(formatPercent(5.2)).toBe('+5.20%');
    });

    it('adds minus sign for negative values', () => {
        expect(formatPercent(-2.5)).toBe('-2.50%');
    });

    it('handles zero', () => {
        expect(formatPercent(0)).toBe('+0.00%');
    });
});
