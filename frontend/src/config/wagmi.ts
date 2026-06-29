import '@rainbow-me/rainbowkit/styles.css';
import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { RainbowKitWalletConnectParameters } from '@rainbow-me/rainbowkit';
import { createConfig, http } from 'wagmi';
import { fallback } from 'viem';
import { confluxESpaceTestnet } from 'wagmi/chains';

import {
    injectedWallet,
    metaMaskWallet,
    coinbaseWallet,
    rabbyWallet,
    trustWallet,
    ledgerWallet,
    phantomWallet,
    okxWallet,
    walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';

const projectId =
    (import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID ?? '').trim() ||
    '22f3b7d1ff53de2ac7f609d0b94694b1';

if (import.meta.env.DEV && !import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID) {
    console.warn(
        '[Realyx] Set VITE_WALLET_CONNECT_PROJECT_ID in .env (https://cloud.walletconnect.com) for WalletConnect, Trust, Ledger, OKX.'
    );
}

const testnetRpcPrimary =
    import.meta.env.VITE_CONFLUX_TESTNET_RPC_URL ||
    import.meta.env.VITE_RPC_URL ||
    'https://evmtestnet.confluxrpc.com';
const testnetRpcFallback = 'https://evmtestnet.confluxrpc.org';

const appUrl =
    (import.meta.env.VITE_APP_URL as string | undefined) ||
    (typeof window !== 'undefined' ? window.location.origin : '') ||
    'https://app.realyx.xyz';
const appIcon = `${appUrl.replace(/\/$/, '')}/favicon.png`;
const walletConnectParameters: RainbowKitWalletConnectParameters | undefined = {
    metadata: {
        name: 'Realyx',
        description: 'RWA Perpetuals – Long or short with up to 100x leverage',
        url: appUrl,
        icons: [appIcon],
    },
};

const connectors = connectorsForWallets(
    [
        {
            groupName: 'Recommended',
            wallets: [
                injectedWallet,
                metaMaskWallet,
                rabbyWallet,
                phantomWallet,
                walletConnectWallet,
            ],
        },
        {
            groupName: 'Others',
            wallets: [coinbaseWallet, trustWallet, ledgerWallet, okxWallet],
        },
    ],
    {
        appName: 'Realyx',
        projectId,
        appDescription: 'RWA Perpetuals – Long or short with up to 100x leverage',
        appUrl,
        appIcon,
        walletConnectParameters,
    }
);

// RainbowKit's "Switch Networks" modal uses `chain.name` for display.
export const realyxChains = [
    {
        ...confluxESpaceTestnet,
        name: 'eSpace Testnet',
    },
] as const;

export const config = createConfig({
    connectors,
    chains: realyxChains,
    transports: {
        // `fallback` with `rank` enabled periodically measures each endpoint's
        // latency/health and routes to the best one. This is what saves us when
        // a public Conflux RPC goes dark: instead of hanging on a dead primary,
        // viem deprioritizes it within seconds and uses a healthy node.
        //
        // Timeouts are kept short on purpose. A long per-request timeout (the
        // old config used 180s with 8 retries) makes a single unresponsive node
        // freeze every read — that's exactly what left the Portfolio stuck on
        // loading skeletons, since it reads positions/PnL straight over RPC.
        [confluxESpaceTestnet.id]: fallback(
            [
                http(testnetRpcPrimary, {
                    batch: false,
                    timeout: 12_000,
                    retryCount: 2,
                    retryDelay: 1_000,
                }),
                http(testnetRpcFallback, {
                    batch: false,
                    timeout: 12_000,
                    retryCount: 2,
                    retryDelay: 1_000,
                }),
            ],
            {
                rank: {
                    interval: 10_000,
                    sampleCount: 3,
                    timeout: 3_000,
                },
                retryCount: 2,
            }
        ),
    },
    ssr: false,
});
