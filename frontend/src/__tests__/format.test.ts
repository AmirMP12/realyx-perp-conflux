import { describe, it, expect } from 'vitest';
import { formatCompact, formatPrice, formatPriceWithPrecision, formatPercent } from '../utils/format';

describe('formatCompact', () => {
    it('formats millions', () => {
        expect(formatCompact(1_200_000)).toBe('$1.20M');
        expect(formatCompact(-1_200_000)).toBe('-$1.20M');
    });

    it('formats thousands', () => {
        expect(formatCompact(450_000)).toBe('$450.00K');
        expect(formatCompact(1_000)).toBe('$1.00K');
    });

    it('formats small numbers', () => {
        expect(formatCompact(2.5)).toBe('$2.50');
        expect(formatCompact(0.99)).toBe('$0.99');
    });

    it('handles noDollar option', () => {
        expect(formatCompact(1_200_000, { noDollar: true })).toBe('1.20M');
    });

    it('handles prefix option', () => {
        expect(formatCompact(1_200_000, { prefix: 'Total: ' })).toBe('Total: $1.20M');
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
