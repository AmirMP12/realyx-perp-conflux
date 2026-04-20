import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Minimal setup to isolate the hang
vi.stubEnv('VITE_TRADING_CORE_ADDRESS', '0x111');
vi.stubEnv('VITE_VAULT_CORE_ADDRESS', '0x222');
vi.stubEnv('VITE_ORACLE_AGGREGATOR_ADDRESS', '0x333');
vi.stubEnv('VITE_POSITION_TOKEN_ADDRESS', '0x444');
vi.stubEnv('VITE_MOCK_USDC_ADDRESS', '0x555');

// Mock wagmi
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({ address: '0x123', isConnected: true, chainId: 1 })),
  useChainId: vi.fn(() => 1),
  useConfig: vi.fn(() => ({})),
  useReadContract: vi.fn(() => ({ data: null, isLoading: false, refetch: vi.fn() })),
  useReadContracts: vi.fn(() => ({ data: null, isLoading: false, refetch: vi.fn() })),
  useWriteContract: vi.fn(() => ({ writeContractAsync: vi.fn(), isPending: false })),
  usePublicClient: vi.fn(() => ({ 
    readContract: vi.fn().mockResolvedValue(undefined),
    simulateContract: vi.fn().mockImplementation((args: any) => Promise.resolve({ request: args })),
    getCode: vi.fn().mockResolvedValue('0x'),
    getLogs: vi.fn().mockResolvedValue([]),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' })
  })),
  useConnect: vi.fn(() => ({ connect: vi.fn(), connectors: [] })),
  useDisconnect: vi.fn(() => ({ disconnect: vi.fn() })),
  useSwitchChain: vi.fn(() => ({ switchChain: vi.fn() })),
  useWatchContractEvent: vi.fn(),
  createConfig: vi.fn(() => ({})),
  http: vi.fn(),
}));

// Mock toast
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn(), custom: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn(), custom: vi.fn() }
}));

// Mock UI libraries with simple but functional replacements
vi.mock('framer-motion', () => {
    const React = require('react');
    const cache: Record<string, any> = {};
    
    const motion = new Proxy({}, { 
        get: (_target, tag: string) => {
            if (!cache[tag]) {
                const MotionComponent = React.forwardRef((props: any, ref: any) => {
                    const { 
                        layoutId, layout, initial, animate, exit, transition, variants, 
                        whileHover, whileTap, whileFocus, whileDrag, whileInView,
                        viewport, onAnimationStart, onAnimationComplete, onUpdate,
                        drag, dragControls, dragListener, dragConstraints,
                        ...filteredProps 
                    } = props;
                    
                    // Filter any remaining while* props
                    const cleanProps: any = {};
                    for (const key in filteredProps) {
                        if (!key.startsWith('while')) {
                            cleanProps[key] = filteredProps[key];
                        }
                    }

                    return React.createElement(tag, { ...cleanProps, ref });
                });
                MotionComponent.displayName = `motion.${tag}`;
                cache[tag] = MotionComponent;
            }
            return cache[tag];
        } 
    });

    return {
        motion,
        AnimatePresence: ({ children }: any) => children,
        useMotionValue: (initial: any) => ({ get: () => initial, set: vi.fn(), onChange: vi.fn() }),
        useSpring: (initial: any) => ({ 
            get: () => typeof initial === 'object' && initial !== null && 'get' in initial ? initial.get() : initial, 
            set: vi.fn(),
            onChange: vi.fn()
        }),
        useTransform: (mv: any, transformer: any) => {
            const val = typeof mv === 'object' && mv !== null && 'get' in mv ? mv.get() : mv;
            return transformer(val);
        },
        useInView: () => true,
        useScroll: () => ({ scrollYProgress: { get: () => 0 } }),
    };
});

vi.mock('lucide-react', () => {
    const React = require('react');
    const MockIcon = (name: string) => {
        const component = (props: any) => React.createElement('svg', { ...props, 'data-testid': `icon-${name}` });
        component.displayName = name;
        return component;
    };
    
    return {
        __esModule: true,
        ChevronDown: MockIcon('ChevronDown'),
        ChevronUp: MockIcon('ChevronUp'),
        Menu: MockIcon('Menu'),
        X: MockIcon('X'),
        Bell: MockIcon('Bell'),
        LayoutGrid: MockIcon('LayoutGrid'),
        LayoutDashboard: MockIcon('LayoutDashboard'),
        History: MockIcon('History'),
        BarChart2: MockIcon('BarChart2'),
        Settings: MockIcon('Settings'),
        LogOut: MockIcon('LogOut'),
        Copy: MockIcon('Copy'),
        ExternalLink: MockIcon('ExternalLink'),
        Wallet: MockIcon('Wallet'),
        ArrowUpRight: MockIcon('ArrowUpRight'),
        TrendingUp: MockIcon('TrendingUp'),
        TrendingDown: MockIcon('TrendingDown'),
        Info: MockIcon('Info'),
        AlertCircle: MockIcon('AlertCircle'),
        CheckCircle: MockIcon('CheckCircle'),
        CheckCircle2: MockIcon('CheckCircle2'),
        Search: MockIcon('Search'),
        Filter: MockIcon('Filter'),
        ArrowLeft: MockIcon('ArrowLeft'),
        ArrowRight: MockIcon('ArrowRight'),
        LineChart: MockIcon('LineChart'),
        Shield: MockIcon('Shield'),
        Trophy: MockIcon('Trophy'),
        Share2: MockIcon('Share2'),
        PieChart: MockIcon('PieChart'),
        HelpCircle: MockIcon('HelpCircle'),
        Edit2: MockIcon('Edit2'),
        Clock: MockIcon('Clock'),
        FileText: MockIcon('FileText'),
        ArrowRightLeft: MockIcon('ArrowRightLeft'),
        Loader2: MockIcon('Loader2'),
        Minus: MockIcon('Minus'),
        Plus: MockIcon('Plus'),
        ArrowUp: MockIcon('ArrowUp'),
        ArrowDown: MockIcon('ArrowDown'),
        User: MockIcon('User'),
        Lock: MockIcon('Lock'),
        Zap: MockIcon('Zap'),
        Eye: MockIcon('Eye'),
        EyeOff: MockIcon('EyeOff'),
        Sliders: MockIcon('Sliders'),
        Monitor: MockIcon('Monitor'),
        Moon: MockIcon('Moon'),
        Sun: MockIcon('Sun'),
        Check: MockIcon('Check'),
        AlertTriangle: MockIcon('AlertTriangle'),
        Globe: MockIcon('Globe'),
        ChevronRight: MockIcon('ChevronRight'),
        DollarSign: MockIcon('DollarSign'),
        Radio: MockIcon('Radio'),
        Star: MockIcon('Star'),
        ArrowDownUp: MockIcon('ArrowDownUp'),
        Sparkles: MockIcon('Sparkles'),
        Activity: MockIcon('Activity'),
        Medal: MockIcon('Medal'),
        Gift: MockIcon('Gift'),
        Users: MockIcon('Users'),
        Wifi: MockIcon('Wifi'),
        WifiOff: MockIcon('WifiOff'),
        CandlestickChart: MockIcon('CandlestickChart'),
        RefreshCw: MockIcon('RefreshCw'),
        Coins: MockIcon('Coins'),
    };
});

vi.mock('@rainbow-me/rainbowkit', () => {
    const React = require('react');
    const ConnectButton = (props: any) => {
        // Filter out non-DOM props to avoid React warnings
        const { chainStatus, accountStatus, showBalance, label, ...rest } = props;
        return React.createElement('div', { 'data-testid': 'connect-button', ...rest });
    };
    ConnectButton.Custom = ({ children }: any) => children({
        account: { address: '0x123', displayName: '0x123', ensAvatar: null, ensName: null },
        chain: { id: 1, name: 'Ethereum' },
        mounted: true,
        authenticationStatus: 'authenticated',
        openAccountModal: vi.fn(),
        openChainModal: vi.fn(),
        openConnectModal: vi.fn(),
    });
    return {
        ConnectButton,
        connectorsForWallets: vi.fn(() => []),
        RainbowKitProvider: ({ children }: any) => children,
        darkTheme: vi.fn(),
        lightTheme: vi.fn(),
    };
});

vi.mock('@rainbow-me/rainbowkit/wallets', () => ({
    injectedWallet: vi.fn(),
    metaMaskWallet: vi.fn(),
    coinbaseWallet: vi.fn(),
    rabbyWallet: vi.fn(),
    trustWallet: vi.fn(),
    ledgerWallet: vi.fn(),
    phantomWallet: vi.fn(),
    okxWallet: vi.fn(),
    walletConnectWallet: vi.fn(),
}));

vi.mock('recharts', () => {
    const React = require('react');
    const Mock = ({ children }: any) => React.createElement('div', {}, children);
    const MockSVG = ({ children }: any) => React.createElement('svg', {}, children);
    return {
        ResponsiveContainer: Mock, AreaChart: MockSVG, Area: Mock, XAxis: Mock, YAxis: Mock,
        CartesianGrid: Mock, Tooltip: Mock, BarChart: MockSVG, Bar: Mock, LineChart: MockSVG,
        Line: Mock, PieChart: MockSVG, Pie: Mock, Cell: Mock,
        // Mock SVG components used in charts to avoid unknown tag warnings
        linearGradient: Mock, stop: Mock, defs: Mock,
    };
});

vi.mock('@tanstack/react-query', () => {
    const React = require('react');
    return {
        useQuery: vi.fn(() => ({ data: undefined, isLoading: false, refetch: vi.fn() })),
        useMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
        useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn(), getQueryData: vi.fn(), setQueryData: vi.fn() })),
        QueryClientProvider: ({ children }: any) => children,
        QueryClient: vi.fn(() => ({ setDefaultOptions: vi.fn() })),
    };
});
