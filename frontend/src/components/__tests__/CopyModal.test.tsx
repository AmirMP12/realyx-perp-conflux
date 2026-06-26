import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CopyModal } from '../CopyModal';
import { useAccount, useWriteContract } from 'wagmi';

vi.mock('wagmi', () => ({
    useAccount: vi.fn(),
    useWriteContract: vi.fn(),
}));

const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    leadTraderAddress: '0x1234567890123456789012345678901234567890',
    leadTraderName: 'Alpha',
    profitFeeBps: 1000,
    usdcAddress: '0xusdc',
    tradingCoreAddress: '0xcore',
    copyRegistryAddress: '0xreg',
    copyBotAddress: '0xbot',
};

describe('CopyModal', () => {
    let writeContractAsync: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        writeContractAsync = vi.fn().mockResolvedValue('0xhash');
        (useAccount as any).mockReturnValue({ address: '0xuser' });
        (useWriteContract as any).mockReturnValue({ writeContractAsync });
    });

    it('does not render content when closed', () => {
        render(<CopyModal {...baseProps} isOpen={false} />);
        expect(screen.queryByText('Start Setup')).not.toBeInTheDocument();
    });

    it('renders config step with trader name and profit fee', () => {
        render(<CopyModal {...baseProps} />);
        expect(screen.getByText(/Copy Alpha/)).toBeInTheDocument();
        expect(screen.getByText(/Profit Fee: 10.0%/)).toBeInTheDocument();
        expect(screen.getByText('Start Setup')).toBeInTheDocument();
    });

    it('falls back to truncated address when no name', () => {
        render(<CopyModal {...baseProps} leadTraderName={undefined} profitFeeBps={0} />);
        expect(screen.getByText(/Copy 0x1234/)).toBeInTheDocument();
    });

    it('runs the 3-step setup and reaches done state', async () => {
        render(<CopyModal {...baseProps} />);
        fireEvent.click(screen.getByText('Start Setup'));
        await waitFor(() => expect(screen.getByText('All Set!')).toBeInTheDocument());
        expect(writeContractAsync).toHaveBeenCalledTimes(3);
        fireEvent.click(screen.getByText('Got It'));
        expect(baseProps.onClose).toHaveBeenCalled();
    });

    it('shows error message when a transaction fails', async () => {
        writeContractAsync.mockRejectedValueOnce({ shortMessage: 'User rejected' });
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<CopyModal {...baseProps} />);
        fireEvent.click(screen.getByText('Start Setup'));
        await waitFor(() => expect(screen.getByText('User rejected')).toBeInTheDocument());
        errSpy.mockRestore();
    });

    it('updates allocation and leverage inputs', () => {
        render(<CopyModal {...baseProps} />);
        const allocation = screen.getByPlaceholderText('1000') as HTMLInputElement;
        fireEvent.change(allocation, { target: { value: '5000' } });
        expect(allocation.value).toBe('5000');
        const leverage = screen.getByPlaceholderText('30') as HTMLInputElement;
        fireEvent.change(leverage, { target: { value: '50' } });
        expect(leverage.value).toBe('50');
    });

    it('disables setup when allocation is zero', () => {
        render(<CopyModal {...baseProps} />);
        const allocation = screen.getByPlaceholderText('1000');
        fireEvent.change(allocation, { target: { value: '0' } });
        expect(screen.getByText('Start Setup').closest('button')).toBeDisabled();
    });
});
