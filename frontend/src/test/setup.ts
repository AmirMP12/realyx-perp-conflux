import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';
import React from 'react';

// Keep the test terminal clean. Many hooks/components intentionally
// `console.error`/`console.warn` inside catch blocks before surfacing a toast or
// returning a fallback; those expected logs would otherwise spam the run output.
// They're kept as spies (not removed) so tests can still assert they were called.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// Minimal setup to isolate the hang
vi.stubEnv('VITE_TRADING_CORE_ADDRESS', '0x111');
vi.stubEnv('VITE_VAULT_CORE_ADDRESS', '0x222');
vi.stubEnv('VITE_ORACLE_AGGREGATOR_ADDRESS', '0x333');
vi.stubEnv('VITE_POSITION_TOKEN_ADDRESS', '0x444');
vi.stubEnv('VITE_MOCK_USDT0_ADDRESS', '0x555');

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
    const cache: Record<string, any> = {};
    
    const motion = new Proxy({}, { 
        get: (_target, tag: string) => {
            if (!cache[tag]) {
                const MotionComponent = React.forwardRef((props: any, ref: any) => {
                    const { 
                        layoutId: _layoutId, layout: _layout, initial: _initial, animate: _animate, exit: _exit, transition: _transition, variants: _variants, 
                        whileHover: _whileHover, whileTap: _whileTap, whileFocus: _whileFocus, whileDrag: _whileDrag, whileInView: _whileInView,
                        viewport: _viewport, onAnimationStart: _onAnimationStart, onAnimationComplete: _onAnimationComplete, onUpdate: _onUpdate,
                        drag: _drag, dragControls: _dragControls, dragListener: _dragListener, dragConstraints: _dragConstraints,
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
    const MockIcon = (name: string) => {
        const component = (props: any) => React.createElement('svg', { ...props, 'data-testid': `icon-${name}` });
        component.displayName = name;
        return component;
    };

    // Use a Proxy so any icon imported from lucide-react resolves to a mock
    // component on demand. This keeps the mock from breaking whenever new
    // icons are introduced in the UI (no manual allowlist to maintain).
    const cache = new Map<string, ReturnType<typeof MockIcon>>();
    // Props that must NOT resolve to a component: module interop / thenable
    // checks performed by the test runner during (dynamic) import.
    const reserved = new Set(['then', 'default', '__esModule', '$$typeof']);

    const resolve = (prop: string) => {
        if (!cache.has(prop)) cache.set(prop, MockIcon(prop));
        return cache.get(prop);
    };

    return new Proxy(
        { __esModule: true },
        {
            get(target: any, prop: string | symbol) {
                if (prop === '__esModule') return true;
                if (typeof prop !== 'string' || reserved.has(prop)) return target[prop];
                return resolve(prop);
            },
            has(_target, prop: string | symbol) {
                if (typeof prop !== 'string' || reserved.has(prop)) return false;
                return true;
            },
        },
    );
});

vi.mock('@rainbow-me/rainbowkit', () => {
    const ConnectButton = (props: any) => {
        // Filter out non-DOM props to avoid React warnings
        const { chainStatus: _chainStatus, accountStatus: _accountStatus, showBalance: _showBalance, label: _label, ...rest } = props;
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
    return {
        useQuery: vi.fn(() => ({ data: undefined, isLoading: false, refetch: vi.fn() })),
        useMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
        useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn(), getQueryData: vi.fn(), setQueryData: vi.fn() })),
        QueryClientProvider: ({ children }: any) => children,
        QueryClient: vi.fn(() => ({ setDefaultOptions: vi.fn() })),
    };
});
