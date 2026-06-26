import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrossAssetExposure } from '../CrossAssetExposure';
import { ProtocolStatsBar } from '../ProtocolStatsBar';
import { useBackendStats } from '../../hooks/useBackend';
import { useVaultStats } from '../../hooks/useVault';
import { useMarketsStore } from '../../stores';
import { useAllMarketsOnChainData } from '../../hooks/useMarketData';

vi.mock('../../hooks/useBackend', () => ({ useBackendStats: vi.fn() }));
vi.mock('../../hooks/useVault', () => ({ useVaultStats: vi.fn() }));
vi.mock('../../stores', () => ({ useMarketsStore: vi.fn() }));
vi.mock('../../hooks/useMarketData', () => ({ useAllMarketsOnChainData: vi.fn() }));

describe('CrossAssetExposure', () => {
    const markets = [
        { marketAddress: '0xbtc', category: 'CRYPTO' },
        { marketAddress: '0xaapl', category: 'STOCK' },
    ];

    it('renders nothing when there is no exposure', () => {
        const { container } = render(<CrossAssetExposure positions={[]} markets={markets} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('buckets positions by asset class and ignores zero-size entries', () => {
        const positions = [
            { marketAddress: '0xbtc', size: '1000', isLong: true },
            { marketAddress: '0xbtc', size: '500', isLong: false },
            { marketAddress: '0xaapl', size: '300', isLong: true },
            { marketAddress: '0xbtc', size: '0', isLong: true }, // ignored
            { marketAddress: '0xunknown', size: '100', isLong: true }, // defaults to CRYPTO
        ];
        render(<CrossAssetExposure positions={positions as any} markets={markets} />);
        expect(screen.getByText('Cross-Asset Exposure')).toBeInTheDocument();
        expect(screen.getByText(/total notional/)).toBeInTheDocument();
    });
});

describe('ProtocolStatsBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useMarketsStore as any).mockImplementation((sel: any) => sel({ markets: [{ marketAddress: '0xbtc', volume24h: '1000', longOI: '100', shortOI: '50' }] }));
    });

    it('uses backend stats when present', () => {
        (useBackendStats as any).mockReturnValue({ stats: { volume24h: '5000', tvl: '20000', totalOpenInterest: '3000' } });
        (useVaultStats as any).mockReturnValue({ stats: { tvl: 50000 } });
        (useAllMarketsOnChainData as any).mockReturnValue({ data: {} });
        render(<ProtocolStatsBar />);
        expect(screen.getByText('24h Vol')).toBeInTheDocument();
        expect(screen.getByText('TVL')).toBeInTheDocument();
    });

    it('prefers on-chain OI totals when available', () => {
        (useBackendStats as any).mockReturnValue({ stats: null });
        (useVaultStats as any).mockReturnValue({ stats: { tvl: 0 } });
        (useAllMarketsOnChainData as any).mockReturnValue({ data: { '0xbtc': { longOI: 1000, shortOI: 500 } } });
        render(<ProtocolStatsBar />);
        expect(screen.getByText('OI')).toBeInTheDocument();
    });
});
