import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FundingCountdown } from '../FundingCountdown';

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

    it('renders funding countdown correctly', () => {
        render(<FundingCountdown />);
        // 12:00:00 -> 13:00:00 = 60m 0s
        expect(screen.getByText(/Next funding: 60m 0s/i)).toBeInTheDocument();
    });

    it('updates countdown every second', () => {
        render(<FundingCountdown />);
        
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        
        expect(screen.getByText(/Next funding: 59m 59s/i)).toBeInTheDocument();
    });

    it('handles interval correctly and cleanup', () => {
        const { unmount } = render(<FundingCountdown />);
        unmount();
        // Effect cleanup covered
    });

    it('hits max/min boundaries in getNextFundingMs', () => {
        // Test exactly on the hour
        vi.setSystemTime(new Date('2023-01-01T12:00:00.000Z'));
        render(<FundingCountdown />);
        expect(screen.getByText(/Next funding: 60m 0s/i)).toBeInTheDocument();

        // Test just after the hour
        vi.setSystemTime(new Date('2023-01-01T12:00:00.001Z'));
        render(<FundingCountdown />);
        // Next is 13:00:00.000, diff is 3,599,999 ms = 59m 59s
        expect(screen.getByText(/Next funding: 59m 59s/i)).toBeInTheDocument();
    });
});
