import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusPage } from '../Status';
import { useSystemStatus } from '../../hooks/useSystemStatus';

vi.mock('../../hooks/useSystemStatus', () => ({
    useSystemStatus: vi.fn(),
}));

const fullStatus = {
    status: 'operational' as const,
    uptimeSeconds: 90061, // 1d 1h
    ts: '2024-01-01',
    components: [
        { key: 'oracle', label: 'Oracle', status: 'operational' as const, detail: 'Pyth', latencyMs: 42 },
        { key: 'rpc', label: 'RPC', status: 'degraded' as const },
        { key: 'indexer', label: 'Indexer', status: 'down' as const },
    ],
    vault: {
        tvl: 1_000_000,
        insuranceFund: 50_000,
        insuranceHealthPct: 80,
        availableLiquidity: 500_000,
        solvencyRatio: 1.5,
        insuranceHealthy: true,
    },
};

describe('StatusPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders loading state with skeletons', () => {
        (useSystemStatus as any).mockReturnValue({ status: null, loading: true, refetch: vi.fn(), updatedAt: 0 });
        render(<StatusPage />);
        expect(screen.getByText('System Status')).toBeInTheDocument();
        expect(screen.getByText('Checking…')).toBeInTheDocument();
    });

    it('renders full status with components and vault transparency', () => {
        (useSystemStatus as any).mockReturnValue({ status: fullStatus, loading: false, refetch: vi.fn(), updatedAt: Date.now() });
        render(<StatusPage />);
        expect(screen.getByText(/All systems operational/)).toBeInTheDocument();
        expect(screen.getByText('Oracle')).toBeInTheDocument();
        expect(screen.getByText('Pyth')).toBeInTheDocument();
        expect(screen.getByText('42ms')).toBeInTheDocument();
        expect(screen.getByText('Total Value Locked')).toBeInTheDocument();
        expect(screen.getByText('1.50x')).toBeInTheDocument();
        expect(screen.getByText('80%')).toBeInTheDocument();
    });

    it('renders fully-backed solvency when ratio is null', () => {
        (useSystemStatus as any).mockReturnValue({
            status: { ...fullStatus, vault: { ...fullStatus.vault, solvencyRatio: null } },
            loading: false,
            refetch: vi.fn(),
            updatedAt: 0,
        });
        render(<StatusPage />);
        expect(screen.getByText('Fully backed')).toBeInTheDocument();
    });

    it('calls refetch when refresh clicked', () => {
        const refetch = vi.fn();
        (useSystemStatus as any).mockReturnValue({ status: fullStatus, loading: false, refetch, updatedAt: 0 });
        render(<StatusPage />);
        fireEvent.click(screen.getByText('Refresh'));
        expect(refetch).toHaveBeenCalled();
    });

    it('formats short uptime in minutes', () => {
        (useSystemStatus as any).mockReturnValue({
            status: { ...fullStatus, uptimeSeconds: 120 },
            loading: false,
            refetch: vi.fn(),
            updatedAt: 0,
        });
        render(<StatusPage />);
        expect(screen.getByText(/Uptime 2m/)).toBeInTheDocument();
    });

    it('formats seconds uptime', () => {
        (useSystemStatus as any).mockReturnValue({
            status: { ...fullStatus, uptimeSeconds: 30 },
            loading: false,
            refetch: vi.fn(),
            updatedAt: 0,
        });
        render(<StatusPage />);
        expect(screen.getByText(/Uptime 30s/)).toBeInTheDocument();
    });

    it('formats hours uptime', () => {
        (useSystemStatus as any).mockReturnValue({
            status: { ...fullStatus, uptimeSeconds: 7320 }, // 2h 2m
            loading: false,
            refetch: vi.fn(),
            updatedAt: 0,
        });
        render(<StatusPage />);
        expect(screen.getByText(/Uptime 2h 2m/)).toBeInTheDocument();
    });
});
