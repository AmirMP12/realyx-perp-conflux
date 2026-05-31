import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CollateralAssetsPanel } from '../CollateralAssetsPanel';
import { useCollateralAssets } from '../../hooks/useCollateral';

vi.mock('../../hooks/useCollateral', async () => {
    const actual = await vi.importActual<any>('../../hooks/useCollateral');
    return { ...actual, useCollateralAssets: vi.fn() };
});

vi.mock('../ui', () => ({
    Skeleton: ({ className }: { className?: string }) => <div className={className} data-testid="skeleton" />,
}));

const usdc = {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'USDC', decimals: 6, isUSDC: true, enabled: true,
    baseHaircutBps: 0, liquidationHaircutBps: 0, maxHaircutBps: 0,
    maxProtocolExposure: 0n, totalDeposited: 0n, exposureUsdc: 0n,
    balance: 0n, balanceFormatted: 0, effectiveUsdc: 0n, effectiveUsdcFormatted: 0,
    exposureUtilization: null,
};

const weth = {
    address: '0x00000000000000000000000000000000000000A1',
    symbol: 'WETH', decimals: 18, isUSDC: false, enabled: true,
    baseHaircutBps: 200, liquidationHaircutBps: 500, maxHaircutBps: 3000,
    maxProtocolExposure: 1_000_000n, totalDeposited: 0n, exposureUsdc: 500_000n,
    balance: 2_000_000_000_000_000_000n, balanceFormatted: 2, effectiveUsdc: 1_960_000n, effectiveUsdcFormatted: 1.96,
    exposureUtilization: 0.5,
};

describe('CollateralAssetsPanel', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders nothing when no registry is configured', () => {
        (useCollateralAssets as any).mockReturnValue({
            usdc, altAssets: [], registryConfigured: false, ordersEnabled: false, loading: false,
        });
        const { container } = render(<CollateralAssetsPanel />);
        expect(container.firstChild).toBeNull();
    });

    it('renders USDC and registered alt collateral with haircuts', () => {
        (useCollateralAssets as any).mockReturnValue({
            usdc, altAssets: [weth], registryConfigured: true, ordersEnabled: false, loading: false,
        });
        render(<CollateralAssetsPanel />);
        expect(screen.getByText('Accepted Collateral')).toBeInTheDocument();
        expect(screen.getByText('USDC')).toBeInTheDocument();
        expect(screen.getByText('WETH')).toBeInTheDocument();
        // USDC-only badge appears when alt orders are disabled
        expect(screen.getByText('USDC only')).toBeInTheDocument();
    });

    it('shows an empty hint when registry has no alt tokens', () => {
        (useCollateralAssets as any).mockReturnValue({
            usdc, altAssets: [], registryConfigured: true, ordersEnabled: false, loading: false,
        });
        render(<CollateralAssetsPanel />);
        expect(screen.getByText(/No alternative collateral is registered/i)).toBeInTheDocument();
    });
});
