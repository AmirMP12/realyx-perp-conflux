import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { useAccount, useChainId } from 'wagmi';

vi.mock('../components/ProtocolStatsBar', () => ({ ProtocolStatsBar: () => <div /> }));
vi.mock('../components/OnboardingChecklist', () => ({ OnboardingChecklist: () => null }));
// App calls useWebSocket() on mount, which opens a real ws:// connection. Under
// jsdom + undici the connect event is dispatched with an undici Event that Node's
// EventTarget rejects (ERR_INVALID_ARG_TYPE), surfacing as out-of-band unhandled
// errors after the tests finish. Stub the hook out — the lazy-route assertions
// don't need a live socket.
vi.mock('../hooks/useWebSocket', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, useWebSocket: () => ({ connected: false, send: vi.fn() }) };
});
vi.mock('wagmi', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, useAccount: vi.fn(), useChainId: vi.fn(), useSwitchChain: vi.fn(() => ({ switchChain: vi.fn() })) };
});
vi.mock('react-hot-toast', () => {
    const fn: any = vi.fn();
    fn.dismiss = vi.fn();
    fn.error = vi.fn();
    return { default: fn };
});

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };

describe('App lazy routes', () => {
    // Provider-dependent pages (Settings/Vault/...) throw `WagmiProviderNotFoundError`
    // when rendered without a WagmiProvider; Layout's ErrorBoundary catches it (the
    // route still loads, which is what we assert). Swallow the expected console.error
    // and the jsdom error-event report so the run stays quiet.
    const swallowError = (e: ErrorEvent) => e.preventDefault();
    beforeAll(() => window.addEventListener('error', swallowError));
    afterAll(() => window.removeEventListener('error', swallowError));

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorage.setItem('realyx_risk_disclosure_seen', 'true');
        (useAccount as any).mockReturnValue({ isConnected: false });
        (useChainId as any).mockReturnValue(71);
        // Pages like TraderProfile fire a `fetch` on mount. Without a stub the
        // real Node/undici fetch attempts a live request that rejects after the
        // test finishes (surfacing as an out-of-band ERR_INVALID_ARG_TYPE).
        vi.stubGlobal('fetch', vi.fn(() =>
            Promise.resolve({ ok: false, status: 404, json: async () => ({}) }),
        ));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // Each route's lazy import resolves a `.then(m => ({ default: m.X }))` mapper;
    // awaiting the loader to disappear ensures those mapper functions execute.
    const routes = ['/leaderboard', '/status', '/referrals', '/', '/copy-trading', '/analytics', '/trade', '/portfolio', '/settings', '/insurance', '/vault', '/trader/0x1111111111111111111111111111111111111111'];

    for (const route of routes) {
        it(`loads the lazy component for ${route}`, async () => {
            render(
                <MemoryRouter initialEntries={[route]} future={routerFuture}>
                    <App />
                </MemoryRouter>,
            );
            await waitFor(() => expect(screen.queryByTestId('page-loader')).not.toBeInTheDocument(), { timeout: 15000 });
        });
    }
});
