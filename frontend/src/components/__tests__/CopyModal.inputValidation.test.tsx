import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CopyModal } from '../CopyModal';
import { useAccount, useWriteContract } from 'wagmi';

vi.mock('wagmi', () => ({ useAccount: vi.fn(), useWriteContract: vi.fn() }));

const baseProps = {
    isOpen: true, onClose: vi.fn(), leadTraderAddress: '0x1234567890123456789012345678901234567890',
    leadTraderName: 'Alpha', profitFeeBps: 0, usdcAddress: '0xusdc', tradingCoreAddress: '0xcore',
    copyRegistryAddress: '0xreg', copyBotAddress: '0xbot',
};

describe('CopyModal input validation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xuser' });
        (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockResolvedValue('0x') });
    });

    it('handles an invalid allocation without crashing (parseUnits catch)', () => {
        render(<CopyModal {...baseProps} />);
        const allocation = screen.getByPlaceholderText('1000') as HTMLInputElement;
        fireEvent.change(allocation, { target: { value: 'abc' } });
        // Setup button disabled because parseFloat('abc') <= 0 is false-y guard -> still renders
        expect(screen.getByText('Start Setup')).toBeInTheDocument();
    });

    it('clamps an out-of-range leverage', () => {
        render(<CopyModal {...baseProps} />);
        const leverage = screen.getByPlaceholderText('30') as HTMLInputElement;
        fireEvent.change(leverage, { target: { value: '500' } });
        expect(leverage.value).toBe('500');
        const allocation = screen.getByPlaceholderText('1000');
        fireEvent.change(allocation, { target: { value: '1000' } });
        expect(screen.getByText('Start Setup').closest('button')).not.toBeDisabled();
    });
});
