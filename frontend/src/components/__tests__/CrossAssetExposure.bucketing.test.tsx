import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrossAssetExposure } from '../CrossAssetExposure';

vi.mock('../MarketSessionBadge', () => ({ MarketSessionBadge: () => <span data-testid="session-badge" /> }));

const markets = [
    { marketAddress: '0xCrypto', category: 'CRYPTO' },
    { marketAddress: '0xStock', category: 'STOCK' },
    { marketAddress: '0xWeird', category: 'WEIRD' }, // not in CATEGORY_ORDER -> falls back to CRYPTO
    { category: undefined } as any, // no marketAddress -> skipped in byAddr
];

describe('CrossAssetExposure', () => {
    it('returns null when there are no positive-notional positions', () => {
        const { container } = render(<CrossAssetExposure positions={[]} markets={markets as any} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('skips positions with invalid or non-positive notional', () => {
        const positions = [
            { marketAddress: '0xCrypto', size: 'NaN', isLong: true },
            { marketAddress: '0xCrypto', size: '0', isLong: true },
            { marketAddress: '0xCrypto', size: '-5', isLong: false },
        ];
        const { container } = render(<CrossAssetExposure positions={positions as any} markets={markets as any} />);
        // all skipped -> no buckets -> null
        expect(container).toBeEmptyDOMElement();
    });

    it('buckets long/short across crypto, equity, and fallback categories', () => {
        const positions = [
            { marketAddress: '0xCrypto', size: '1000', isLong: true },
            { marketAddress: '0xStock', size: '500', isLong: false }, // equity -> session badge
            { marketAddress: '0xWeird', size: '200', isLong: true }, // unknown cat -> CRYPTO
            { marketAddress: '0xUnknownAddr', size: '300', isLong: false }, // not in map -> CRYPTO default
        ];
        render(<CrossAssetExposure positions={positions as any} markets={markets as any} />);
        expect(screen.getByText('Cross-Asset Exposure')).toBeInTheDocument();
        // equity category renders a session badge
        expect(screen.getAllByTestId('session-badge').length).toBeGreaterThan(0);
    });

    it('shows the singular "position" label for a single position', () => {
        const positions = [{ marketAddress: '0xStock', size: '100', isLong: true }];
        render(<CrossAssetExposure positions={positions as any} markets={markets as any} />);
        expect(screen.getByText('1 position')).toBeInTheDocument();
    });

    it('shows the plural "positions" label for multiple positions in a class', () => {
        const positions = [
            { marketAddress: '0xCrypto', size: '100', isLong: true },
            { marketAddress: '0xCrypto', size: '200', isLong: false },
        ];
        render(<CrossAssetExposure positions={positions as any} markets={markets as any} />);
        expect(screen.getByText('2 positions')).toBeInTheDocument();
    });
});
