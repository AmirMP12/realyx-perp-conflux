import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RiskDisclosureModal } from '../RiskDisclosureModal';

const STORAGE_KEY = 'realyx_risk_disclosure_seen';

describe('RiskDisclosureModal', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('shows on first visit when the flag is not set', () => {
        render(<RiskDisclosureModal />);
        expect(screen.getByText('Risk Disclosure')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /I Understand/i })).toBeInTheDocument();
    });

    it('does not show when the flag is already set', () => {
        localStorage.setItem(STORAGE_KEY, 'true');
        render(<RiskDisclosureModal />);
        expect(screen.queryByText('Risk Disclosure')).not.toBeInTheDocument();
    });

    it('persists acceptance and dismisses on "I Understand"', async () => {
        render(<RiskDisclosureModal />);
        fireEvent.click(screen.getByRole('button', { name: /I Understand/i }));
        // Acceptance is persisted immediately…
        expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
        // …and the dialog unmounts after the Headless UI exit transition.
        await waitFor(() => expect(screen.queryByText('Risk Disclosure')).not.toBeInTheDocument());
    });
});
