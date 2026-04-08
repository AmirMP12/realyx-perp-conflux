import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Stub environment variables BEFORE any imports
vi.stubEnv('VITE_TRADING_CORE_ADDRESS', '0x111');
vi.stubEnv('VITE_VAULT_CORE_ADDRESS', '0x222');
vi.stubEnv('VITE_ORACLE_AGGREGATOR_ADDRESS', '0x333');
vi.stubEnv('VITE_POSITION_TOKEN_ADDRESS', '0x444');
vi.stubEnv('VITE_MOCK_USDC_ADDRESS', '0x555');

// Mock MatchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
window.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
window.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock react-hot-toast with full API
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    custom: vi.fn(),
  }),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    custom: vi.fn(),
  })
}));

// Mock wagmi with all commonly used hooks
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({ address: '0x123', isConnected: true })),
  useChainId: vi.fn(() => 1),
  useConfig: vi.fn(() => ({})),
  useReadContract: vi.fn(() => ({ data: null, isLoading: false, refetch: vi.fn() })),
  useReadContracts: vi.fn(() => ({ data: null, isLoading: false, refetch: vi.fn() })),
  useWriteContract: vi.fn(() => ({ writeContractAsync: vi.fn(), isPending: false })),
  usePublicClient: vi.fn(() => ({ readContract: vi.fn() })),
  useConnect: vi.fn(() => ({ connect: vi.fn(), connectors: [] })),
  useDisconnect: vi.fn(() => ({ disconnect: vi.fn() })),
  useSwitchChain: vi.fn(() => ({ switchChain: vi.fn() })),
  useWatchContractEvent: vi.fn(),
}));

// Mock RainbowKit
vi.mock('@rainbow-me/rainbowkit', () => {
  const MockConnectButton = (_props: any) => null;
  MockConnectButton.Custom = ({ children }: any) => children({
    openConnectModal: vi.fn(),
    openChainModal: vi.fn(),
    openAccountModal: vi.fn(),
    mounted: true,
  });
  return {
    ConnectButton: MockConnectButton,
  };
});

// Mock Framer Motion
vi.mock('framer-motion', async (_importOriginal) => {
    const React = await import('react');
    const createMotionComponent = (tag: string) => {
        return ({
            children,
            initial: _initial,
            animate: _animate,
            exit: _exit,
            transition: _transition,
            whileHover: _whileHover,
            whileTap: _whileTap,
            layout: _layout,
            layoutId: _layoutId,
            variants: _variants,
            viewport: _viewport,
            ...props
        }: any) => React.createElement(tag, props, children);
    };

    const mockMotionValue = (initial: any) => ({
        get: () => initial,
        set: vi.fn(),
        onChange: vi.fn(),
    });

    return {
        motion: {
            div: createMotionComponent('div'),
            button: createMotionComponent('button'),
            aside: createMotionComponent('aside'),
            span: createMotionComponent('span'),
            h2: createMotionComponent('h2'),
            p: createMotionComponent('p'),
            nav: createMotionComponent('nav'),
            ul: createMotionComponent('ul'),
            li: createMotionComponent('li'),
            a: createMotionComponent('a'),
        },
        AnimatePresence: ({ children }: any) => children,
        useSpring: (initial: any) => mockMotionValue(initial),
        useTransform: (mv: any, transformer: any) => transformer(mv.get()),
        useInView: () => true,
        useScroll: () => ({ scrollYProgress: mockMotionValue(0) }),
    };
});

// Mock viem logic
vi.mock('viem', async () => {
    const actual = await vi.importActual('viem');
    return {
        ...actual,
    };
});
