import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CollateralAssetsPanel } from '../CollateralAssetsPanel';
import { useCollateralAssets } from '../../hooks/useCollateral';

vi.mock('../../hooks/useCollateral', () => ({
    useCollateralAssets: vi.fn(),
    formatHaircut: (bps: number) => `${bps / 100}%`,
}));

const usdc = { address: '0x0', symbol: 'USDT0', isUSDC: true, enabled: true, baseHaircutBps: 0, balanceFormatted: 0, effectiveUsdcFormatted: 0, exposureUsdc: 0n, maxProtocolExposure: 0n, exposureUtilization: null };
const altEnabled = { address: '0xA', symbol: 'WBTC', isUSDC: false, enabled: true, baseHaircutBps: 200, balanceFormatted: 1.5, effectiveUsdcFormatted: 90000, exposureUsdc: 5_000_000n, maxProtocolExposure: 10_000_000n, exposureUtilization: 0.9 };
const altPaused = { address: '0xB', symbol: 'WETH', isUSDC: false, enabled: false, baseHaircutBps: 300, balanceFormatted: 0, effectiveUsdcFormatted: 0, exposureUsdc: 0n, maxProtocolExposure: 0n, exposureUtilization: 0.5 };

describe('CollateralAssetsPanel', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders nothing when the registry is not configured', () => {
        (useCollateralAssets as any).mockReturnValue({ usdc, altAssets: [], registryConfigured: false, ordersEnabled: false, loading: false });
        const { container } = render(<CollateralAssetsPanel />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders skeletons while loading', () => {
        (useCollateralAssets as any).mockReturnValue({ usdc, altAssets: [], registryConfigured: true, ordersEnabled: false, loading: true });
        render(<CollateralAssetsPanel />);
        expect(screen.getByText('Accepted Collateral')).toBeInTheDocument();
    });

    it('renders the empty-alt notice when only USDT0 is registered', () => {
        (useCollateralAssets as any).mockReturnValue({ usdc, altAssets: [], registryConfigured: true, ordersEnabled: true, loading: false });
        render(<CollateralAssetsPanel />);
        expect(screen.getByText('Live')).toBeInTheDocument();
        expect(screen.getByText(/No alternative collateral/)).toBeInTheDocument();
    });

    it('renders alt assets with exposure bars and the USDT0-only notice', () => {
        (useCollateralAssets as any).mockReturnValue({ usdc, altAssets: [altEnabled, altPaused], registryConfigured: true, ordersEnabled: false, loading: false });
        render(<CollateralAssetsPanel />);
        expect(screen.getByText('USDT0 only')).toBeInTheDocument();
        expect(screen.getByText('WBTC')).toBeInTheDocument();
        expect(screen.getByText('Paused')).toBeInTheDocument();
        expect(screen.getByText('Protocol exposure')).toBeInTheDocument();
        expect(screen.getAllByText('View only').length).toBeGreaterThan(0);
        expect(screen.getByText(/settles orders in USDT0/)).toBeInTheDocument();
    });

    it('marks alts tradable when orders are enabled', () => {
        (useCollateralAssets as any).mockReturnValue({ usdc, altAssets: [altEnabled], registryConfigured: true, ordersEnabled: true, loading: false });
        render(<CollateralAssetsPanel showBalances={false} />);
        expect(screen.getAllByText('Tradable').length).toBeGreaterThan(0);
    });
});
