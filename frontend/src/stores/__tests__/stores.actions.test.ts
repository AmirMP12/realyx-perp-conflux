import { describe, it, expect, beforeEach } from 'vitest';
import { useMarketsStore, usePositionsStore, useStatsStore } from '../index';
import { useMarketStore } from '../marketStore';
import { useSettingsStore, useReferralStore, initializeTheme } from '../settingsStore';

describe('stores/index gaps', () => {
    it('toggles favorites on and off', () => {
        const { toggleFavorite } = useMarketsStore.getState();
        toggleFavorite('FAVX');
        expect(useMarketsStore.getState().favorites).toContain('FAVX');
        toggleFavorite('FAVX');
        expect(useMarketsStore.getState().favorites).not.toContain('FAVX');
    });

    it('updates markets by id and address', () => {
        useMarketsStore.getState().setMarkets([{ id: 'm1', marketAddress: '0xAa' } as any]);
        useMarketsStore.getState().updateMarket('m1', { name: 'X' } as any);
        expect(useMarketsStore.getState().markets[0].name).toBe('X');
        useMarketsStore.getState().updateMarketByAddress('0xaa', { symbol: 'Y' } as any);
        expect(useMarketsStore.getState().markets[0].symbol).toBe('Y');
        useMarketsStore.getState().setLoading(true);
        useMarketsStore.getState().setError('err');
        expect(useMarketsStore.getState().error).toBe('err');
    });

    it('manages positions and optimistic positions', () => {
        const s = usePositionsStore.getState();
        s.setPositions([{ id: '1' } as any]);
        s.addPosition({ id: '2' } as any);
        expect(usePositionsStore.getState().positions).toHaveLength(2);
        s.updatePosition('1', { pnl: '5' } as any);
        s.removePosition('2');
        expect(usePositionsStore.getState().positions).toHaveLength(1);
        s.addOptimisticPosition({ tempId: 'opt-1' } as any);
        expect(usePositionsStore.getState().optimisticPositions).toHaveLength(1);
        s.removeOptimisticPosition('opt-1');
        expect(usePositionsStore.getState().optimisticPositions).toHaveLength(0);
    });

    it('merges protocol stats', () => {
        useStatsStore.getState().setStats({ tvl: 100 });
        expect(useStatsStore.getState().stats.tvl).toBe(100);
    });
});

describe('marketStore gaps', () => {
    it('selects, finds by id/symbol, and toggles favorites', () => {
        useMarketStore.getState().setMarkets([{ id: 'btc', symbol: 'BTC-USD' } as any]);
        useMarketStore.getState().selectMarket('btc');
        expect(useMarketStore.getState().selectedMarketId).toBe('btc');
        expect(useMarketStore.getState().getMarketById('BTC-USD')?.id).toBe('btc');
        useMarketStore.getState().toggleFavorite('btc');
        expect(useMarketStore.getState().favorites).toContain('btc');
        useMarketStore.getState().toggleFavorite('btc');
        expect(useMarketStore.getState().favorites).not.toContain('btc');
    });
});

describe('settingsStore gaps', () => {
    beforeEach(() => {
        useSettingsStore.setState({ theme: 'dark' });
    });

    it('exercises every setter and toggleTheme', () => {
        const s = useSettingsStore.getState();
        s.setTheme('light');
        expect(document.documentElement.classList.contains('light-theme')).toBe(true);
        s.toggleTheme();
        s.setDefaultLeverage(7);
        s.setMaxSlippage(1);
        s.setConfirmTrades(false);
        s.setAutoCloseOnLiquidation(false);
        s.setDefaultOrderType('limit');
        s.setPositionAlerts(false);
        s.setPriceAlerts(false);
        s.setLiquidationWarnings(false);
        s.setFundingReminders(false);
        s.setRequireConfirmation(false);
        s.setTwoFactorEnabled(true);
        s.setWhitelistAddresses(true);
        s.setCompactMode(true);
        s.setShowPnlPercent(false);
        const st = useSettingsStore.getState();
        expect(st.defaultLeverage).toBe(7);
        expect(st.twoFactorEnabled).toBe(true);
    });

    it('initializeTheme reads persisted settings', () => {
        localStorage.setItem('realyx-settings', JSON.stringify({ state: { theme: 'light' } }));
        initializeTheme();
        expect(document.documentElement.classList.contains('light-theme')).toBe(true);
        localStorage.setItem('realyx-settings', 'not json');
        initializeTheme();
        localStorage.removeItem('realyx-settings');
        initializeTheme();
        expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
    });
});

describe('referralStore gaps', () => {
    it('generates code, applies codes, and accrues volume/earnings/tiers', () => {
        const s = useReferralStore.getState();
        s.generateReferralCode('0x1234567890abcdef1234567890abcdef12345678');
        const code = useReferralStore.getState().referralCode!;
        expect(code).toMatch(/^0X12/);
        // applying own code fails
        expect(useReferralStore.getState().applyReferralCode(code)).toBe(false);
        expect(useReferralStore.getState().applyReferralCode('OTHERCODE')).toBe(true);
        // applying again when one is used fails
        expect(useReferralStore.getState().applyReferralCode('ANOTHER')).toBe(false);
        useReferralStore.getState().addTradingVolume(1_000_000); // 100k points -> diamond
        expect(useReferralStore.getState().stats.tier).toBe('diamond');
        useReferralStore.getState().addReferralEarning(50);
        expect(useReferralStore.getState().stats.referralEarnings).toBe(50);
    });
});
