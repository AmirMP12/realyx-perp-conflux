import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore } from '../layoutStore';

describe('layoutStore', () => {
    beforeEach(() => {
        useLayoutStore.setState(useLayoutStore.getInitialState());
        localStorage.clear();
    });

    it('should have initial values', () => {
        const state = useLayoutStore.getState();
        expect(state.tradingFormWidth).toBe(420);
        expect(state.chartHeight).toBe(500);
        expect(state.positionPanelHeight).toBe(256);
        expect(state.tradingFormCollapsed).toBe(false);
    });

    it('should update trading form width', () => {
        const { setTradingFormWidth } = useLayoutStore.getState();
        setTradingFormWidth(500);
        expect(useLayoutStore.getState().tradingFormWidth).toBe(500);
    });

    it('should update chart height', () => {
        const { setChartHeight } = useLayoutStore.getState();
        setChartHeight(600);
        expect(useLayoutStore.getState().chartHeight).toBe(600);
    });

    it('should update position panel height', () => {
        const { setPositionPanelHeight } = useLayoutStore.getState();
        setPositionPanelHeight(300);
        expect(useLayoutStore.getState().positionPanelHeight).toBe(300);
    });

    it('should update trading form collapsed state', () => {
        const { setTradingFormCollapsed } = useLayoutStore.getState();
        setTradingFormCollapsed(true);
        expect(useLayoutStore.getState().tradingFormCollapsed).toBe(true);
    });
});
