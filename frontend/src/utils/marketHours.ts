/**
 * Market-session awareness for RWA perpetuals.
 *
 * Crypto/commodity/forex perps trade 24/7, but tokenized-equity (STOCK) markets
 * track an underlying that only trades during US cash-equity hours. Holding a
 * leveraged position across a session close exposes the trader to overnight gap
 * risk that cannot be liquidated until reopen — so the
 * UI surfaces session state and a gap-risk warning everywhere it matters.
 *
 * Times are computed in US Eastern (the listing venue for the *X equities) using
 * Intl, which correctly handles EST/EDT transitions without a date library.
 */

export type MarketCategory = 'CRYPTO' | 'COMMODITY' | 'STOCK' | 'FOREX';

export type SessionState = 'open' | 'closed' | 'always-open';

export interface MarketSession {
    /** Whether the market is currently tradeable on its underlying venue. */
    state: SessionState;
    /** True for 24/7 markets (crypto and, for our purposes, commodity/forex perps). */
    isAlwaysOpen: boolean;
    /** ms until the next state change (open→close or close→open). null for 24/7. */
    msUntilChange: number | null;
    /** Human label for the next transition, e.g. "Reopens in 14h 22m". */
    nextChangeLabel: string | null;
    /** True when a regular session closes within `soonMs` (default 30m). */
    closingSoon: boolean;
}

// US cash-equity regular session: 09:30–16:00 ET, Monday–Friday.
const EQUITY_OPEN_MIN = 9 * 60 + 30; // 570
const EQUITY_CLOSE_MIN = 16 * 60; // 960

const ET_TIME_ZONE = 'America/New_York';

interface EtParts {
    weekday: number; // 0=Sun … 6=Sat
    minutesOfDay: number; // 0–1439 in ET
}

const WEEKDAY_INDEX: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};

/** Decompose a UTC instant into ET weekday + minutes-of-day. */
function getEtParts(now: Date): EtParts {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: ET_TIME_ZONE,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const parts = fmt.formatToParts(now);
    let weekday = 0;
    let hour = 0;
    let minute = 0;
    for (const p of parts) {
        if (p.type === 'weekday') weekday = WEEKDAY_INDEX[p.value] ?? 0;
        else if (p.type === 'hour') hour = parseInt(p.value, 10) % 24;
        else if (p.type === 'minute') minute = parseInt(p.value, 10);
    }
    return { weekday, minutesOfDay: hour * 60 + minute };
}

/** True when a category follows the (limited-hours) equity session. */
export function isEquityCategory(category?: string): boolean {
    return (category ?? '').toUpperCase() === 'STOCK';
}

function formatDuration(ms: number): string {
    if (ms <= 0) return 'now';
    const totalMinutes = Math.round(ms / 60_000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

/**
 * Compute ms from `now` until the next equity open, scanning forward day by day.
 * Skips weekends. (Exchange holidays are not modeled; treat as best-effort.)
 */
function msUntilNextEquityOpen(parts: EtParts): number {
    const { weekday, minutesOfDay } = parts;
    // Minutes remaining today (if before open and a weekday).
    for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
        const dow = (weekday + dayOffset) % 7;
        const isWeekday = dow >= 1 && dow <= 5;
        if (!isWeekday) continue;
        if (dayOffset === 0) {
            if (minutesOfDay < EQUITY_OPEN_MIN) {
                return (EQUITY_OPEN_MIN - minutesOfDay) * 60_000;
            }
            // already past open today → look at later days
            continue;
        }
        const minutesToMidnight = 24 * 60 - minutesOfDay;
        const fullDaysBetween = (dayOffset - 1) * 24 * 60;
        return (minutesToMidnight + fullDaysBetween + EQUITY_OPEN_MIN) * 60_000;
    }
    return 0;
}

/**
 * Resolve the live session for a market category at instant `now`
 * (defaults to current time).
 */
export function getMarketSession(
    category?: string,
    now: Date = new Date(),
    soonMs = 30 * 60_000,
): MarketSession {
    if (!isEquityCategory(category)) {
        return {
            state: 'always-open',
            isAlwaysOpen: true,
            msUntilChange: null,
            nextChangeLabel: null,
            closingSoon: false,
        };
    }

    const parts = getEtParts(now);
    const { weekday, minutesOfDay } = parts;
    const isWeekday = weekday >= 1 && weekday <= 5;
    const isOpen = isWeekday && minutesOfDay >= EQUITY_OPEN_MIN && minutesOfDay < EQUITY_CLOSE_MIN;

    if (isOpen) {
        const msUntilClose = (EQUITY_CLOSE_MIN - minutesOfDay) * 60_000;
        return {
            state: 'open',
            isAlwaysOpen: false,
            msUntilChange: msUntilClose,
            nextChangeLabel: `Closes in ${formatDuration(msUntilClose)}`,
            closingSoon: msUntilClose <= soonMs,
        };
    }

    const msUntilOpen = msUntilNextEquityOpen(parts);
    return {
        state: 'closed',
        isAlwaysOpen: false,
        msUntilChange: msUntilOpen,
        nextChangeLabel: `Reopens in ${formatDuration(msUntilOpen)}`,
        closingSoon: false,
    };
}
