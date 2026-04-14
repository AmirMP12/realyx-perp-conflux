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
                <div className="absolute inset-0 z-[-1] pointer-events-none opacity-60 [background:radial-gradient(720px_340px_at_0%_0%,rgba(45,66,252,0.12),transparent_60%),radial-gradient(620px_300px_at_100%_0%,rgba(56,189,248,0.08),transparent_58%)]" />

                <main id="main-content" className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5 lg:px-8 lg:py-7 pb-[84px] lg:pb-10 scroll-smooth no-scrollbar min-w-0" role="main" aria-label="Main content">
                    <div className="max-w-[1760px] mx-auto w-full animate-fade-in">
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
