import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';
export type Currency = 'USD' | 'CFX';

interface SettingsState {
    // Theme
    theme: Theme;
    setTheme: (theme: Theme) => void;
    toggleTheme: () => void;

    // Trading Settings
    defaultLeverage: number;
    setDefaultLeverage: (leverage: number) => void;
    maxSlippage: number;
    setMaxSlippage: (slippage: number) => void;
    confirmTrades: boolean;
    setConfirmTrades: (confirm: boolean) => void;
    autoCloseOnLiquidation: boolean;
    setAutoCloseOnLiquidation: (autoClose: boolean) => void;
    defaultOrderType: 'market' | 'limit';
    setDefaultOrderType: (type: 'market' | 'limit') => void;

    // Notifications
    positionAlerts: boolean;
    setPositionAlerts: (enabled: boolean) => void;
    priceAlerts: boolean;
    setPriceAlerts: (enabled: boolean) => void;
    liquidationWarnings: boolean;
    setLiquidationWarnings: (enabled: boolean) => void;
    fundingReminders: boolean;
    setFundingReminders: (enabled: boolean) => void;

    // Security (persisted; real functions can be wired after select)
    requireConfirmation: boolean;
    setRequireConfirmation: (value: boolean) => void;
    twoFactorEnabled: boolean;
    setTwoFactorEnabled: (value: boolean) => void;
    whitelistAddresses: boolean;
    setWhitelistAddresses: (value: boolean) => void;

    // Display
    compactMode: boolean;
    setCompactMode: (compact: boolean) => void;
    showPnlPercent: boolean;
    setShowPnlPercent: (show: boolean) => void;
    currency: Currency;
    setCurrency: (currency: Currency) => void;
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            // Theme - default dark
            theme: 'dark',
            setTheme: (theme) => {
                set({ theme });
                applyTheme(theme);
            },
            toggleTheme: () => set((state) => {
                const newTheme = state.theme === 'dark' ? 'light' : 'dark';
                applyTheme(newTheme);
                return { theme: newTheme };
            }),

            // Trading
            defaultLeverage: 5,
            setDefaultLeverage: (defaultLeverage) => set({ defaultLeverage }),
            maxSlippage: 0.5,
            setMaxSlippage: (maxSlippage) => set({ maxSlippage }),
            confirmTrades: true,
            setConfirmTrades: (confirmTrades) => set({ confirmTrades }),
            autoCloseOnLiquidation: true,
            setAutoCloseOnLiquidation: (autoCloseOnLiquidation) => set({ autoCloseOnLiquidation }),
            defaultOrderType: 'market',
            setDefaultOrderType: (defaultOrderType) => set({ defaultOrderType }),

            // Notifications
            positionAlerts: true,
            setPositionAlerts: (positionAlerts) => set({ positionAlerts }),
            priceAlerts: true,
            setPriceAlerts: (priceAlerts) => set({ priceAlerts }),
            liquidationWarnings: true,
            setLiquidationWarnings: (liquidationWarnings) => set({ liquidationWarnings }),
            fundingReminders: true,
            setFundingReminders: (fundingReminders) => set({ fundingReminders }),

            // Security
            requireConfirmation: true,
            setRequireConfirmation: (requireConfirmation) => set({ requireConfirmation }),
            twoFactorEnabled: false,
            setTwoFactorEnabled: (twoFactorEnabled) => set({ twoFactorEnabled }),
            whitelistAddresses: false,
            setWhitelistAddresses: (whitelistAddresses) => set({ whitelistAddresses }),

            // Display
            compactMode: false,
            setCompactMode: (compactMode) => set({ compactMode }),
            showPnlPercent: true,
            setShowPnlPercent: (showPnlPercent) => set({ showPnlPercent }),
            currency: 'USD',
            setCurrency: (currency) => set({ currency }),
        }),
        {
            name: 'realyx-settings',
        }
    )
);

// Apply theme to document
function applyTheme(theme: Theme) {
    if (theme === 'light') {
        document.documentElement.classList.add('light-theme');
        document.documentElement.classList.remove('dark-theme');
    } else {
        document.documentElement.classList.add('dark-theme');
        document.documentElement.classList.remove('light-theme');
    }
}

// Initialize theme on load
export function initializeTheme() {
    const stored = localStorage.getItem('realyx-settings');
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            applyTheme(parsed.state?.theme || 'dark');
        } catch {
            applyTheme('dark');
        }
    } else {
        applyTheme('dark');
    }
}

// Referral Store
interface ReferralStats {
    totalPoints: number;
    tradingVolume: number;
    referralCount: number;
    referralEarnings: number;
    tier: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
}

interface ReferralState {
    referralCode: string | null;
    usedReferralCode: string | null;
    stats: ReferralStats;
    referrals: Array<{
        wallet: string;
        joinedAt: number;
        volume: number;
        earnings: number;
    }>;

    generateReferralCode: (walletAddress: string) => void;
    applyReferralCode: (code: string) => boolean;
    addTradingVolume: (volume: number) => void;
    addReferralEarning: (amount: number) => void;
}

// Generate a unique referral code from wallet address
function generateCodeFromWallet(wallet: string): string {
    // Take first 4 and last 4 characters, uppercase
    const prefix = wallet.slice(0, 4).toUpperCase();
    const suffix = wallet.slice(-4).toUpperCase();
    return `${prefix}${suffix}`;
}

// Calculate tier based on points
function calculateTier(points: number): ReferralStats['tier'] {
    if (points >= 100000) return 'diamond';
    if (points >= 50000) return 'platinum';
    if (points >= 10000) return 'gold';
    if (points >= 1000) return 'silver';
    return 'bronze';
}

export const useReferralStore = create<ReferralState>()(
    persist(
        (set, get) => ({
            referralCode: null,
            usedReferralCode: null,
            stats: {
                totalPoints: 0,
                tradingVolume: 0,
                referralCount: 0,
                referralEarnings: 0,
                tier: 'bronze',
            },
            referrals: [],

            generateReferralCode: (walletAddress) => {
                const code = generateCodeFromWallet(walletAddress);
                set({ referralCode: code });
            },

            applyReferralCode: (code) => {
                const currentCode = get().referralCode;
                // Can't use own code
                if (code === currentCode) return false;
                // Already applied a code
                if (get().usedReferralCode) return false;

                set({ usedReferralCode: code });
                return true;
            },

            addTradingVolume: (volume) => {
                set((state) => {
                    // 0.1 point per $1 volume
                    const newPoints = volume * 0.1;
                    const totalPoints = state.stats.totalPoints + newPoints;
                    const tradingVolume = state.stats.tradingVolume + volume;

                    return {
                        stats: {
                            ...state.stats,
                            totalPoints,
                            tradingVolume,
                            tier: calculateTier(totalPoints),
                        },
                    };
                });
            },

            addReferralEarning: (amount) => {
                set((state) => ({
                    stats: {
                        ...state.stats,
                        referralEarnings: state.stats.referralEarnings + amount,
                    },
                }));
            },
        }),
        {
            name: 'realyx-referral',
        }
    )
);

// Export types
export type { SettingsState, ReferralState, ReferralStats };
