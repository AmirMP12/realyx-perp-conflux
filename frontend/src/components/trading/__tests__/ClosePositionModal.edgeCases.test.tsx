import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ClosePositionModal } from '../ClosePositionModal';
import { useClosePosition, usePartialClose } from '../../../hooks/useProgram';
import { usePythOnChainUpdater } from '../../../hooks/usePythOnChainUpdater';

vi.mock('../../../hooks/useProgram', () => ({ useClosePosition: vi.fn(), usePartialClose: vi.fn() }));
vi.mock('../../../hooks/usePythOnChainUpdater', () => ({ usePythOnChainUpdater: vi.fn() }));

const closePosition = vi.fn();
const partialClose = vi.fn();
const pushLatestForMarkets = vi.fn();

describe('ClosePositionModal edge cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        closePosition.mockResolvedValue(true);
        partialClose.mockResolvedValue(true);
        pushLatestForMarkets.mockResolvedValue(true);
        (useClosePosition as any).mockReturnValue({ closePosition, loading: false });
        (usePartialClose as any).mockReturnValue({ partialClose, loading: false });
        (usePythOnChainUpdater as any).mockReturnValue({ pushLatestForMarkets, isPending: false });
    });
    afterEach(() => vi.clearAllMocks());

    it('renders a short position with negative live PnL and short address', () => {
        const shortPos = { id: '2', sizeRaw: '1', marketAddress: '', size: '500', collateral: '50', pnl: '-30', livePnl: '-30', isLong: false } as any;
        render(<ClosePositionModal isOpen onClose={vi.fn()} position={shortPos} />);
        expect(screen.getByText('Short')).toBeInTheDocument();
        expect(screen.getByText('—')).toBeInTheDocument();
        // negative est PnL renders in the short (red) tone
        expect(screen.getByText(/30\.00/)).toBeInTheDocument();
    });

    it('closes without a pyth push when the market address is not a full 0x address', async () => {
        const oddAddr = { id: '3', sizeRaw: '1', marketAddress: '0xABCD', size: '100', collateral: '10', pnl: '5', isLong: true } as any;
        render(<ClosePositionModal isOpen onClose={vi.fn()} position={oddAddr} />);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close position' })); });
        expect(pushLatestForMarkets).not.toHaveBeenCalled();
        expect(closePosition).toHaveBeenCalledWith('3');
    });

    it('keeps the modal open when the close fails', async () => {
        closePosition.mockResolvedValue(false);
        const onClose = vi.fn();
        const onCloseSuccess = vi.fn();
        const oddAddr = { id: '4', sizeRaw: '1', marketAddress: '0xABCD', size: '100', collateral: '10', pnl: '5', isLong: true } as any;
        render(<ClosePositionModal isOpen onClose={onClose} onCloseSuccess={onCloseSuccess} position={oddAddr} />);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close position' })); });
        expect(onCloseSuccess).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('disables the buttons while a close is in flight', () => {
        (useClosePosition as any).mockReturnValue({ closePosition, loading: true });
        const pos = { id: '5', sizeRaw: '1', marketAddress: '0x1234567890123456789012345678901234567890', size: '100', collateral: '10', pnl: '5', isLong: true } as any;
        render(<ClosePositionModal isOpen onClose={vi.fn()} position={pos} />);
        expect(screen.getByText('Closing…').closest('button')).toBeDisabled();
    });
});
