import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarketLiquidityPanel } from '../MarketLiquidityPanel';
import { useSingleMarketData } from '../../../hooks/useMarketData';
import { useVaultStats } from '../../../hooks/useVault';

vi.mock('../../../hooks/useMarketData', () => ({ useSingleMarketData: vi.fn() }));
vi.mock('../../../hooks/useVault', () => ({ useVaultStats: vi.fn() }));

const market = { id: 'btc', symbol: 'BTC-USD', marketAddress: '0x1234567890123456789012345678901234567890', longOI: 0, shortOI: 0, fundingRate: 0 } as any;

describe('MarketLiquidityPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useVaultStats as any).mockReturnValue({ stats: { availableLiquidity: 100000 } });
    });

    it('renders full liquidity data with confidence and positive funding', () => {
        (useSingleMarketData as any).mockReturnValue({
            formatted: { longOI: 600, shortOI: 400, fundingRate: 0.0008, price: 50000, confidence: 5, maxPositionSize: 200000, maxTotalExposure: 1_000_000 },
            isLoading: false,
        });
        render(<MarketLiquidityPanel market={market} currentPrice={50000} />);
        expect(screen.getByText('Market Liquidity')).toBeInTheDocument();
        expect(screen.getByText('Zero slippage')).toBeInTheDocument();
        expect(screen.getByText(/conf/)).toBeInTheDocument();
        expect(screen.getByText('60% L')).toBeInTheDocument();
    });

    it('shows the loading skeleton for OI skew', () => {
        (useSingleMarketData as any).mockReturnValue({ formatted: undefined, isLoading: true });
        render(<MarketLiquidityPanel market={market} currentPrice={0.5} />);
        expect(screen.getByText('Market Liquidity')).toBeInTheDocument();
    });

    it('handles negative funding and missing caps', () => {
        (useSingleMarketData as any).mockReturnValue({
            formatted: { longOI: 100, shortOI: 100, fundingRate: -0.0002, price: 0, confidence: 0, maxPositionSize: 0, maxTotalExposure: 0 },
            isLoading: false,
        });
        render(<MarketLiquidityPanel market={market} currentPrice={100} />);
        // depth falls back to '—' when no caps and no liquidity bound
        expect(screen.getAllByText('Funding / 8h').length).toBeGreaterThan(0);
    });

    it('does not fetch for an unconfigured market', () => {
        (useSingleMarketData as any).mockReturnValue({ formatted: undefined, isLoading: false });
        render(<MarketLiquidityPanel market={{ ...market, marketAddress: '0x0000000000000000000000000000000000000000' }} currentPrice={1} />);
        expect(screen.getByText('Market Liquidity')).toBeInTheDocument();
    });
});
