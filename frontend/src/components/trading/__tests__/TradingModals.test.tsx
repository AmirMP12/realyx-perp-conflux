
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CollateralEditModal } from '../CollateralEditModal';
import { ClosePositionModal } from '../ClosePositionModal';
import { TransferPositionModal } from '../TransferPositionModal';
import { useModifyMargin, useClosePosition, usePartialClose } from '../../../hooks/useProgram';
import { useTransferPosition } from '../../../hooks/useTransferPosition';
import { usePythOnChainUpdater } from '../../../hooks/usePythOnChainUpdater';
import { useAccount } from 'wagmi';

vi.mock('../../../hooks/useProgram', () => ({
    useModifyMargin: vi.fn(),
    useClosePosition: vi.fn(),
    usePartialClose: vi.fn(),
}));

vi.mock('../../../hooks/useTransferPosition', () => ({
    useTransferPosition: vi.fn(),
}));

vi.mock('../../../hooks/usePythOnChainUpdater', () => ({
    usePythOnChainUpdater: vi.fn(),
}));

vi.mock('wagmi', () => ({
    useAccount: vi.fn(),
}));

const mockPosition = {
    id: '1',
    marketAddress: '0x0000000000000000000000000000000000000001',
    symbol: 'BTC-USD',
    isLong: true,
    size: '1000',
    sizeRaw: 1000n,
    collateral: '100',
    leverage: '10',
    pnl: '10',
};

describe('Trading Modals', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xUser' });
    });

    describe('CollateralEditModal', () => {
        const mockModifyMargin = vi.fn();
        beforeEach(() => {
            (useModifyMargin as any).mockReturnValue({ modifyMargin: mockModifyMargin, loading: false });
        });

        it('switches between deposit and withdraw modes', () => {
            render(<CollateralEditModal isOpen={true} onClose={vi.fn()} position={mockPosition as any} />);
            
            const withdrawBtn = screen.getByText('Withdraw');
            fireEvent.click(withdrawBtn);
            expect(screen.getByText('Withdraw collateral')).toBeInTheDocument();
            
            const depositBtn = screen.getByText('Deposit');
            fireEvent.click(depositBtn);
            expect(screen.getByText('Deposit collateral')).toBeInTheDocument();
        });

        it('validates amount and calls modifyMargin', async () => {
            render(<CollateralEditModal isOpen={true} onClose={vi.fn()} position={mockPosition as any} />);
            
            const input = screen.getByPlaceholderText('0.00');
            fireEvent.change(input, { target: { value: '50' } });
            
            const submitBtn = screen.getByText('Deposit collateral');
            await act(async () => {
                fireEvent.click(submitBtn);
            });
            
            expect(mockModifyMargin).toHaveBeenCalledWith(1, 50);
        });

        it('shows error if withdrawing more than current collateral', () => {
            render(<CollateralEditModal isOpen={true} onClose={vi.fn()} position={mockPosition as any} />);
            fireEvent.click(screen.getByText('Withdraw'));
            fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '150' } });
            expect(screen.getByText('Amount exceeds available collateral.')).toBeInTheDocument();
        });
    });

    describe('ClosePositionModal', () => {
        const mockClose = vi.fn();
        const mockPartialClose = vi.fn();
        const mockPushPyth = vi.fn().mockResolvedValue(true);

        beforeEach(() => {
            (useClosePosition as any).mockReturnValue({ closePosition: mockClose, loading: false });
            (usePartialClose as any).mockReturnValue({ partialClose: mockPartialClose, loading: false });
            (usePythOnChainUpdater as any).mockReturnValue({ pushLatestForMarkets: mockPushPyth, isPending: false });
        });

        it('handles full close with Pyth update', async () => {
            render(<ClosePositionModal isOpen={true} onClose={vi.fn()} position={mockPosition as any} />);
            
            const closeBtn = screen.getByRole('button', { name: 'Close position' });
            await act(async () => {
                fireEvent.click(closeBtn);
            });
            
            expect(mockPushPyth).toHaveBeenCalledWith([mockPosition.marketAddress]);
            expect(mockClose).toHaveBeenCalledWith('1');
        });

        it('handles partial close', async () => {
            render(<ClosePositionModal isOpen={true} onClose={vi.fn()} position={mockPosition as any} />);
            
            fireEvent.click(screen.getByText('50%'));
            const closeBtn = screen.getByText('Close 50%');
            await act(async () => {
                fireEvent.click(closeBtn);
            });
            
            expect(mockPartialClose).toHaveBeenCalledWith('1', 50, mockPosition.sizeRaw);
        });
    });

    describe('TransferPositionModal', () => {
        const mockTransfer = vi.fn();
        const mockHasCode = vi.fn().mockResolvedValue(false);

        beforeEach(() => {
            (useTransferPosition as any).mockReturnValue({
                transfer: mockTransfer,
                loading: false,
                isConfigured: true,
                recipientHasCode: mockHasCode
            });
        });

        it('validates recipient and handles transfer', async () => {
            render(<TransferPositionModal isOpen={true} onClose={vi.fn()} position={mockPosition as any} />);
            
            const input = screen.getByPlaceholderText('0x…');
            const validAddr = '0x0000000000000000000000000000000000000002';
            fireEvent.change(input, { target: { value: validAddr } });
            
            // Wait for internal debounce/async check
            await waitFor(() => expect(mockHasCode).toHaveBeenCalled());
            
            const transferBtn = screen.getByText('Transfer NFT');
            await act(async () => {
                fireEvent.click(transferBtn);
            });
            
            expect(mockTransfer).toHaveBeenCalledWith(validAddr, '1');
        });

        it('shows contract warning if recipient is a contract', async () => {
            mockHasCode.mockResolvedValue(true);
            render(<TransferPositionModal isOpen={true} onClose={vi.fn()} position={mockPosition as any} />);
            
            fireEvent.change(screen.getByPlaceholderText('0x…'), { target: { value: '0x0000000000000000000000000000000000000002' } });
            
            await screen.findByText(/has contract code/);
        });
    });
});
