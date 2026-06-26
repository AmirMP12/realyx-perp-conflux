import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ClosePositionModal } from '../ClosePositionModal';
import { useClosePosition, usePartialClose } from '../../../hooks/useProgram';
import { usePythOnChainUpdater } from '../../../hooks/usePythOnChainUpdater';

vi.mock('../../../hooks/useProgram', () => ({ useClosePosition: vi.fn(), usePartialClose: vi.fn() }));
vi.mock('../../../hooks/usePythOnChainUpdater', () => ({ usePythOnChainUpdater: vi.fn() }));

const position = {
    id: '1', sizeRaw: '1000000000000000000000', marketAddress: '0x1234567890123456789012345678901234567890',
    size: '1000', collateral: '100', entryPrice: '100', markPrice: '105', pnl: '50', leverage: '10', isLong: true,
    liquidationPrice: '92', stopLossPrice: 0, takeProfitPrice: 0,
} as any;

describe('ClosePositionModal', () => {
    const closePosition = vi.fn().mockResolvedValue(true);
    const partialClose = vi.fn().mockResolvedValue(true);
    const pushLatestForMarkets = vi.fn().mockResolvedValue(true);

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        (useClosePosition as any).mockReturnValue({ closePosition, loading: false });
        (usePartialClose as any).mockReturnValue({ partialClose, loading: false });
        (usePythOnChainUpdater as any).mockReturnValue({ pushLatestForMarkets, isPending: false });
    });
    afterEach(() => vi.useRealTimers());

    it('returns null when no position', () => {
        const { container } = render(<ClosePositionModal isOpen onClose={vi.fn()} position={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the close UI for a position', () => {
        render(<ClosePositionModal isOpen onClose={vi.fn()} position={position} />);
        expect(screen.getByText('Close amount')).toBeInTheDocument();
        expect(screen.getByText('Long')).toBeInTheDocument();
    });

    it('performs a full close (pushes pyth then closePosition)', async () => {
        const onClose = vi.fn();
        const onCloseSuccess = vi.fn();
        render(<ClosePositionModal isOpen onClose={onClose} onCloseSuccess={onCloseSuccess} position={position} />);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Close position' }));
            await vi.advanceTimersByTimeAsync(900);
        });
        expect(pushLatestForMarkets).toHaveBeenCalledWith([position.marketAddress]);
        expect(closePosition).toHaveBeenCalledWith('1');
        expect(onCloseSuccess).toHaveBeenCalled();
    });

    it('performs a partial close at 50%', async () => {
        render(<ClosePositionModal isOpen onClose={vi.fn()} position={position} />);
        fireEvent.click(screen.getByText('50%'));
        await act(async () => {
            fireEvent.click(screen.getByText('Close 50%'));
            await vi.advanceTimersByTimeAsync(900);
        });
        expect(partialClose).toHaveBeenCalledWith('1', 50, position.sizeRaw);
    });

    it('aborts when the pyth push fails', async () => {
        pushLatestForMarkets.mockResolvedValueOnce(false);
        render(<ClosePositionModal isOpen onClose={vi.fn()} position={position} />);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close position' })); });
        expect(closePosition).not.toHaveBeenCalled();
    });
});
