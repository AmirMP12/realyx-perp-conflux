import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, useReferralStore, initializeTheme } from '../settingsStore';

describe('settingsStore', () => {
    beforeEach(() => {
        // Reset stores before each test
        useSettingsStore.setState(useSettingsStore.getInitialState());
        useReferralStore.setState(useReferralStore.getInitialState());
        localStorage.clear();
        document.documentElement.className = '';
    });

    describe('useSettingsStore', () => {
        it('should have initial values', () => {
            const state = useSettingsStore.getState();
            expect(state.theme).toBe('dark');
            expect(state.defaultLeverage).toBe(5);
            expect(state.currency).toBe('USD');
        });

        it('should update theme and apply CSS class', () => {
            const { setTheme } = useSettingsStore.getState();
            
            setTheme('light');
            expect(useSettingsStore.getState().theme).toBe('light');
            expect(document.documentElement.classList.contains('light-theme')).toBe(true);
            
            setTheme('dark');
            expect(useSettingsStore.getState().theme).toBe('dark');
            expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
        });

        it('should toggle theme', () => {
            const { toggleTheme } = useSettingsStore.getState();
            
            toggleTheme();
            expect(useSettingsStore.getState().theme).toBe('light');
            
            toggleTheme();
            expect(useSettingsStore.getState().theme).toBe('dark');
        });

        it('should update various trading settings', () => {
            const state = useSettingsStore.getState();
            
            state.setDefaultLeverage(10);
            expect(useSettingsStore.getState().defaultLeverage).toBe(10);
            
            state.setMaxSlippage(1.0);
            expect(useSettingsStore.getState().maxSlippage).toBe(1.0);
            
            state.setConfirmTrades(false);
            expect(useSettingsStore.getState().confirmTrades).toBe(false);
            
            state.setDefaultOrderType('limit');
            expect(useSettingsStore.getState().defaultOrderType).toBe('limit');
        });

        it('should update display and notification settings', () => {
            const state = useSettingsStore.getState();
            
            state.setCompactMode(true);
            expect(useSettingsStore.getState().compactMode).toBe(true);
            
            state.setShowPnlPercent(false);
            expect(useSettingsStore.getState().showPnlPercent).toBe(false);
            
            state.setCurrency('CFX');
            expect(useSettingsStore.getState().currency).toBe('CFX');
            
            state.setPositionAlerts(false);
            expect(useSettingsStore.getState().positionAlerts).toBe(false);
        });

        it('initializeTheme should load from localStorage', () => {
            localStorage.setItem('realyx-settings', JSON.stringify({
                state: { theme: 'light' }
            }));
            
            initializeTheme();
            expect(document.documentElement.classList.contains('light-theme')).toBe(true);
        });

        it('initializeTheme should default to dark if no storage', () => {
            initializeTheme();
            expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
        });
        
        it('initializeTheme should handle corrupt JSON', () => {
            localStorage.setItem('realyx-settings', 'invalid-json');
            initializeTheme();
            expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
        });
    });

    describe('useReferralStore', () => {
        it('should generate referral code from wallet address', () => {
            const { generateReferralCode } = useReferralStore.getState();
            generateReferralCode('0x1234567890ABCDEF1234567890ABCDEF12345678');
            
            const code = useReferralStore.getState().referralCode;
            expect(code).toBe('0X125678'); // Prefix+Suffix (first 4, last 4)
        });

        it('should apply referral code once', () => {
            const { applyReferralCode } = useReferralStore.getState();
            
            // Cannot apply own code
            useReferralStore.setState({ referralCode: 'MYCODE' });
            expect(applyReferralCode('MYCODE')).toBe(false);
            
            // Apply valid code
            expect(applyReferralCode('OTHER')).toBe(true);
            expect(useReferralStore.getState().usedReferralCode).toBe('OTHER');
            
            // Cannot apply again
            expect(applyReferralCode('ANOTHER')).toBe(false);
        });

        it('should calculate points and tiers correctly', () => {
            const { addTradingVolume } = useReferralStore.getState();
            
            // Bronze
            addTradingVolume(500);
            expect(useReferralStore.getState().stats.totalPoints).toBe(50);
            expect(useReferralStore.getState().stats.tier).toBe('bronze');
            
            // Silver (>= 1000 points)
            addTradingVolume(10000); // +1000 points
            expect(useReferralStore.getState().stats.tier).toBe('silver');
            
            // Gold (>= 10000 points)
            addTradingVolume(100000); // +10000 points
            expect(useReferralStore.getState().stats.tier).toBe('gold');
            
            // Platinum (>= 50000 points)
            addTradingVolume(400000); // +40000 points
            expect(useReferralStore.getState().stats.tier).toBe('platinum');
            
            // Diamond (>= 100000 points)
            addTradingVolume(500000); // +50000 points
            expect(useReferralStore.getState().stats.tier).toBe('diamond');
        });

        it('should add referral earnings', () => {
            const { addReferralEarning } = useReferralStore.getState();
            addReferralEarning(10.5);
            expect(useReferralStore.getState().stats.referralEarnings).toBe(10.5);
        });
    });
});
