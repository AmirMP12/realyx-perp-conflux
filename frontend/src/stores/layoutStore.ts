import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LayoutState {
  tradingFormWidth: number;
  setTradingFormWidth: (w: number) => void;
  chartHeight: number;
  setChartHeight: (h: number) => void;
  positionPanelHeight: number;
  setPositionPanelHeight: (h: number) => void;
  tradingFormCollapsed: boolean;
  setTradingFormCollapsed: (c: boolean) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      tradingFormWidth: 420,
      setTradingFormWidth: (tradingFormWidth) => set({ tradingFormWidth }),
      chartHeight: 500,
      setChartHeight: (chartHeight) => set({ chartHeight }),
      positionPanelHeight: 256,
      setPositionPanelHeight: (positionPanelHeight) => set({ positionPanelHeight }),
      tradingFormCollapsed: false,
      setTradingFormCollapsed: (tradingFormCollapsed) => set({ tradingFormCollapsed }),
    }),
    { name: 'realyx-layout' }
  )
);
