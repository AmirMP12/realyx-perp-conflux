import '@rainbow-me/rainbowkit/styles.css';
import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { RainbowKitWalletConnectParameters } from '@rainbow-me/rainbowkit';
import { createConfig, http } from 'wagmi';
import { confluxESpace, confluxESpaceTestnet } from 'wagmi/chains';

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

const testnetRpc =
    import.meta.env.VITE_CONFLUX_TESTNET_RPC_URL ||
    import.meta.env.VITE_RPC_URL ||
    'https://evmtestnet.confluxrpc.com';

const appUrl =
    (import.meta.env.VITE_APP_URL as string | undefined) ||
    (typeof window !== 'undefined' ? window.location.origin : '') ||
    'https://realyx.xyz';
const appIcon = `${appUrl.replace(/\/$/, '')}/tr-512.png`;
const walletConnectParameters: RainbowKitWalletConnectParameters | undefined = {
    metadata: {
        name: 'Realyx',
        description: 'RWA Perpetuals – Long or short with up to 10x leverage',
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
        appDescription: 'RWA Perpetuals – Long or short with up to 10x leverage',
        appUrl,
        appIcon,
        walletConnectParameters,
    }
);

export const config = createConfig({
    connectors,
    chains: [confluxESpace, confluxESpaceTestnet],
    transports: {
        [confluxESpace.id]: http(undefined, {
            // Keep mainnet reads resilient against temporary provider slowness.
            timeout: 120_000,
            retryCount: 5,
            retryDelay: 1_000,
        }),
        [confluxESpaceTestnet.id]: http(testnetRpc, {
            batch: false,
            // Increase timeout significantly to reduce RPC timeout failures.
            timeout: 180_000,
            retryCount: 8,
            retryDelay: 1_500,
        }),
    },
    ssr: false,
});
