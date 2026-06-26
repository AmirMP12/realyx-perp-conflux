import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { CollateralEditModal } from '../CollateralEditModal';
import { TransferPositionModal } from '../TransferPositionModal';
import { useModifyMargin } from '../../../hooks/useProgram';
import { useTransferPosition } from '../../../hooks/useTransferPosition';
import { useAccount } from 'wagmi';
import toast from 'react-hot-toast';

vi.mock('../../../hooks/useProgram', () => ({ useModifyMargin: vi.fn() }));
vi.mock('../../../hooks/useTransferPosition', () => ({ useTransferPosition: vi.fn() }));
vi.mock('wagmi', () => ({ useAccount: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const position = { id: '7', collateral: '100', leverage: '10', size: '1000', isLong: true, marketAddress: '0x1234567890123456789012345678901234567890' } as any;

describe('CollateralEditModal', () => {
    const modifyMargin = vi.fn().mockResolvedValue(undefined);
    beforeEach(() => {
        vi.clearAllMocks();
        (useModifyMargin as any).mockReturnValue({ modifyMargin, loading: false });
    });

    it('returns null without a position', () => {
        const { container } = render(<CollateralEditModal isOpen onClose={vi.fn()} position={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('deposits collateral', async () => {
        const onClose = vi.fn();
        render(<CollateralEditModal isOpen onClose={onClose} position={position} />);
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '50abc.5' } });
        await act(async () => { fireEvent.click(screen.getByText('Deposit collateral')); });
        expect(modifyMargin).toHaveBeenCalledWith(7, 50.5);
    });

    it('withdraws collateral (negative delta)', async () => {
        render(<CollateralEditModal isOpen onClose={vi.fn()} position={position} />);
        fireEvent.click(screen.getByText('Withdraw'));
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '40' } });
        await act(async () => { fireEvent.click(screen.getByText('Withdraw collateral')); });
        expect(modifyMargin).toHaveBeenCalledWith(7, -40);
    });

    it('flags a withdrawal exceeding collateral', () => {
        render(<CollateralEditModal isOpen onClose={vi.fn()} position={position} />);
        fireEvent.click(screen.getByText('Withdraw'));
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '999' } });
        expect(screen.getByText(/exceeds available collateral/)).toBeInTheDocument();
    });
});

describe('TransferPositionModal', () => {
    const transfer = vi.fn().mockResolvedValue(true);
    const recipientHasCode = vi.fn().mockResolvedValue(false);
    beforeEach(() => {
        vi.clearAllMocks();
        transfer.mockResolvedValue(true);
        recipientHasCode.mockResolvedValue(false);
        (useAccount as any).mockReturnValue({ address: '0x1111111111111111111111111111111111111111' });
        (useTransferPosition as any).mockReturnValue({ transfer, loading: false, isConfigured: true, recipientHasCode });
    });

    it('returns null without a position', () => {
        const { container } = render(<TransferPositionModal isOpen onClose={vi.fn()} position={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('rejects an invalid address', () => {
        render(<TransferPositionModal isOpen onClose={vi.fn()} position={position} />);
        fireEvent.change(screen.getByPlaceholderText('0x…'), { target: { value: 'notanaddress' } });
        expect(screen.getByText('Enter a valid 0x address.')).toBeInTheDocument();
    });

    it('warns when transferring to your own wallet', () => {
        render(<TransferPositionModal isOpen onClose={vi.fn()} position={position} />);
        fireEvent.change(screen.getByPlaceholderText('0x…'), { target: { value: '0x1111111111111111111111111111111111111111' } });
        expect(screen.getByText(/different wallet/)).toBeInTheDocument();
    });

    it('warns when the recipient is a contract', async () => {
        recipientHasCode.mockResolvedValue(true);
        render(<TransferPositionModal isOpen onClose={vi.fn()} position={position} />);
        fireEvent.change(screen.getByPlaceholderText('0x…'), { target: { value: '0x2222222222222222222222222222222222222222' } });
        await waitFor(() => expect(screen.getByText(/contract code/)).toBeInTheDocument());
    });

    it('transfers to a valid EOA recipient', async () => {
        const onSuccess = vi.fn();
        const onClose = vi.fn();
        render(<TransferPositionModal isOpen onClose={onClose} onSuccess={onSuccess} position={position} />);
        fireEvent.change(screen.getByPlaceholderText('0x…'), { target: { value: '0x2222222222222222222222222222222222222222' } });
        await waitFor(() => expect(screen.getByText('Transfer NFT').closest('button')).not.toBeDisabled());
        await act(async () => { fireEvent.click(screen.getByText('Transfer NFT')); });
        expect(transfer).toHaveBeenCalledWith('0x2222222222222222222222222222222222222222', '7');
        expect(onSuccess).toHaveBeenCalled();
    });
});
