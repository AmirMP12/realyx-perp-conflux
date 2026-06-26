import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    server: {
        host: '0.0.0.0', // Listen on all network interfaces
        port: 3000, // Use different port to avoid reserved ports
        strictPort: false,
        hmr: {
            host: 'localhost',
            protocol: 'ws',
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    optimizeDeps: {
        include: ['eventemitter3', 'recharts'],
    },
    build: {
        target: 'esnext',
        // Surface oversized chunks in CI rather than silently shipping them.
        chunkSizeWarningLimit: 700,
        rollupOptions: {
            output: {
                // Split the heaviest, rarely-changing vendor groups into their own
                // chunks so a perp trader's first paint isn't blocked behind the
                // full wallet-connector + charting payload. These are loaded in
                // parallel and cached independently across deploys.
                manualChunks: {
                    // Charting libs — only needed on the trade/markets views.
                    charts: ['lightweight-charts', 'recharts'],
                    // Wallet connectors are the single biggest dependency group
                    // (RainbowKit + MetaMask/Coinbase SDKs + WalletConnect/Reown).
                    wallet: [
                        '@rainbow-me/rainbowkit',
                        '@metamask/sdk',
                        '@coinbase/wallet-sdk',
                    ],
                    // Core web3 runtime shared by every route.
                    web3: ['wagmi', 'viem', '@tanstack/react-query'],
                    // React core.
                    'react-vendor': ['react', 'react-dom', 'react-router-dom'],
                },
            },
        },
    },
});
