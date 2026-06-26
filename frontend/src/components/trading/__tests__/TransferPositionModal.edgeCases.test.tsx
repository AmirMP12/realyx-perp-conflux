import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { TransferPositionModal } from '../TransferPositionModal';
import { useTransferPosition } from '../../../hooks/useTransferPosition';
import { useAccount } from 'wagmi';

vi.mock('../../../hooks/useTransferPosition', () => ({ useTransferPosition: vi.fn() }));
vi.mock('wagmi', () => ({ useAccount: vi.fn() }));

const longPos = { id: '7', collateral: '100', leverage: '10', size: '1000', isLong: true, marketAddress: '0x1234567890123456789012345678901234567890' } as any;
const shortPosShortAddr = { id: '8', collateral: '50', leverage: '5', size: '500', isLong: false, marketAddress: '0xABCD' } as any;
const noAddrPos = { id: '9', collateral: '50', leverage: '5', size: '500', isLong: true, marketAddress: '' } as any;

describe('TransferPositionModal edge cases', () => {
    const transfer = vi.fn();
    const recipientHasCode = vi.fn();
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0x1111111111111111111111111111111111111111' });
        (useTransferPosition as any).mockReturnValue({ transfer, loading: false, isConfigured: true, recipientHasCode });
    });

    it('shows the not-configured warning and disables transfer', () => {
        (useTransferPosition as any).mockReturnValue({ transfer, loading: false, isConfigured: false, recipientHasCode });
        render(<TransferPositionModal isOpen onClose={vi.fn()} position={longPos} />);
        expect(screen.getByText(/VITE_POSITION_TOKEN_ADDRESS/)).toBeInTheDocument();
        expect(screen.getByText('Transfer NFT').closest('button')).toBeDisabled();
    });

    it('renders a short position with a short (untruncated) market address', () => {
        render(<TransferPositionModal isOpen onClose={vi.fn()} position={shortPosShortAddr} />);
        expect(screen.getByText('Short')).toBeInTheDocument();
        expect(screen.getByText('0xABCD')).toBeInTheDocument();
    });

    it('renders the em-dash placeholder when there is no market address', () => {
        render(<TransferPositionModal isOpen onClose={vi.fn()} position={noAddrPos} />);
        expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('clears the contract warning if the code check throws', async () => {
        recipientHasCode.mockRejectedValue(new Error('rpc fail'));
        render(<TransferPositionModal isOpen onClose={vi.fn()} position={longPos} />);
        fireEvent.change(screen.getByPlaceholderText('0x…'), { target: { value: '0x2222222222222222222222222222222222222222' } });
        await waitFor(() => expect(screen.queryByText(/contract code/)).not.toBeInTheDocument());
    });

    it('keeps the modal open when transfer returns false', async () => {
        recipientHasCode.mockResolvedValue(false);
        transfer.mockResolvedValue(false);
        const onClose = vi.fn();
        const onSuccess = vi.fn();
        render(<TransferPositionModal isOpen onClose={onClose} onSuccess={onSuccess} position={longPos} />);
        fireEvent.change(screen.getByPlaceholderText('0x…'), { target: { value: '0x2222222222222222222222222222222222222222' } });
        await waitFor(() => expect(screen.getByText('Transfer NFT').closest('button')).not.toBeDisabled());
        await act(async () => { fireEvent.click(screen.getByText('Transfer NFT')); });
        expect(transfer).toHaveBeenCalled();
        expect(onSuccess).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });
});
