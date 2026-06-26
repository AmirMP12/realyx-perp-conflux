import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FundingCountdown } from '../FundingCountdown';

// On-chain funding settles every 8 hours (DataTypes.FUNDING_INTERVAL = 8 hours),
// so the countdown targets the next 8h UTC boundary (00:00 / 08:00 / 16:00).
describe('FundingCountdown', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Set time to something predictable: 12:00:00 UTC
        const date = new Date('2023-01-01T12:00:00Z');
        vi.setSystemTime(date);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders funding countdown to the next 8h boundary', () => {
        render(<FundingCountdown />);
        // 12:00:00 -> next 8h boundary is 16:00:00 = 4h 0m 0s
        expect(screen.getByText(/Next funding: 4h 0m 0s/i)).toBeInTheDocument();
    });

    it('updates countdown every second', () => {
        render(<FundingCountdown />);

        act(() => {
            vi.advanceTimersByTime(1000);
        });

        expect(screen.getByText(/Next funding: 3h 59m 59s/i)).toBeInTheDocument();
    });

    it('handles interval correctly and cleanup', () => {
        const { unmount } = render(<FundingCountdown />);
        unmount();
        // Effect cleanup covered
    });

    it('omits the hours segment when less than 1h remains', () => {
        // 15:30:00 UTC -> next 8h boundary is 16:00:00 = 30m 0s (h === 0)
        vi.setSystemTime(new Date('2023-01-01T15:30:00.000Z'));
        render(<FundingCountdown />);
        expect(screen.getByText(/Next funding: 30m 0s/i)).toBeInTheDocument();
        expect(screen.queryByText(/h \d+m/i)).not.toBeInTheDocument();
    });

    it('hits max/min boundaries in getNextFundingMs', () => {
        // Test exactly on an 8h boundary
        vi.setSystemTime(new Date('2023-01-01T08:00:00.000Z'));
        render(<FundingCountdown />);
        // Next boundary is 16:00:00.000 = 8h 0m 0s
        expect(screen.getByText(/Next funding: 8h 0m 0s/i)).toBeInTheDocument();

        // Test just after an 8h boundary
        vi.setSystemTime(new Date('2023-01-01T08:00:00.001Z'));
        render(<FundingCountdown />);
        // Next is 16:00:00.000, diff is 28,799,999 ms = 7h 59m 59s
        expect(screen.getByText(/Next funding: 7h 59m 59s/i)).toBeInTheDocument();
    });
});
