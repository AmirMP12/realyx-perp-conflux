import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VaultYieldPanel } from '../VaultYieldPanel';
import { useVaultYield } from '../../hooks/useVaultYield';

vi.mock('../../hooks/useVaultYield', () => ({ useVaultYield: vi.fn() }));

const baseYield = {
    tvl: 1_000_000,
    windowDays: 30,
    totalApr: 12.5,
    sources: [
        { key: 'borrowFees', label: 'Borrow Fees', amountUsd: 5000, apr: 6 },
        { key: 'funding', label: 'Funding', amountUsd: 3000, apr: 4 },
        { key: 'liquidations', label: 'Liquidations', amountUsd: 1000, apr: 2.5 },
    ],
    history: [
        { date: '2024-01-01', apr: 10, feesUsd: 100 },
        { date: '2024-01-02', apr: 12, feesUsd: 120 },
    ],
    estimated: true,
};

describe('VaultYieldPanel', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders APR headline and source breakdown', () => {
        (useVaultYield as any).mockReturnValue({ yield: baseYield, loading: false });
        render(<VaultYieldPanel />);
        expect(screen.getByText('12.5%')).toBeInTheDocument();
        expect(screen.getByText('Borrow Fees')).toBeInTheDocument();
        expect(screen.getByText('Funding')).toBeInTheDocument();
        expect(screen.getByText('Liquidations')).toBeInTheDocument();
        expect(screen.getByText('APR history')).toBeInTheDocument();
    });

    it('renders loading skeletons', () => {
        (useVaultYield as any).mockReturnValue({
            yield: { ...baseYield, sources: [], history: [] },
            loading: true,
        });
        render(<VaultYieldPanel />);
        expect(screen.getByText('Real Yield (LP APR)')).toBeInTheDocument();
    });

    it('renders empty state when no sources', () => {
        (useVaultYield as any).mockReturnValue({
            yield: { ...baseYield, sources: [], history: [] },
            loading: false,
        });
        render(<VaultYieldPanel />);
        expect(screen.getByText(/No yield data yet/)).toBeInTheDocument();
    });

    it('hides history when there is one or fewer points', () => {
        (useVaultYield as any).mockReturnValue({
            yield: { ...baseYield, history: [{ date: 'd', apr: 1, feesUsd: 1 }] },
            loading: false,
        });
        render(<VaultYieldPanel />);
        expect(screen.queryByText('APR history')).not.toBeInTheDocument();
    });
});
