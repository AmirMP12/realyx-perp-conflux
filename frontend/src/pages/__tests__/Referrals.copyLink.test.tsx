import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReferralsPage } from '../Referrals';
import { useAccount } from 'wagmi';
import { useReferralStats } from '../../hooks/useBackend';
import toast from 'react-hot-toast';

vi.mock('../../hooks/useBackend', () => ({ useReferralStats: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const renderPage = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ReferralsPage /></MemoryRouter>);

describe('ReferralsPage copy lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        (useAccount as any).mockReturnValue({ isConnected: true });
        (useReferralStats as any).mockReturnValue({ stats: { referees: 1, totalEarned: 0, pendingClaim: 0, code: 'ABC', live: true }, link: 'https://x/?ref=ABC', loading: false, error: null });
    });
    afterEach(() => vi.useRealTimers());

    it('shows Copied then resets after the timeout', async () => {
        Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
        renderPage();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Copy/i })); });
        expect(screen.getByText(/Copied/i)).toBeInTheDocument();
        // The setTimeout(() => setCopied(false), 2000) callback runs and resets the label.
        await act(async () => { vi.advanceTimersByTime(2000); });
        expect(screen.queryByText(/Copied/i)).not.toBeInTheDocument();
    });

    it('toasts an error when clipboard write fails', async () => {
        Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
        renderPage();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Copy/i })); });
        expect(toast.error).toHaveBeenCalledWith('Could not copy to clipboard');
    });
});
