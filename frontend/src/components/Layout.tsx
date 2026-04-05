import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { MobileNav } from './layout/MobileNav';
import { OfflineBanner } from './OfflineBanner';
import { RiskDisclosureModal } from './trading/RiskDisclosureModal';
import ErrorBoundary from './ErrorBoundary';

export function Layout() {
    return (
        <div className="min-h-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
            <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-[var(--primary)] focus:text-white focus:rounded-lg">
                Skip to main content
            </a>
            <Navbar />
            <OfflineBanner />
            <div className="flex flex-1 overflow-hidden relative">
                <div className="absolute inset-0 bg-[var(--bg-primary)] z-[-1]" />

                <main id="main-content" className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:p-8 pb-[80px] lg:pb-8 scroll-smooth no-scrollbar min-w-0" role="main" aria-label="Main content">
                    <div className="max-w-[1920px] mx-auto w-full animate-fade-in">
                        <ErrorBoundary>
                            <Outlet />
                        </ErrorBoundary>
                    </div>
                </main>
            </div>
            <MobileNav />
            <RiskDisclosureModal />
        </div>
    );
}
