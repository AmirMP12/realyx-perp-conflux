import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { CopyModal } from '../CopyModal';
import { useAccount, useWriteContract } from 'wagmi';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), useWriteContract: vi.fn() }));

const baseProps = {
    isOpen: true, onClose: vi.fn(), leadTraderAddress: '0x1234567890123456789012345678901234567890',
    leadTraderName: 'Alpha', usdcAddress: '0xusdc', tradingCoreAddress: '0xcore',
    copyRegistryAddress: '0xreg', copyBotAddress: '0xbot',
};

describe('CopyModal setup flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xuser' });
    });

    it('shows the profit fee when one is configured', () => {
        (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn() });
        render(<CopyModal {...baseProps} profitFeeBps={250} />);
        expect(screen.getByText(/Profit Fee: 2.5%/)).toBeInTheDocument();
    });

    it('runs the 3-step setup to completion', async () => {
        const write = vi.fn().mockResolvedValue('0xhash');
        (useWriteContract as any).mockReturnValue({ writeContractAsync: write });
        render(<CopyModal {...baseProps} />);
        await act(async () => { fireEvent.click(screen.getByText('Start Setup')); });
        await waitFor(() => expect(screen.getByText('All Set!')).toBeInTheDocument());
        expect(write).toHaveBeenCalledTimes(3);
        const fns = write.mock.calls.map((c) => c[0].functionName);
        expect(fns).toEqual(['approve', 'addSubaccount', 'followTrader']);
    });

    it('surfaces an error and returns to config on failure', async () => {
        const write = vi.fn().mockRejectedValue({ shortMessage: 'user rejected' });
        (useWriteContract as any).mockReturnValue({ writeContractAsync: write });
        render(<CopyModal {...baseProps} />);
        await act(async () => { fireEvent.click(screen.getByText('Start Setup')); });
        await waitFor(() => expect(screen.getByText('user rejected')).toBeInTheDocument());
        expect(screen.getByText('Start Setup')).toBeInTheDocument();
    });

    it('uses the generic error message when none is provided, and clamps invalid leverage', async () => {
        const write = vi.fn().mockRejectedValue({});
        (useWriteContract as any).mockReturnValue({ writeContractAsync: write });
        render(<CopyModal {...baseProps} />);
        // invalid leverage -> clamped to 30 internally
        fireEvent.change(screen.getByPlaceholderText('30'), { target: { value: '0' } });
        await act(async () => { fireEvent.click(screen.getByText('Start Setup')); });
        await waitFor(() => expect(screen.getByText('Transaction failed')).toBeInTheDocument());
    });

    it('completes and closes from the done step', async () => {
        const onClose = vi.fn();
        const write = vi.fn().mockResolvedValue('0x');
        (useWriteContract as any).mockReturnValue({ writeContractAsync: write });
        render(<CopyModal {...baseProps} onClose={onClose} />);
        await act(async () => { fireEvent.click(screen.getByText('Start Setup')); });
        await waitFor(() => expect(screen.getByText('Got It')).toBeInTheDocument());
        fireEvent.click(screen.getByText('Got It'));
        expect(onClose).toHaveBeenCalled();
    });
});
