import { describe, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Sidebar } from '../components/Sidebar';
import { MarketsPage } from '../pages/Markets';
import { TradingPage } from '../pages/Trading';
import { PortfolioPage } from '../pages/Portfolio';
import { VaultPage } from '../pages/Vault';
import { SettingsPage } from '../pages/Settings';

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

// Mock contract addresses
vi.mock('../contracts/index', () => ({
    getContractAddresses: () => ({
        tradingCore: '0x111',
        vaultCore: '0x222',
        oracleAggregator: '0x333',
        positionToken: '0x444',
    }),
    TRADING_CORE_ADDRESS: '0x111',
    VAULT_CORE_ADDRESS: '0x222',
    ORACLE_AGGREGATOR_ADDRESS: '0x333',
    POSITION_TOKEN_ADDRESS: '0x444',
    MOCK_USDC_ADDRESS: '0x555',
    TRADING_CORE_ABI: [],
    VAULT_ABI: [],
    ORACLE_ABI: [],
    POSITION_TOKEN_ABI: [],
}));

// Mock useProgram with all exports
vi.mock('../hooks/useProgram', () => ({
    TRADING_CORE_ADDRESS: '0x111',
    VAULT_CORE_ADDRESS: '0x222',
    ORACLE_AGGREGATOR_ADDRESS: '0x333',
    POSITION_TOKEN_ADDRESS: '0x444',
    MOCK_USDC_ADDRESS: '0x555',
    TRADING_CORE_ABI: [],
    ORACLE_ABI: [],
    VAULT_ABI: [],
    POSITION_TOKEN_ABI: [],
    OrderType: { MARKET_INCREASE: 0, MARKET_DECREASE: 1, LIMIT_INCREASE: 2, LIMIT_DECREASE: 3 },
    useUSDC: vi.fn(() => ({ address: '0x555' })),
    useUSDCBalance: vi.fn(() => ({ balance: 0, loading: false })),
    useCreateOrder: vi.fn(() => ({ createOrder: vi.fn(), isPending: false, minExecutionFeeWei: 0n })),
    useOpenPosition: vi.fn(() => ({ executePosition: vi.fn(), isLoading: false, step: 'IDLE' })),
    usePositions: vi.fn(() => ({ positions: [], loading: false, fetchPositions: vi.fn() })),
    useAddCollateral: vi.fn(() => ({ addCollateral: vi.fn() })),
    useClosePosition: vi.fn(() => ({ closePosition: vi.fn(), loading: false })),
    useModifyMargin: vi.fn(() => ({ modifyMargin: vi.fn(), loading: false })),
    useSetStopLoss: vi.fn(() => ({ setStopLoss: vi.fn(), loading: false })),
    useSetTakeProfit: vi.fn(() => ({ setTakeProfit: vi.fn(), loading: false })),
    useSetTrailingStop: vi.fn(() => ({ setTrailingStop: vi.fn(), loading: false })),
    usePartialClose: vi.fn(() => ({ partialClose: vi.fn(), loading: false })),
    useCancelOrder: vi.fn(() => ({ cancelOrder: vi.fn(), loading: false })),
    calculatePnL: vi.fn(() => ({ pnl: 0, pnlPercent: 0 })),
}));

vi.mock('../hooks/usePositions', () => ({
    usePositions: vi.fn(() => ({ positions: [], loading: false, refetch: vi.fn() })),
}));

vi.mock('../hooks/useOnChainHistory', () => ({
    useOnChainHistory: vi.fn(() => ({ data: [], isLoading: false, refetch: vi.fn() })),
}));

vi.mock('../hooks/usePendingOrders', () => ({
    usePendingOrders: vi.fn(() => ({ orders: [], loading: false, refetch: vi.fn() })),
    getOrderTypeLabel: vi.fn(),
}));

vi.mock('../stores', () => {
    const mockPositionsState = {
        optimisticPositions: [],
        addOptimisticPosition: vi.fn(),
        removePosition: vi.fn(),
    };
    const mockMarketsState = {
        markets: [{ symbol: 'BTC-USD', marketAddress: '0x111', image: '', indexPrice: 50000 }],
        favorites: [],
        toggleFavorite: vi.fn(),
        setMarkets: vi.fn(),
        loading: false,
    };
    const mockLayoutState = {
        positionPanelHeight: 300,
    };

    return {
        usePositionsStore: vi.fn((sel) => sel ? sel(mockPositionsState) : mockPositionsState),
        useMarketsStore: vi.fn((sel) => sel ? sel(mockMarketsState) : mockMarketsState),
        useLayoutStore: vi.fn((sel) => sel ? sel(mockLayoutState) : mockLayoutState),
    };
});

vi.mock('../hooks/useBackend', () => ({
    useMarkets: vi.fn(() => ({ loading: false, error: null, markets: [] })),
    useBackendStats: vi.fn(() => ({ stats: null, loading: false })),
    useTradeHistory: vi.fn(() => ({ trades: [], loading: false })),
}));

vi.mock('../hooks/useVault', () => ({
    useVaultStats: vi.fn(() => ({ stats: { tvl: 0, sharePrice: 1, userBalance: 0, availableLiquidity: 0, isPaused: false, asset: 'USDC' }, loading: false })),
    useVaultDeposit: vi.fn(() => ({ deposit: vi.fn(), loading: false })),
    useVaultWithdraw: vi.fn(() => ({ withdraw: vi.fn(), loading: false })),
    useInsuranceFund: vi.fn(() => ({ insuranceAssets: 0, healthRatioPercent: 0, isHealthy: true, userInsuranceBalance: 0, loading: false })),
    useStakeInsurance: vi.fn(() => ({ stake: vi.fn(), loading: false })),
    useUnstakeInsurance: vi.fn(() => ({ unstake: vi.fn(), loading: false })),
}));

vi.mock('../hooks/useMarketData', () => ({
    useSingleMarketData: vi.fn(() => ({ formatted: null, isLoading: false, refetch: vi.fn() })),
    useMarketData: vi.fn(() => ({ tvl: 0 })),
    useAllMarketsOnChainData: vi.fn(() => ({ data: {}, isLoading: false, refetch: vi.fn() })),
}));

vi.mock('../hooks/usePythPrice', () => ({
    usePythDisplayPrice: vi.fn(() => ({ price: null, loading: false })),
    getPythFeedId: vi.fn(),
}));

vi.mock('../hooks/useWebSocket', () => ({
    useLivePnL: vi.fn((p) => p),
}));

describe('Snapshot and Render Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders Navbar', () => {
        render(<MemoryRouter future={routerFuture}><Navbar /></MemoryRouter>);
    });

    it('renders Sidebar', () => {
        render(<MemoryRouter future={routerFuture}><Sidebar isMobileOpen={true} onClose={vi.fn()} /></MemoryRouter>);
    });

    it('renders Markets page', () => {
        render(<MemoryRouter future={routerFuture}><MarketsPage /></MemoryRouter>);
    });

    it('renders Trading page', () => {
        render(<MemoryRouter future={routerFuture}><TradingPage /></MemoryRouter>);
    });

    it('renders Portfolio page', () => {
        render(<MemoryRouter future={routerFuture}><PortfolioPage /></MemoryRouter>);
    });

    it('renders Vault page', () => {
        render(<MemoryRouter future={routerFuture}><VaultPage /></MemoryRouter>);
    });

    it('renders Settings page', () => {
        render(<MemoryRouter future={routerFuture}><SettingsPage /></MemoryRouter>);
    });
});
