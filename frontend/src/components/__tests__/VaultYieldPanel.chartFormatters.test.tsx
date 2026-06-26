import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VaultYieldPanel } from '../VaultYieldPanel';
import { useVaultYield } from '../../hooks/useVaultYield';

vi.mock('../../hooks/useVaultYield', () => ({ useVaultYield: vi.fn() }));

// Mock recharts so the YAxis tickFormatter and Tooltip formatter callbacks actually run
// during render (recharts doesn't lay out / invoke them in jsdom otherwise).
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    AreaChart: ({ children }: any) => <div>{children}</div>,
    Area: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: ({ tickFormatter }: any) => <div data-testid="yaxis">{tickFormatter ? tickFormatter(7) : ''}</div>,
    Tooltip: ({ formatter }: any) => (
        <div data-testid="tooltip">
            {formatter ? String(formatter(12.345, 'apr')) : ''}
            {formatter ? String(formatter(5, 'fees')) : ''}
        </div>
    ),
}));

const baseYield = {
    tvl: 1_000_000,
    windowDays: 30,
    totalApr: 12.5,
    sources: [
        { key: 'borrowFees', label: 'Borrow Fees', amountUsd: 5000, apr: 6 },
        { key: 'funding', label: 'Funding', amountUsd: 3000, apr: 4 },
    ],
    history: [
        { date: '2024-01-01', apr: 10, feesUsd: 100 },
        { date: '2024-01-02', apr: 12, feesUsd: 120 },
    ],
    estimated: true,
};

describe('VaultYieldPanel chart formatters', () => {
    beforeEach(() => vi.clearAllMocks());

    it('runs the YAxis tick and Tooltip formatters for both apr and fees', () => {
        (useVaultYield as any).mockReturnValue({ yield: baseYield, loading: false });
        render(<VaultYieldPanel />);
        expect(screen.getByTestId('yaxis').textContent).toBe('7%');
        const tip = screen.getByTestId('tooltip').textContent || '';
        expect(tip).toContain('12.35%'); // apr -> ['12.35%','APR']
        expect(tip).toContain('APR');
        expect(tip).toContain('$5.00'); // fees -> ['$5.00','Fees']
        expect(tip).toContain('Fees');
    });
});
