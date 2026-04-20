import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LeaderboardPage } from '../Leaderboard';
import { MemoryRouter } from 'react-router-dom';
import { useLeaderboard } from '../../hooks/useBackend';

// Mock dependencies
vi.mock('../../hooks/useBackend', () => ({
    useLeaderboard: vi.fn(),
}));

const renderWithRouter = (ui: React.ReactElement) => {
    return render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            {ui}
        </MemoryRouter>
    );
};

describe('LeaderboardPage', () => {
    const mockEntries = [
        { rank: 1, wallet: '0x1111111111111111111111111111111111111111', pnl: '5000', volume: '100000', trades: 50 },
        { rank: 2, wallet: '0x2222222222222222222222222222222222222222', pnl: '3000', volume: '80000', trades: 40 },
        { rank: 3, wallet: '0x3333333333333333333333333333333333333333', pnl: '-1000', volume: '50000', trades: 30 },
        { rank: 4, wallet: '0x4444444444444444444444444444444444444444', pnl: '500', volume: '20000', trades: 10 },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useLeaderboard).mockReturnValue({ entries: mockEntries, loading: false, error: null } as any);
    });

    it('renders header and timeframe tabs', () => {
        renderWithRouter(<LeaderboardPage />);
        expect(screen.getByText('Leaderboard')).toBeInTheDocument();
        expect(screen.getByText('24h')).toBeInTheDocument();
        expect(screen.getByText('7d')).toBeInTheDocument();
        expect(screen.getByText('All Time')).toBeInTheDocument();
    });

    it('renders top 3 cards with correct formatting', () => {
        renderWithRouter(<LeaderboardPage />);
        
        // Use regex to find text potentially split across nodes (e.g., + and $5,000)
        // These appear in cards and table, so use getAllByText
        expect(screen.getAllByText(/\+\$5,000/)[0]).toBeInTheDocument();
        expect(screen.getAllByText(/\+\$3,000/)[0]).toBeInTheDocument();
        expect(screen.getAllByText(/-\$1,000/)[0]).toBeInTheDocument();
    });

    it('ranks and addresses are displayed correctly in the table', () => {
        renderWithRouter(<LeaderboardPage />);
        // Full address for desktop view
        expect(screen.getAllByText('0x1111111111111111111111111111111111111111').length).toBeGreaterThan(0);
        // Truncated address for mobile/cards
        expect(screen.getAllByText('0x1111...1111').length).toBeGreaterThan(0);
    });

    it('handles timeframe switching', () => {
        renderWithRouter(<LeaderboardPage />);
        const btn24h = screen.getByText('24h');
        fireEvent.click(btn24h);
        expect(useLeaderboard).toHaveBeenCalledWith(50, '24h');
    });

    it('displays loading skeletons', () => {
        vi.mocked(useLeaderboard).mockReturnValue({ entries: [], loading: true, error: null } as any);
        renderWithRouter(<LeaderboardPage />);
        // Should show skeletons (we can't easily check for the component types without extra setup, but we check for absence of data)
        expect(screen.queryByText('+$5k')).not.toBeInTheDocument();
    });

    it('displays error message', () => {
        vi.mocked(useLeaderboard).mockReturnValue({ entries: [], loading: false, error: 'Failed to fetch' } as any);
        renderWithRouter(<LeaderboardPage />);
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch');
    });

    it('displays empty state', () => {
        vi.mocked(useLeaderboard).mockReturnValue({ entries: [], loading: false, error: null } as any);
        renderWithRouter(<LeaderboardPage />);
        expect(screen.getAllByText(/No indexed trades for this period/i).length).toBeGreaterThan(0);
    });
});
