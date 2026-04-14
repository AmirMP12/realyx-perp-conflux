/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL?: string;
    readonly VITE_WS_URL?: string;
    readonly VITE_CHAIN_ID?: string;
    readonly VITE_RPC_URL?: string;
    readonly VITE_CONFLUX_TESTNET_RPC_URL?: string;
    readonly VITE_WALLET_CONNECT_PROJECT_ID?: string;
    readonly VITE_APP_URL?: string;
    readonly VITE_MOCK_MODE?: string;
    readonly VITE_TRADING_CORE_ADDRESS?: string;
    readonly VITE_VAULT_CORE_ADDRESS?: string;
    readonly VITE_ORACLE_AGGREGATOR_ADDRESS?: string;
    readonly VITE_POSITION_TOKEN_ADDRESS?: string;
    readonly VITE_MOCK_USDC_ADDRESS?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
