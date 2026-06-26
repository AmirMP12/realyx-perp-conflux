import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from '../Settings';
import { useAccount, useChainId, useWriteContract, useReadContract } from 'wagmi';
import { useSettingsStore } from '../../stores/settingsStore';
import toast from 'react-hot-toast';

vi.mock('wagmi', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, useAccount: vi.fn(), useChainId: vi.fn(), useWriteContract: vi.fn(), useReadContract: vi.fn() };
});
vi.mock('../../stores/settingsStore', () => ({ useSettingsStore: vi.fn() }));
vi.mock('../../components/NotificationSetup', () => ({ NotificationSetup: () => <div data-testid="notif-setup" /> }));

const mockSettings = {
    defaultLeverage: 5, maxSlippage: 0.5, defaultOrderType: 'market', confirmTrades: true,
    compactMode: false, showPnlPercent: true, currency: 'USD', theme: 'dark', requireConfirmation: true,
    setDefaultLeverage: vi.fn(), setMaxSlippage: vi.fn(), setDefaultOrderType: vi.fn(), setConfirmTrades: vi.fn(),
    setCompactMode: vi.fn(), setShowPnlPercent: vi.fn(), setCurrency: vi.fn(), setTheme: vi.fn(),
    setRequireConfirmation: vi.fn(), setWhitelistAddresses: vi.fn(), setAutoCloseOnLiquidation: vi.fn(),
};

const renderPage = () =>
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><SettingsPage /></MemoryRouter>);

describe('SettingsPage extra', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xabc1234567890def', isConnected: true });
        (useChainId as any).mockReturnValue(71);
        (useSettingsStore as any).mockReturnValue(mockSettings);
        (useReadContract as any).mockReturnValue({ data: 0n });
        (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockResolvedValue('0x') });
    });

    it('changes default leverage via slider', () => {
        renderPage();
        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: '8' } });
        expect(mockSettings.setDefaultLeverage).toHaveBeenCalledWith(8);
    });

    it('toggles confirm trades', () => {
        renderPage();
        const label = screen.getByText('Confirm trades');
        const row = label.closest('.flex.items-center.justify-between') as HTMLElement;
        fireEvent.click(row.querySelector('button')!);
        expect(mockSettings.setConfirmTrades).toHaveBeenCalled();
    });

    it('renders notifications section', () => {
        renderPage();
        fireEvent.click(screen.getByText('Notifications'));
        expect(screen.getByTestId('notif-setup')).toBeInTheDocument();
        expect(screen.getByText('Alert types')).toBeInTheDocument();
    });

    it('renders security section and toggles review transactions', () => {
        renderPage();
        fireEvent.click(screen.getByText('Security'));
        expect(screen.getByText('Security Notice')).toBeInTheDocument();
        const label = screen.getByText('Review transactions');
        const row = label.closest('.flex.items-center.justify-between') as HTMLElement;
        fireEvent.click(row.querySelector('button')!);
        expect(mockSettings.setRequireConfirmation).toHaveBeenCalled();
    });

    it('renders display section theme toggle', () => {
        renderPage();
        fireEvent.click(screen.getByText('Display'));
        fireEvent.click(screen.getByText('Light Mode'));
        expect(mockSettings.setTheme).toHaveBeenCalledWith('light');
    });

    it('shows balance when the user holds USDT0', () => {
        (useReadContract as any).mockReturnValue({ data: 5_000_000n });
        renderPage();
        expect(screen.getByText(/Balance:/)).toBeInTheDocument();
    });

    it('handles mint rejection gracefully', async () => {
        (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockRejectedValue({ message: 'User rejected' }) });
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderPage();
        fireEvent.click(screen.getByText(/Mint 1,000 Mock USDT0/i));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Transaction rejected', expect.anything()));
        errSpy.mockRestore();
    });

    it('handles generic mint failure', async () => {
        (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockRejectedValue({ message: 'reverted' }) });
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderPage();
        fireEvent.click(screen.getByText(/Mint 1,000 Mock USDT0/i));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Mint failed. You may have already minted.', expect.anything()));
        errSpy.mockRestore();
    });

    it('shows connect-wallet mint button when disconnected', () => {
        (useAccount as any).mockReturnValue({ address: undefined, isConnected: false });
        renderPage();
        expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
    });
});
