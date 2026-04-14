import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProtocolStatsBar } from '../ProtocolStatsBar';
import { useBackendStats } from '../../hooks/useBackend';
import { useVaultStats } from '../../hooks/useVault';

vi.mock('../../hooks/useBackend', () => ({
    useBackendStats: vi.fn(),
    useMarkets: vi.fn(() => ({ markets: [] })),
}));

vi.mock('../../hooks/useVault', () => ({
    useVaultStats: vi.fn(),
}));

describe('ProtocolStatsBar', () => {
    it('renders formatted stats from hooks', () => {
        (useBackendStats as any).mockReturnValue({
            stats: {
                volume24h: '1250000',
                totalOpenInterest: '5000000',
            }
        });
        (useVaultStats as any).mockReturnValue({
            stats: {
                tvl: 10000000,
            }
        });

        render(<ProtocolStatsBar />);

        expect(screen.getByText(/24h Vol:/i)).toBeInTheDocument();
        expect(screen.getByText(/\$1\.25m/i)).toBeInTheDocument();
        expect(screen.getByText(/OI:/i)).toBeInTheDocument();
        expect(screen.getByText(/\$5m/i)).toBeInTheDocument();
        expect(screen.getByText(/TVL:/i)).toBeInTheDocument();
        expect(screen.getByText(/\$10m/i)).toBeInTheDocument();
    });

    it('handles null/undefined stats gracefully', () => {
        (useBackendStats as any).mockReturnValue({ stats: null });
        (useVaultStats as any).mockReturnValue({ stats: null });

        render(<ProtocolStatsBar />);

        expect(screen.getAllByText('$0').length).toBeGreaterThanOrEqual(1);
    });
});
