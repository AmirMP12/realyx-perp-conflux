import { Routes, Route } from 'react-router-dom';
import { useEffect, Suspense, lazy } from 'react';
import toast from 'react-hot-toast';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { Layout } from './components/Layout';
import { useReferralUrl } from './hooks/useReferralUrl';
import { initializeTheme } from './stores/settingsStore';
import { useMarketsStore } from './stores';
import { useMarkets } from './hooks/useBackend';
import { useWebSocket } from './hooks/useWebSocket';
import { realyxChains } from './config/wagmi';

const MarketsPage = lazy(() => import('./pages/Markets').then(m => ({ default: m.MarketsPage })));
const TradingPage = lazy(() => import('./pages/Trading').then(m => ({ default: m.TradingPage })));
const PortfolioPage = lazy(() => import('./pages/Portfolio').then(m => ({ default: m.PortfolioPage })));

const SettingsPage = lazy(() => import('./pages/Settings').then(m => ({ default: m.SettingsPage })));
const InsurancePage = lazy(() => import('./pages/Insurance').then(m => ({ default: m.InsurancePage })));
const VaultPage = lazy(() => import('./pages/Vault').then(m => ({ default: m.VaultPage })));
const ReferralsPage = lazy(() => import('./pages/Referrals').then(m => ({ default: m.ReferralsPage })));
const LeaderboardPage = lazy(() => import('./pages/Leaderboard').then(m => ({ default: m.LeaderboardPage })));
const TraderProfilePage = lazy(() => import('./pages/TraderProfile').then(m => ({ default: m.TraderProfilePage })));
const CopyTradingPage = lazy(() => import('./pages/CopyTrading').then(m => ({ default: m.CopyTradingPage })));
const AnalyticsDashboard = lazy(() => import('./pages/Analytics'));
const StatusPage = lazy(() => import('./pages/Status').then(m => ({ default: m.StatusPage })));

export default function App() {
    useWebSocket(); // Connect WebSocket for live prices/stats
    useReferralUrl(); // Parse ?ref=CODE from URL and store for referral links
    const { isConnected } = useAccount();
    const chainId = useChainId();
    const { switchChain } = useSwitchChain();

    const defaultChainId = realyxChains[0].id;
    const isOnDefaultChain = chainId === defaultChainId;

    useEffect(() => {
        initializeTheme();
    }, []);

    useEffect(() => {
        const wrongNetworkToastId = 'network-default-warning';

        if (!isConnected || isOnDefaultChain) {
            toast.dismiss(wrongNetworkToastId);
            return;
        }

        // One-click switch instead of a dead-end "please switch" message.
        // wallet_switchEthereumChain (and add-chain fallback) is handled by wagmi.
        toast(
            (t) => (
                <div className="flex items-center gap-3">
                    <span className="text-sm">
                        Wrong network. Realyx runs on eSpace Testnet.
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            switchChain?.({ chainId: defaultChainId });
                            toast.dismiss(t.id);
                        }}
                        className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-semibold hover:opacity-90 transition-opacity"
                    >
                        Switch network
                    </button>
                </div>
            ),
            {
                id: wrongNetworkToastId,
                icon: '⚠️',
                duration: Infinity,
            }
        );
    }, [isConnected, isOnDefaultChain, switchChain, defaultChainId]);

    const { markets: backendMarkets } = useMarkets();
    const { setMarkets } = useMarketsStore();

    useEffect(() => {
        if (backendMarkets.length > 0) {
            const formattedMarkets = backendMarkets.map((m: any) => ({
                id: m.id,
                symbol: m.symbol,
                name: m.name,
                image: m.image || 'https://via.placeholder.com/48',
                description: `${m.name} / USD Perpetual`,
                oracleFeed: '0x...',
                marketAddress: m.marketAddress,
                category: (m.category || 'CRYPTO') as 'CRYPTO' | 'COMMODITY' | 'STOCK' | 'FOREX',
                isActive: !m.isPaused,
                indexPrice: parseFloat(m.indexPrice),
                change24h: m.change24h ?? 0,
                volume24h: parseFloat(m.volume24h),
                openInterest: parseFloat(m.longOI) + parseFloat(m.shortOI),
                longOI: parseFloat(m.longOI),
                shortOI: parseFloat(m.shortOI),
                fundingRate: parseFloat(m.fundingRate),
                lastUpdate: new Date().toISOString() // Updated on each poll so UI sees fresh data
            }));
            setMarkets(formattedMarkets);
        }
    }, [backendMarkets, setMarkets]);

    return (
        <Routes>
            <Route path="/" element={<Layout />}>
                <Route index element={<Suspense fallback={<PageLoader />}><MarketsPage /></Suspense>} />
                <Route path="/trade/:marketId?" element={<Suspense fallback={<PageLoader />}><TradingPage /></Suspense>} />
                <Route path="/portfolio" element={<Suspense fallback={<PageLoader />}><PortfolioPage /></Suspense>} />

                <Route path="/settings" element={<Suspense fallback={<PageLoader />}><SettingsPage /></Suspense>} />
                <Route path="/vault" element={<Suspense fallback={<PageLoader />}><VaultPage /></Suspense>} />
                <Route path="/insurance" element={<Suspense fallback={<PageLoader />}><InsurancePage /></Suspense>} />
                <Route path="/referrals" element={<Suspense fallback={<PageLoader />}><ReferralsPage /></Suspense>} />
                <Route path="/leaderboard" element={<Suspense fallback={<PageLoader />}><LeaderboardPage /></Suspense>} />
                <Route path="/copy-trading" element={<Suspense fallback={<PageLoader />}><CopyTradingPage /></Suspense>} />
                <Route path="/trader/:address" element={<Suspense fallback={<PageLoader />}><TraderProfilePage /></Suspense>} />
                <Route path="/analytics" element={<Suspense fallback={<PageLoader />}><AnalyticsDashboard /></Suspense>} />
                <Route path="/status" element={<Suspense fallback={<PageLoader />}><StatusPage /></Suspense>} />
            </Route>
        </Routes>
    );
}

function PageLoader() {
    return (
        <div className="flex items-center justify-center min-h-[40vh]" aria-busy="true" data-testid="page-loader">
            <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
        </div>
    );
}
