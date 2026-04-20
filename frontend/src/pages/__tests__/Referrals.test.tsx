import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReferralsPage } from '../Referrals';
import { MemoryRouter } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useReferralStats } from '../../hooks/useBackend';

// Mock dependencies
vi.mock('../../hooks/useBackend', () => ({
    useReferralStats: vi.fn(),
}));

const renderWithRouter = (ui: React.ReactElement) => {
    return render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            {ui}
        </MemoryRouter>
    );
};

describe('ReferralsPage', () => {
    const mockStats = {
        referees: 10,
        totalEarned: 150.5,
        pendingClaim: 25.75,
        code: 'REALYX123',
    };
    const mockLink = 'https://realyx.com/ref/REALYX123';

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useAccount).mockReturnValue({ isConnected: true } as any);
        vi.mocked(useReferralStats).mockReturnValue({ stats: mockStats, link: mockLink, loading: false, error: null } as any);
        
        // Mock clipboard
        Object.assign(navigator, {
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
    });

    it('renders header and general info', () => {
        renderWithRouter(<ReferralsPage />);
        expect(screen.getByText(/Refer & Earn Program/i)).toBeInTheDocument();
        expect(screen.getByText(/Invite Friends,/i)).toBeInTheDocument();
    });

    it('renders connect wallet state when not connected', () => {
        vi.mocked(useAccount).mockReturnValue({ isConnected: false } as any);
        renderWithRouter(<ReferralsPage />);
        expect(screen.getByText(/Connect to get your link/i)).toBeInTheDocument();
        expect(screen.getByTestId('connect-button')).toBeInTheDocument();
    });

    it('renders stats correctly when connected', () => {
        renderWithRouter(<ReferralsPage />);
        expect(screen.getByText('10')).toBeInTheDocument(); // total referees
        expect(screen.getByText('$150.5')).toBeInTheDocument(); // total earned
        expect(screen.getByText('$25.75')).toBeInTheDocument(); // pending claim
    });

    it('renders the referral link and handles copying', async () => {
        renderWithRouter(<ReferralsPage />);
        expect(screen.getByText(mockLink)).toBeInTheDocument();
        
        const copyBtn = screen.getByRole('button', { name: /Copy/i });
        fireEvent.click(copyBtn);
        
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockLink);
        // Should briefly show "Copied"
        await waitFor(() => expect(screen.getByText(/Copied/i)).toBeInTheDocument());
    });

    it('displays loading state correctly', () => {
        vi.mocked(useReferralStats).mockReturnValue({ stats: {}, link: null, loading: true, error: null } as any);
        renderWithRouter(<ReferralsPage />);
        // Checking if stat values are not present
        expect(screen.queryByText('10')).not.toBeInTheDocument();
    });

    it('displays error message', () => {
        vi.mocked(useReferralStats).mockReturnValue({ stats: {}, link: null, loading: false, error: 'Failed to load stats' } as any);
        renderWithRouter(<ReferralsPage />);
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to load stats');
    });
});
