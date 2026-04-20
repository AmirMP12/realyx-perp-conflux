import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../Settings';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { useAccount, useChainId, useWriteContract, useReadContract } from 'wagmi';
import { useSettingsStore } from '../../stores/settingsStore';
import toast from 'react-hot-toast';

// Mock wagmi
vi.mock('wagmi', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        useAccount: vi.fn(),
        useChainId: vi.fn(),
        useWriteContract: vi.fn(),
        useReadContract: vi.fn(),
    };
});

// Mock stores
vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: vi.fn(),
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    },
    AnimatePresence: ({ children }: any) => children,
}));

// Mock toast
vi.mock('react-hot-toast', () => ({
    default: {
        success: vi.fn(),
        error: vi.fn(),
        loading: vi.fn(),
    },
}));

describe('SettingsPage', () => {
    const mockSettings = {
        defaultLeverage: 5,
        maxSlippage: 0.5,
        defaultOrderType: 'market',
        confirmTrades: true,
        compactMode: false,
        showPnlPercent: true,
        currency: 'USD',
        theme: 'dark',
        setDefaultLeverage: vi.fn(),
        setMaxSlippage: vi.fn(),
        setDefaultOrderType: vi.fn(),
        setConfirmTrades: vi.fn(),
        setCompactMode: vi.fn(),
        setShowPnlPercent: vi.fn(),
        setCurrency: vi.fn(),
        setTheme: vi.fn(),
        setRequireConfirmation: vi.fn(),
        requireConfirmation: true,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useAccount).mockReturnValue({ address: '0x123...456', isConnected: true } as any);
        vi.mocked(useChainId).mockReturnValue(71); // Conflux eSpace Testnet
        vi.mocked(useSettingsStore).mockReturnValue(mockSettings as any);
        vi.mocked(useReadContract).mockReturnValue({ data: 0n } as any);
        vi.mocked(useWriteContract).mockReturnValue({ writeContractAsync: vi.fn() } as any);
        
        // Mock clipboard properly
        if (!navigator.clipboard) {
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText: vi.fn() },
                configurable: true,
            });
        }
        vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    });

    const renderWithRouter = (ui: React.ReactElement) => {
        return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>);
    };

    it('renders and allows switching sections', async () => {
        const user = userEvent.setup();
        renderWithRouter(<SettingsPage />);
        
        expect(screen.getByText('Trading Preferences')).toBeInTheDocument();
        
        const displayTab = screen.getByText('Display');
        await user.click(displayTab);
        
        expect(screen.getAllByText('Display').length).toBeGreaterThan(0);
    });

    it('handles trading preference changes', async () => {
        const user = userEvent.setup();
        renderWithRouter(<SettingsPage />);
        
        // Slippage change
        const slippageBtn = screen.getByText('1%');
        await user.click(slippageBtn);
        expect(mockSettings.setMaxSlippage).toHaveBeenCalledWith(1.0);
        
        // Order type change
        const limitBtn = screen.getByText(/limit/i);
        await user.click(limitBtn);
        expect(mockSettings.setDefaultOrderType).toHaveBeenCalledWith('limit');
    });

    it('handles display settings', async () => {
        const user = userEvent.setup();
        renderWithRouter(<SettingsPage />);
        
        await user.click(screen.getByText('Display'));
        
        // Wait for tab specific text to appear
        const compactModeLabel = await screen.findByText(/Compact mode/i);
        
        // Find the toggle button - it's the only button in that row
        const row = compactModeLabel.closest('.flex.items-center.justify-between');
        const toggleBtn = row?.querySelector('button');
        
        if (toggleBtn) await user.click(toggleBtn);
        expect(mockSettings.setCompactMode).toHaveBeenCalled();
    });

    it('copies wallet address', async () => {
        const user = userEvent.setup();
        renderWithRouter(<SettingsPage />);
        
        const copyBtn = screen.getByText('Copy');
        await user.click(copyBtn);
        
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('0x123...456');
        expect(toast.success).toHaveBeenCalledWith('Address copied!');
    });

    it('handles testnet faucet and minting', async () => {
        const user = userEvent.setup();
        const writeContractAsync = vi.fn().mockResolvedValue('hash');
        vi.mocked(useWriteContract).mockReturnValue({ writeContractAsync } as any);
        
        // Mock window.open
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        
        renderWithRouter(<SettingsPage />);
        
        // Faucet
        const faucetBtn = screen.getByText('Get Testnet CFX');
        await user.click(faucetBtn);
        expect(openSpy).toHaveBeenCalled();
        
        // Mint
        const mintBtn = screen.getByText(/Mint 1,000 Mock USDC/i);
        await user.click(mintBtn);
        expect(writeContractAsync).toHaveBeenCalled();
    });
});
