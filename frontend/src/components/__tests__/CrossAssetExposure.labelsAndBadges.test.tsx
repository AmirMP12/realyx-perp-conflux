import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrossAssetExposure } from '../CrossAssetExposure';

const markets = [
    { marketAddress: '0xbtc', category: 'CRYPTO' },
    { marketAddress: '0xaapl', category: 'STOCK' },
    { marketAddress: '0xweird', category: 'WEIRD' }, // unknown -> CRYPTO bucket
];

describe('CrossAssetExposure labels and badges', () => {
    it('renders single-position (singular label) and equity session badge', () => {
        const positions = [
            { marketAddress: '0xaapl', size: '1000', isLong: true }, // single STOCK position -> 'position'
            { marketAddress: '0xweird', size: '500', isLong: false }, // unknown -> CRYPTO
        ];
        render(<CrossAssetExposure positions={positions as any} markets={markets} />);
        expect(screen.getByText('Cross-Asset Exposure')).toBeInTheDocument();
        expect(screen.getAllByText(/1 position\b/).length).toBeGreaterThan(0);
    });

    it('renders multiple positions (plural) per class', () => {
        const positions = [
            { marketAddress: '0xbtc', size: '1000', isLong: true },
            { marketAddress: '0xbtc', size: '500', isLong: false },
        ];
        render(<CrossAssetExposure positions={positions as any} markets={markets} />);
        expect(screen.getByText(/2 positions/)).toBeInTheDocument();
    });
});
