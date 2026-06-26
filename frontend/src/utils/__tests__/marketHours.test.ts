import { describe, it, expect } from 'vitest';
import { getMarketSession, isEquityCategory } from '../marketHours';

/**
 * Build a UTC Date that corresponds to a known US-Eastern wall-clock time.
 * January is EST (UTC-5); July is EDT (UTC-4). We pass explicit UTC hours so
 * the test is deterministic regardless of the machine's local zone.
 */
function utc(year: number, month: number, day: number, hourUtc: number, minute = 0): Date {
    return new Date(Date.UTC(year, month - 1, day, hourUtc, minute, 0));
}

describe('marketHours.isEquityCategory', () => {
    it('identifies STOCK as equity, everything else as 24/7', () => {
        expect(isEquityCategory('STOCK')).toBe(true);
        expect(isEquityCategory('stock')).toBe(true);
        expect(isEquityCategory('CRYPTO')).toBe(false);
        expect(isEquityCategory('COMMODITY')).toBe(false);
        expect(isEquityCategory('FOREX')).toBe(false);
        expect(isEquityCategory(undefined)).toBe(false);
    });
});

describe('marketHours.getMarketSession — 24/7 categories', () => {
    it('reports always-open for crypto regardless of time', () => {
        const s = getMarketSession('CRYPTO', utc(2026, 1, 3, 5, 0)); // a weekend night
        expect(s.state).toBe('always-open');
        expect(s.isAlwaysOpen).toBe(true);
        expect(s.msUntilChange).toBeNull();
        expect(s.nextChangeLabel).toBeNull();
        expect(s.closingSoon).toBe(false);
    });
});

describe('marketHours.getMarketSession — equities (EST window)', () => {
    // 2026-01-05 is a Monday. 14:30 UTC = 09:30 ET (EST) = open.
    it('is open at 09:30 ET on a weekday', () => {
        const s = getMarketSession('STOCK', utc(2026, 1, 5, 14, 30));
        expect(s.state).toBe('open');
        expect(s.nextChangeLabel).toMatch(/Closes in/);
    });

    it('is open just before the close and flags closingSoon near 16:00 ET', () => {
        const s = getMarketSession('STOCK', utc(2026, 1, 5, 20, 45)); // 15:45 ET
        expect(s.state).toBe('open');
        expect(s.closingSoon).toBe(true);
    });

    it('is closed before the open', () => {
        const s = getMarketSession('STOCK', utc(2026, 1, 5, 13, 0)); // 08:00 ET
        expect(s.state).toBe('closed');
        expect(s.nextChangeLabel).toMatch(/Reopens in/);
        // Opens at 09:30 ET → 1h 30m away.
        expect(s.msUntilChange).toBe(90 * 60_000);
    });

    it('is closed after the close', () => {
        const s = getMarketSession('STOCK', utc(2026, 1, 5, 21, 30)); // 16:30 ET
        expect(s.state).toBe('closed');
        expect(s.nextChangeLabel).toMatch(/Reopens in/);
    });
});

describe('marketHours.getMarketSession — weekends', () => {
    it('is closed all weekend and reopens Monday', () => {
        // 2026-01-03 is a Saturday.
        const sat = getMarketSession('STOCK', utc(2026, 1, 3, 18, 0));
        expect(sat.state).toBe('closed');
        expect(sat.msUntilChange).toBeGreaterThan(24 * 60 * 60_000); // > 1 day away
        expect(sat.nextChangeLabel).toMatch(/Reopens in/);
    });
});

describe('marketHours.getMarketSession — EDT (daylight saving)', () => {
    // 2026-07-06 is a Monday in EDT (UTC-4). 13:30 UTC = 09:30 ET = open.
    it('handles the summer offset correctly', () => {
        const open = getMarketSession('STOCK', utc(2026, 7, 6, 13, 30));
        expect(open.state).toBe('open');
        const beforeOpen = getMarketSession('STOCK', utc(2026, 7, 6, 13, 0)); // 09:00 ET
        expect(beforeOpen.state).toBe('closed');
        expect(beforeOpen.msUntilChange).toBe(30 * 60_000);
    });
});
