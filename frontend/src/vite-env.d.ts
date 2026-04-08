/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL: string;
    readonly VITE_WS_URL: string;
    readonly VITE_PROGRAM_ID: string;
    readonly VITE_RPC_ENDPOINT: string;
    readonly VITE_RPC_URL?: string;
    readonly VITE_CONFLUX_TESTNET_RPC_URL?: string;
    readonly VITE_WALLET_CONNECT_PROJECT_ID?: string;
    readonly VITE_APP_URL?: string;
    // Add more env variables as needed
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
