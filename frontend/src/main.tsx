import './polyfills';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { config } from './config/wagmi';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000, // 30s default so pages share cached data
        },
    },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <WagmiProvider config={config}>
                <QueryClientProvider client={queryClient}>
                    <RainbowKitProvider
                        theme={darkTheme()}
                        modalSize="compact"
                        appInfo={{
                            appName: 'Realyx',
                            learnMoreUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
                        }}
                    >
                        <BrowserRouter>
                            <App />
                            <Toaster
                                position="bottom-right"
                                toastOptions={{
                                    className: 'glass-card !bg-dark-200 !text-white',
                                    duration: 4000,
                                    style: {
                                        background: 'var(--bg-secondary, #1a2332)',
                                        color: 'var(--text-primary, #fff)',
                                        border: '1px solid var(--border-color, #1e293b)',
                                    },
                                }}
                            />
                        </BrowserRouter>
                    </RainbowKitProvider>
                </QueryClientProvider>
            </WagmiProvider>
        </ErrorBoundary>
    </React.StrictMode>
);
