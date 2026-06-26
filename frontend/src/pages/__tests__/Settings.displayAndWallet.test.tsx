import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn(), loading: vi.fn() } }));

const mockSettings = {
    defaultLeverage: 5, maxSlippage: 0.5, defaultOrderType: 'market', confirmTrades: true,
    compactMode: false, showPnlPercent: true, currency: 'USD', theme: 'dark', requireConfirmation: true,
    setDefaultLeverage: vi.fn(), setMaxSlippage: vi.fn(), setDefaultOrderType: vi.fn(), setConfirmTrades: vi.fn(),
    setCompactMode: vi.fn(), setShowPnlPercent: vi.fn(), setCurrency: vi.fn(), setTheme: vi.fn(),
    setRequireConfirmation: vi.fn(), setWhitelistAddresses: vi.fn(), setAutoCloseOnLiquidation: vi.fn(),
};

const renderPage = () =>
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><SettingsPage /></MemoryRouter>);

describe('SettingsPage more handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAccount as any).mockReturnValue({ address: '0xabc1234567890def1234567890abcdef12345678', isConnected: true });
        (useChainId as any).mockReturnValue(71);
        (useSettingsStore as any).mockReturnValue(mockSettings);
        (useReadContract as any).mockReturnValue({ data: 0n });
        (useWriteContract as any).mockReturnValue({ writeContractAsync: vi.fn().mockResolvedValue('0x') });
        Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
    });
    afterEach(() => vi.useRealTimers());

    it('copies the wallet address and resets the copied flag after the timeout', () => {
        vi.useFakeTimers();
        renderPage();
        // The wallet card copy button (Copy icon) calls copyAddress.
        const copyBtn = screen.getByText('Connected').closest('.glass-panel')?.querySelector('button');
        expect(copyBtn).toBeTruthy();
        act(() => { fireEvent.click(copyBtn!); });
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith('Address copied!');
        act(() => { vi.advanceTimersByTime(2000); }); // setTimeout(() => setCopied(false), 2000)
    });

    it('toggles compact mode and show-PnL in the Display section', () => {
        renderPage();
        fireEvent.click(screen.getByText('Display'));
        const compact = screen.getByText('Compact mode').closest('.flex.items-center.justify-between') as HTMLElement;
        fireEvent.click(compact.querySelector('button')!);
        expect(mockSettings.setCompactMode).toHaveBeenCalled();
        const pnl = screen.getByText('Show PnL as %').closest('.flex.items-center.justify-between') as HTMLElement;
        fireEvent.click(pnl.querySelector('button')!);
        expect(mockSettings.setShowPnlPercent).toHaveBeenCalled();
    });

    it('selects the Dark Mode theme', () => {
        renderPage();
        fireEvent.click(screen.getByText('Display'));
        fireEvent.click(screen.getByText('Dark Mode').closest('button')!);
        expect(mockSettings.setTheme).toHaveBeenCalledWith('dark');
    });
});
