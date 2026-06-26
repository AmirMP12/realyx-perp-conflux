import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FundingComparePanel } from '../FundingComparePanel';
import { useReferenceFunding } from '../../../hooks/useReferenceFunding';

vi.mock('../../../hooks/useReferenceFunding', () => ({ useReferenceFunding: vi.fn() }));

describe('FundingComparePanel', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows no-reference state for assets without a CEX perp', () => {
        (useReferenceFunding as any).mockReturnValue({ referenceRate8h: null, hasReference: false, loading: false });
        render(<FundingComparePanel symbol="AAPLX-USD" fundingRate={0.0001} />);
        expect(screen.getByText('No CEX reference')).toBeInTheDocument();
        expect(screen.getByText('n/a')).toBeInTheDocument();
        expect(screen.getByText(/No centralized perp exists/)).toBeInTheDocument();
    });

    it('shows a cheaper-than-Binance verdict with spread', () => {
        (useReferenceFunding as any).mockReturnValue({ referenceRate8h: 0.001, hasReference: true, loading: false });
        render(<FundingComparePanel symbol="BTC-USD" fundingRate={0.00001} side="long" />);
        expect(screen.getByText('Cheaper than Binance')).toBeInTheDocument();
        expect(screen.getByText(/Spread/)).toBeInTheDocument();
        expect(screen.getByText('Binance perp')).toBeInTheDocument();
    });

    it('shows loading placeholder while the reference resolves', () => {
        (useReferenceFunding as any).mockReturnValue({ referenceRate8h: null, hasReference: true, loading: true });
        render(<FundingComparePanel symbol="BTC-USD" fundingRate={0.0001} />);
        expect(screen.getByText('…')).toBeInTheDocument();
    });

    it('shows unavailable when reference is null but not loading', () => {
        (useReferenceFunding as any).mockReturnValue({ referenceRate8h: null, hasReference: true, loading: false });
        render(<FundingComparePanel symbol="BTC-USD" fundingRate={0.0001} />);
        expect(screen.getByText('unavailable')).toBeInTheDocument();
    });

    it('shows above-Binance verdict for a wider long', () => {
        (useReferenceFunding as any).mockReturnValue({ referenceRate8h: 0.00001, hasReference: true, loading: false });
        render(<FundingComparePanel symbol="ETH-USD" fundingRate={0.001} side="long" />);
        expect(screen.getByText('Above Binance')).toBeInTheDocument();
    });
});
