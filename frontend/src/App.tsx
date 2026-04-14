import { Routes, Route } from 'react-router-dom';
import { useEffect, Suspense, lazy } from 'react';
import toast from 'react-hot-toast';
import { useAccount, useChainId } from 'wagmi';
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
const AnalyticsDashboard = lazy(() => import('./pages/Analytics'));

export default function App() {
    useWebSocket(); // Connect WebSocket for live prices/stats
    useReferralUrl(); // Parse ?ref=CODE from URL and store for referral links
    const { isConnected } = useAccount();
    const chainId = useChainId();

    const defaultChainId = realyxChains[1].id;
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

        toast.error('Realyx default network is eSpace Testnet. Please switch back to eSpace Testnet.', {
            id: wrongNetworkToastId,
            duration: 8000,
        });
    }, [isConnected, isOnDefaultChain]);

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
                <Route path="/analytics" element={<Suspense fallback={<PageLoader />}><AnalyticsDashboard /></Suspense>} />
            </Route>
        </Routes>
    );
}

function PageLoader() {
    return (
        <div className="flex items-center justify-center min-h-[40vh]" aria-busy="true">
            <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
        </div>
    );
}
